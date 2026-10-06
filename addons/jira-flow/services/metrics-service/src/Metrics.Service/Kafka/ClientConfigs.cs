using Confluent.Kafka;

namespace Metrics.Service.Kafka;

internal static class ClientConfigs
{
    public static ConsumerConfig Consumer(KafkaOptions o) => Secure(o, new ConsumerConfig
    {
        BootstrapServers = o.BootstrapServers,
        GroupId = o.GroupId,
        AutoOffsetReset = AutoOffsetReset.Earliest,
        // At-least-once: offsets are stored only after an event is fully handled, and the
        // background auto-commit flushes stored offsets. Processing is idempotent (dedupe by id).
        EnableAutoCommit = true,
        EnableAutoOffsetStore = false,
        // Cooperative rebalancing avoids stop-the-world pauses when pods scale.
        PartitionAssignmentStrategy = PartitionAssignmentStrategy.CooperativeSticky,
    });

    public static ProducerConfig Producer(KafkaOptions o) => Secure(o, new ProducerConfig
    {
        BootstrapServers = o.BootstrapServers,
        EnableIdempotence = true,
        Acks = Acks.All,
        LingerMs = 5,
    });

    private static T Secure<T>(KafkaOptions o, T config) where T : ClientConfig
    {
        if (!string.IsNullOrEmpty(o.SaslUsername) && !string.IsNullOrEmpty(o.SaslPassword))
        {
            config.SecurityProtocol = SecurityProtocol.SaslSsl;
            config.SaslMechanism = SaslMechanism.ScramSha512;
            config.SaslUsername = o.SaslUsername;
            config.SaslPassword = o.SaslPassword;
            config.SslCaLocation = o.SslCaLocation;
        }
        return config;
    }
}
