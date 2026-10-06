using OrderPlatform.Contracts;

namespace OrderPlatform.Messaging.Outbox;

public static class OutboxExtensions
{
    /// <summary>Stages an event for publishing. It is saved by the caller's next SaveChanges, so the
    /// event exists if and only if the state change that produced it was committed.</summary>
    public static EventEnvelope Enqueue<T>(this IMessagingDbContext db, string topic, string key, T payload,
        Guid correlationId, Guid? causationId, TimeProvider clock) where T : IIntegrationEvent
    {
        var now = clock.GetUtcNow();
        var envelope = EventEnvelope.Create(payload, correlationId, causationId, now);
        db.OutboxMessages.Add(new OutboxMessage
        {
            EventId = envelope.EventId,
            Topic = topic,
            Key = key,
            EventType = envelope.EventType,
            Body = envelope.Serialize(),
            CreatedAt = now,
        });
        return envelope;
    }
}
