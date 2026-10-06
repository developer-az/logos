using System.Text.Json;
using Confluent.Kafka;
using Metrics.Core.Domain;
using Metrics.Core.Events;
using Microsoft.Extensions.Options;

namespace Metrics.Service.Kafka;

/// <summary>
/// Consumes normalized issue events, updates per-issue timelines, and publishes recomputed
/// metrics. Messages that cannot be parsed are forwarded to the dead-letter topic rather than
/// blocking the partition.
/// </summary>
public sealed class IssueEventConsumer(
    IOptions<KafkaOptions> options,
    IssueEventProcessor processor,
    IProducer<string, string> producer,
    ConsumerReadiness readiness,
    ILogger<IssueEventConsumer> logger) : BackgroundService
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);
    private readonly KafkaOptions _o = options.Value;

    // Confluent's Consume() blocks, so run the loop on a dedicated thread instead of the host's.
    protected override Task ExecuteAsync(CancellationToken stoppingToken) =>
        Task.Factory.StartNew(() => Run(stoppingToken), stoppingToken, TaskCreationOptions.LongRunning, TaskScheduler.Default);

    private void Run(CancellationToken ct)
    {
        using var consumer = new ConsumerBuilder<string, string>(ClientConfigs.Consumer(_o))
            .SetPartitionsAssignedHandler((_, parts) =>
            {
                logger.LogInformation("Assigned {Partitions}", string.Join(",", parts));
                readiness.MarkReady();
                // State lives in memory, so a newly owned partition is rebuilt by replaying it
                // from the start; dedupe by event id makes the replay safe. Turn this off once
                // timelines are stored durably.
                return parts.Select(p => new TopicPartitionOffset(
                    p, _o.ReplayFromBeginningOnAssign ? Offset.Beginning : Offset.Unset));
            })
            .SetErrorHandler((_, e) => logger.LogWarning("Kafka error {Code}: {Reason}", e.Code, e.Reason))
            .Build();

        consumer.Subscribe(_o.IssueEventsTopic);
        try
        {
            while (!ct.IsCancellationRequested)
            {
                var result = consumer.Consume(ct);
                Handle(result);
                consumer.StoreOffset(result);
            }
        }
        catch (OperationCanceledException) { /* shutting down */ }
        finally
        {
            // Close() commits stored offsets and leaves the group cleanly so partitions move fast.
            consumer.Close();
        }
    }

    private void Handle(ConsumeResult<string, string> result)
    {
        IssueEvent? evt;
        try
        {
            evt = JsonSerializer.Deserialize<IssueEvent>(result.Message.Value, Json);
            if (evt is null) throw new JsonException("Null event payload.");
        }
        catch (JsonException ex)
        {
            DeadLetter(result, ex);
            return;
        }

        ProcessResult outcome;
        try
        {
            outcome = processor.Process(evt);
        }
        catch (UnsupportedSchemaVersionException ex)
        {
            DeadLetter(result, ex);
            return;
        }

        if (outcome.Outcome == ProcessOutcome.Duplicate)
        {
            logger.LogDebug("Skipped duplicate event {EventId}", evt.Id);
            return;
        }

        producer.Produce(_o.MetricsTopic, new Message<string, string>
        {
            Key = evt.IssueKey,
            Value = JsonSerializer.Serialize(outcome.Metrics, Json),
        }, report =>
        {
            if (report.Error.IsError) logger.LogError("Publishing metrics for {Issue} failed: {Reason}", evt.IssueKey, report.Error.Reason);
        });
    }

    private void DeadLetter(ConsumeResult<string, string> result, Exception ex)
    {
        logger.LogWarning(ex, "Dead-lettering {TopicPartitionOffset}", result.TopicPartitionOffset);
        var headers = new Headers
        {
            { "dlq.reason", System.Text.Encoding.UTF8.GetBytes(ex.Message) },
            { "dlq.source", System.Text.Encoding.UTF8.GetBytes(result.TopicPartitionOffset.ToString()) },
        };
        // Synchronous so the offset is not stored before the dead letter is durable.
        producer.ProduceAsync(_o.DeadLetterTopic, new Message<string, string>
        {
            Key = result.Message.Key,
            Value = result.Message.Value,
            Headers = headers,
        }).GetAwaiter().GetResult();
    }
}

/// <summary>Readiness flips once the consumer has joined the group and received partitions.</summary>
public sealed class ConsumerReadiness
{
    private volatile bool _ready;
    public bool IsReady => _ready;
    public void MarkReady() => _ready = true;
}
