using Confluent.Kafka;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace OrderPlatform.Messaging.Kafka;

/// <summary>
/// Consumes the subscribed topics and hands each message to <typeparamref name="THandler"/>.
/// An offset is stored only after its message was handled or dead-lettered, so delivery is at-least-once;
/// handlers make that safe through the inbox table.
/// </summary>
public sealed class KafkaConsumerWorker<THandler>(
    IReadOnlyCollection<string> topics,
    MessageProcessor processor,
    IOptions<KafkaOptions> options,
    ILogger<KafkaConsumerWorker<THandler>> logger) : BackgroundService
    where THandler : IMessageHandler
{
    protected override Task ExecuteAsync(CancellationToken stoppingToken)
    {
        var opts = options.Value;
        if (!opts.Enabled) return Task.CompletedTask;

        // Consume() blocks, so run the loop on its own thread rather than a thread-pool continuation.
        return Task.Factory.StartNew(() => ConsumeLoopAsync(opts, stoppingToken), stoppingToken,
            TaskCreationOptions.LongRunning, TaskScheduler.Default).Unwrap();
    }

    private async Task ConsumeLoopAsync(KafkaOptions opts, CancellationToken ct)
    {
        using var consumer = new ConsumerBuilder<string, string>(new ConsumerConfig
        {
            BootstrapServers = opts.BootstrapServers,
            ClientId = opts.ClientId,
            GroupId = opts.GroupId,
            AutoOffsetReset = AutoOffsetReset.Earliest,
            EnableAutoCommit = true,
            EnableAutoOffsetStore = false,
            PartitionAssignmentStrategy = PartitionAssignmentStrategy.CooperativeSticky,
        })
            .SetErrorHandler((_, e) => logger.LogWarning("Kafka consumer error: {Reason}", e.Reason))
            .Build();

        consumer.Subscribe(topics);
        logger.LogInformation("Consuming {Topics} as group {GroupId}", string.Join(", ", topics), opts.GroupId);

        try
        {
            while (!ct.IsCancellationRequested)
            {
                ConsumeResult<string, string> result;
                try
                {
                    result = consumer.Consume(ct);
                }
                catch (ConsumeException ex)
                {
                    logger.LogWarning(ex, "Consume failed: {Reason}", ex.Error.Reason);
                    continue;
                }

                await processor.ProcessAsync<THandler>(new IncomingMessage(
                    result.Topic, result.Message.Key ?? "", result.Message.Value ?? "",
                    result.Partition.Value, result.Offset.Value), ct);
                consumer.StoreOffset(result);
            }
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested)
        {
        }
        finally
        {
            consumer.Close();
        }
    }
}
