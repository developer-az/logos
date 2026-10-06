using Microsoft.EntityFrameworkCore;
using Order.Service.Data;
using Order.Service.Domain;
using OrderPlatform.Contracts;
using OrderPlatform.Messaging;
using OrderPlatform.Messaging.Inbox;
using OrderPlatform.Messaging.Outbox;

namespace Order.Service.Messaging;

/// <summary>Completes the order saga from inventory's decision: confirm on reservation, reject on shortage.</summary>
public sealed class InventoryEventsHandler(OrdersDbContext db, TimeProvider clock, ILogger<InventoryEventsHandler> logger) : IMessageHandler
{
    public const string ConsumerName = "order-service";

    public async Task HandleAsync(EventEnvelope envelope, CancellationToken ct)
    {
        Guid orderId;
        string? rejection = null;
        if (envelope.EventType == StockReserved.EventType)
            orderId = envelope.PayloadAs<StockReserved>().OrderId;
        else if (envelope.EventType == StockReservationFailed.EventType)
        {
            var failed = envelope.PayloadAs<StockReservationFailed>();
            (orderId, rejection) = (failed.OrderId, failed.Reason);
        }
        else
            return; // Stock-level and release events are for other consumers.

        if (await db.HasProcessedAsync(envelope, ConsumerName, ct)) return;

        var order = await db.Orders.SingleOrDefaultAsync(o => o.Id == orderId, ct)
            ?? throw new InvalidOperationException($"Order {orderId} referenced by event {envelope.EventId} does not exist.");

        var now = clock.GetUtcNow();
        var key = order.Id.ToString();
        if (order.Status != OrderStatus.Pending)
        {
            // Typically the customer cancelled while inventory was deciding. Inventory releases the
            // stock when it sees OrderCancelled, so there is nothing to do here.
            logger.LogInformation("Ignoring {EventType} for order {OrderId} in status {Status}", envelope.EventType, order.Id, order.Status);
        }
        else if (rejection is null)
        {
            order.Confirm(now);
            db.Enqueue(Topics.OrderEvents, key, new OrderConfirmed(order.Id), envelope.CorrelationId, envelope.EventId, clock);
        }
        else
        {
            order.Reject(rejection, now);
            db.Enqueue(Topics.OrderEvents, key, new OrderRejected(order.Id, rejection), envelope.CorrelationId, envelope.EventId, clock);
        }

        db.MarkProcessed(envelope, ConsumerName, clock);
        await db.SaveChangesAsync(ct);
    }
}
