namespace Metrics.Service.Kafka;

public sealed class KafkaOptions
{
    public const string Section = "Kafka";

    public string BootstrapServers { get; set; } = "localhost:9092";
    public string GroupId { get; set; } = "metrics-service";
    public string IssueEventsTopic { get; set; } = "jira.issue-events.v1";
    public string DeadLetterTopic { get; set; } = "jira.issue-events.dlq.v1";
    public string MetricsTopic { get; set; } = "delivery.issue-metrics.v1";

    /// <summary>
    /// Re-read assigned partitions from offset 0 so in-memory state survives restarts and
    /// rebalances. Requires the issue-events topic to keep data indefinitely (retention.ms=-1).
    /// </summary>
    public bool ReplayFromBeginningOnAssign { get; set; } = true;

    /// <summary>Optional SASL credentials, supplied from a Kubernetes Secret in-cluster.</summary>
    public string? SaslUsername { get; set; }
    public string? SaslPassword { get; set; }

    /// <summary>PEM CA bundle for the broker TLS listener (Strimzi's cluster CA in-cluster).</summary>
    public string? SslCaLocation { get; set; }
}
