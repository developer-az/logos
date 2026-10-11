using Confluent.Kafka;

namespace OrderPlatform.Messaging.Tests;

public class KafkaOptionsTests
{
    [Fact]
    public void Plaintext_sets_no_credentials()
    {
        var config = new KafkaOptions { BootstrapServers = "kafka:9092" }.Apply(new ProducerConfig());

        Assert.Equal("kafka:9092", config.BootstrapServers);
        Assert.Equal(SecurityProtocol.Plaintext, config.SecurityProtocol);
        Assert.Null(config.SaslUsername);
        Assert.Null(config.SslCaLocation);
    }

    [Fact]
    public void Sasl_ssl_carries_scram_credentials_and_the_cluster_ca()
    {
        var options = new KafkaOptions
        {
            BootstrapServers = "logos-kafka-kafka-bootstrap.kafka:9093",
            SecurityProtocol = SecurityProtocol.SaslSsl,
            SaslUsername = "order-service",
            SaslPassword = "from-a-secret",
            SslCaLocation = "/etc/kafka-ca/ca.crt",
        };

        var config = options.Apply(new ConsumerConfig());

        Assert.Equal(SecurityProtocol.SaslSsl, config.SecurityProtocol);
        Assert.Equal(SaslMechanism.ScramSha512, config.SaslMechanism);
        Assert.Equal("order-service", config.SaslUsername);
        Assert.Equal("from-a-secret", config.SaslPassword);
        Assert.Equal("/etc/kafka-ca/ca.crt", config.SslCaLocation);
    }

    [Fact]
    public void Ssl_carries_a_client_certificate_and_no_sasl()
    {
        var options = new KafkaOptions
        {
            BootstrapServers = "logos-kafka.aivencloud.com:12345",
            SecurityProtocol = SecurityProtocol.Ssl,
            SslCaLocation = "/kafka/ca.pem",
            SslCertificateLocation = "/kafka/service.cert",
            SslKeyLocation = "/kafka/service.key",
        };

        var config = options.Apply(new AdminClientConfig());

        Assert.Equal(SecurityProtocol.Ssl, config.SecurityProtocol);
        Assert.Null(config.SaslMechanism);
        Assert.Equal("/kafka/ca.pem", config.SslCaLocation);
        Assert.Equal("/kafka/service.cert", config.SslCertificateLocation);
        Assert.Equal("/kafka/service.key", config.SslKeyLocation);
    }
}
