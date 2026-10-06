using Confluent.Kafka;
using Confluent.Kafka.Admin;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using OrderPlatform.Contracts;

namespace OrderPlatform.Messaging.Kafka;

/// <summary>Creates the platform topics (and their dead-letter topics) before consumers start.</summary>
public sealed class KafkaTopicProvisioner(IOptions<KafkaOptions> options, ILogger<KafkaTopicProvisioner> logger) : IHostedService
{
    private static readonly string[] BaseTopics = [Topics.OrderEvents, Topics.InventoryEvents];

    public async Task StartAsync(CancellationToken cancellationToken)
    {
        var opts = options.Value;
        if (!opts.Enabled || !opts.ProvisionTopics) return;

        var specs = BaseTopics.SelectMany(t => new[] { t, Topics.DeadLetter(t) })
            .Select(name => new TopicSpecification
            {
                Name = name,
                NumPartitions = opts.TopicPartitions,
                ReplicationFactor = opts.ReplicationFactor,
            })
            .ToList();

        using var admin = new AdminClientBuilder(new AdminClientConfig { BootstrapServers = opts.BootstrapServers }).Build();

        // The broker may still be starting (docker-compose, Kubernetes), so retry for a while.
        for (var attempt = 1; ; attempt++)
        {
            try
            {
                await admin.CreateTopicsAsync(specs);
                logger.LogInformation("Created topics {Topics}", string.Join(", ", specs.Select(s => s.Name)));
                return;
            }
            catch (CreateTopicsException ex) when (ex.Results.All(r => r.Error.Code is ErrorCode.NoError or ErrorCode.TopicAlreadyExists))
            {
                return;
            }
            catch (KafkaException ex) when (attempt < 10)
            {
                logger.LogWarning("Kafka not ready for topic creation ({Reason}); attempt {Attempt}", ex.Error.Reason, attempt);
                await Task.Delay(TimeSpan.FromSeconds(Math.Min(attempt * 2, 10)), cancellationToken);
            }
        }
    }

    public Task StopAsync(CancellationToken cancellationToken) => Task.CompletedTask;
}
