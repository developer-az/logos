using System.Text.Json;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using OrderPlatform.Contracts;

namespace OrderPlatform.Messaging;

public sealed record IncomingMessage(string Topic, string Key, string Body, int Partition, long Offset);

public enum ProcessingOutcome { Handled, DeadLettered }

/// <summary>
/// Runs a handler for one consumed message with exponential-backoff retries, and routes
/// unreadable or repeatedly failing messages to the dead-letter topic so the partition keeps moving.
/// Kept free of Kafka types so it can be tested without a broker.
/// </summary>
public sealed class MessageProcessor(
    IServiceScopeFactory scopes,
    IMessageProducer producer,
    IOptions<KafkaOptions> options,
    TimeProvider clock,
    ILogger<MessageProcessor> logger)
{
    public async Task<ProcessingOutcome> ProcessAsync<THandler>(IncomingMessage message, CancellationToken ct)
        where THandler : IMessageHandler
    {
        EventEnvelope envelope;
        try
        {
            envelope = EventEnvelope.Deserialize(message.Body);
        }
        catch (JsonException ex)
        {
            logger.LogError(ex, "Unreadable message at {Topic}[{Partition}]@{Offset}", message.Topic, message.Partition, message.Offset);
            await DeadLetterAsync(message, ex, attempts: 0, ct);
            return ProcessingOutcome.DeadLettered;
        }

        using var _ = logger.BeginScope(new Dictionary<string, object>
        {
            ["EventId"] = envelope.EventId,
            ["EventType"] = envelope.EventType,
            ["CorrelationId"] = envelope.CorrelationId,
        });

        var opts = options.Value;
        for (var attempt = 1; ; attempt++)
        {
            try
            {
                // A new scope per attempt gives the handler a clean DbContext after a failure.
                await using var scope = scopes.CreateAsyncScope();
                var handler = scope.ServiceProvider.GetRequiredService<THandler>();
                await handler.HandleAsync(envelope, ct);
                return ProcessingOutcome.Handled;
            }
            catch (Exception ex) when (ex is not OperationCanceledException || !ct.IsCancellationRequested)
            {
                if (attempt >= opts.MaxHandlerAttempts)
                {
                    logger.LogError(ex, "Handler failed {Attempts} times; dead-lettering", attempt);
                    await DeadLetterAsync(message, ex, attempt, ct);
                    return ProcessingOutcome.DeadLettered;
                }

                var delay = opts.InitialRetryDelay * Math.Pow(2, attempt - 1);
                logger.LogWarning(ex, "Handler attempt {Attempt} failed; retrying in {Delay}", attempt, delay);
                await Task.Delay(delay, clock, ct);
            }
        }
    }

    private Task DeadLetterAsync(IncomingMessage message, Exception error, int attempts, CancellationToken ct) =>
        producer.ProduceAsync(new OutgoingMessage(Topics.DeadLetter(message.Topic), message.Key, message.Body,
            new Dictionary<string, string>
            {
                ["dlt-source-topic"] = message.Topic,
                ["dlt-source-partition"] = message.Partition.ToString(),
                ["dlt-source-offset"] = message.Offset.ToString(),
                ["dlt-attempts"] = attempts.ToString(),
                ["dlt-error"] = error.GetType().Name + ": " + error.Message,
            }), ct);
}
