namespace OrderPlatform.Messaging;

public sealed class KafkaOptions
{
    public const string Section = "Kafka";

    public string BootstrapServers { get; set; } = "localhost:9092";
    public string ClientId { get; set; } = Environment.MachineName;
    public string GroupId { get; set; } = "";

    /// <summary>Turns the Kafka consumer and outbox dispatcher off (used by API-only tests).</summary>
    public bool Enabled { get; set; } = true;

    /// <summary>Creates the platform's topics on startup if they are missing.</summary>
    public bool ProvisionTopics { get; set; } = true;
    public int TopicPartitions { get; set; } = 3;
    public short ReplicationFactor { get; set; } = 1;

    public int MaxHandlerAttempts { get; set; } = 5;
    public TimeSpan InitialRetryDelay { get; set; } = TimeSpan.FromMilliseconds(200);

    public TimeSpan OutboxPollInterval { get; set; } = TimeSpan.FromMilliseconds(250);
    public int OutboxBatchSize { get; set; } = 100;
}
