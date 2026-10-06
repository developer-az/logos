namespace OrderPlatform.Messaging;

public sealed record OutgoingMessage(string Topic, string Key, string Body, IReadOnlyDictionary<string, string> Headers);

public interface IMessageProducer
{
    /// <summary>Completes once the broker has acknowledged the write.</summary>
    Task ProduceAsync(OutgoingMessage message, CancellationToken ct);
}
