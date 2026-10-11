using Confluent.Kafka;

namespace OrderPlatform.Messaging;

public sealed class KafkaOptions
{
    public const string Section = "Kafka";

    public string BootstrapServers { get; set; } = "localhost:9092";
    public string ClientId { get; set; } = Environment.MachineName;
    public string GroupId { get; set; } = "";

    /// <summary>Plaintext for local compose; SaslSsl in-cluster (Strimzi TLS listener with SCRAM);
    /// Ssl with a client certificate for managed Kafka that uses certificate auth.</summary>
    public SecurityProtocol SecurityProtocol { get; set; } = SecurityProtocol.Plaintext;
    public SaslMechanism SaslMechanism { get; set; } = SaslMechanism.ScramSha512;
    public string? SaslUsername { get; set; }
    public string? SaslPassword { get; set; }

    /// <summary>PEM file of the cluster CA (Strimzi: the &lt;cluster&gt;-cluster-ca-cert Secret, key ca.crt).</summary>
    public string? SslCaLocation { get; set; }

    /// <summary>Client certificate and its private key (PEM), for brokers that authenticate
    /// clients by certificate over SSL, such as Aiven's default Kafka listener.</summary>
    public string? SslCertificateLocation { get; set; }
    public string? SslKeyLocation { get; set; }

    /// <summary>Turns the Kafka consumer and outbox dispatcher off (used by API-only tests).</summary>
    public bool Enabled { get; set; } = true;

    /// <summary>Creates the platform's topics on startup if they are missing. Turn off where
    /// topics are managed elsewhere (Strimzi KafkaTopic resources in Kubernetes).</summary>
    public bool ProvisionTopics { get; set; } = true;
    public int TopicPartitions { get; set; } = 3;
    public short ReplicationFactor { get; set; } = 1;

    public int MaxHandlerAttempts { get; set; } = 5;
    public TimeSpan InitialRetryDelay { get; set; } = TimeSpan.FromMilliseconds(200);

    public TimeSpan OutboxPollInterval { get; set; } = TimeSpan.FromMilliseconds(250);
    public int OutboxBatchSize { get; set; } = 100;

    /// <summary>Copies connection and security settings onto a producer, consumer or admin config.</summary>
    public T Apply<T>(T config) where T : ClientConfig
    {
        config.BootstrapServers = BootstrapServers;
        config.SecurityProtocol = SecurityProtocol;
        if (SecurityProtocol is SecurityProtocol.SaslSsl or SecurityProtocol.SaslPlaintext)
        {
            config.SaslMechanism = SaslMechanism;
            config.SaslUsername = SaslUsername;
            config.SaslPassword = SaslPassword;
        }
        if (SslCaLocation is not null) config.SslCaLocation = SslCaLocation;
        if (SslCertificateLocation is not null) config.SslCertificateLocation = SslCertificateLocation;
        if (SslKeyLocation is not null) config.SslKeyLocation = SslKeyLocation;
        return config;
    }
}
