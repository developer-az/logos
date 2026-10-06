using Microsoft.EntityFrameworkCore;
using OrderPlatform.Contracts;

namespace OrderPlatform.Messaging.Inbox;

public static class InboxExtensions
{
    public static Task<bool> HasProcessedAsync(this IMessagingDbContext db, EventEnvelope envelope, string consumer, CancellationToken ct) =>
        db.InboxMessages.AnyAsync(x => x.EventId == envelope.EventId && x.Consumer == consumer, ct);

    /// <summary>Marks the event handled. Saved in the same transaction as the handler's changes;
    /// the composite primary key rejects a concurrent duplicate.</summary>
    public static void MarkProcessed(this IMessagingDbContext db, EventEnvelope envelope, string consumer, TimeProvider clock) =>
        db.InboxMessages.Add(new InboxMessage
        {
            EventId = envelope.EventId,
            Consumer = consumer,
            EventType = envelope.EventType,
            ProcessedAt = clock.GetUtcNow(),
        });
}
