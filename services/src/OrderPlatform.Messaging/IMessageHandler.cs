using OrderPlatform.Contracts;

namespace OrderPlatform.Messaging;

/// <summary>Handles one event from Kafka. Resolved from a fresh DI scope per attempt.
/// Throwing triggers a retry; after the last attempt the message goes to the dead-letter topic.</summary>
public interface IMessageHandler
{
    Task HandleAsync(EventEnvelope envelope, CancellationToken ct);
}
