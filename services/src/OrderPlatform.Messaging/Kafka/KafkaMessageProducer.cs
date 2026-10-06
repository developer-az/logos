using System.Text;
using Confluent.Kafka;
using Microsoft.Extensions.Options;

namespace OrderPlatform.Messaging.Kafka;

/// <summary>Idempotent producer with acks=all, so a retried send cannot duplicate or reorder within a partition.</summary>
public sealed class KafkaMessageProducer : IMessageProducer, IDisposable
{
    private readonly Lazy<IProducer<string, string>> _producer;

    public KafkaMessageProducer(IOptions<KafkaOptions> options)
    {
        var opts = options.Value;
        _producer = new Lazy<IProducer<string, string>>(() => new ProducerBuilder<string, string>(opts.Apply(new ProducerConfig
        {
            ClientId = opts.ClientId,
            EnableIdempotence = true,
            Acks = Acks.All,
            LingerMs = 5,
            MessageTimeoutMs = 30_000,
        })).Build());
    }

    public async Task ProduceAsync(OutgoingMessage message, CancellationToken ct)
    {
        var headers = new Headers();
        foreach (var (name, value) in message.Headers)
            headers.Add(name, Encoding.UTF8.GetBytes(value));

        await _producer.Value.ProduceAsync(message.Topic,
            new Message<string, string> { Key = message.Key, Value = message.Body, Headers = headers }, ct);
    }

    public void Dispose()
    {
        if (!_producer.IsValueCreated) return;
        _producer.Value.Flush(TimeSpan.FromSeconds(10));
        _producer.Value.Dispose();
    }
}
