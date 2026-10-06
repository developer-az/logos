using Inventory.Service.Data;
using Inventory.Service.Domain;
using Microsoft.EntityFrameworkCore;
using OrderPlatform.Contracts;
using OrderPlatform.Messaging;
using OrderPlatform.Messaging.Inbox;
using OrderPlatform.Messaging.Outbox;

namespace Inventory.Service.Messaging;

/// <summary>
/// Inventory's side of the order saga: reserve all lines of a placed order or none of them,
/// and return stock when an order is cancelled.
/// </summary>
public sealed class OrderEventsHandler(InventoryDbContext db, TimeProvider clock, ILogger<OrderEventsHandler> logger) : IMessageHandler
{
    public const string ConsumerName = "inventory-service";

    public async Task HandleAsync(EventEnvelope envelope, CancellationToken ct)
    {
        Func<Task>? handle = envelope.EventType switch
        {
            var t when t == OrderPlaced.EventType => () => ReserveAsync(envelope, envelope.PayloadAs<OrderPlaced>(), ct),
            var t when t == OrderCancelled.EventType => () => ReleaseAsync(envelope, envelope.PayloadAs<OrderCancelled>(), ct),
            _ => null,
        };
        if (handle is null) return;
        if (await db.HasProcessedAsync(envelope, ConsumerName, ct)) return;

        await handle();

        db.MarkProcessed(envelope, ConsumerName, clock);
        // A DbUpdateConcurrencyException here means another consumer changed one of the SKUs;
        // the processor retries with a fresh scope, which re-reads current stock.
        await db.SaveChangesAsync(ct);
    }

    private async Task ReserveAsync(EventEnvelope cause, OrderPlaced placed, CancellationToken ct)
    {
        var existing = await db.Reservations.SingleOrDefaultAsync(r => r.OrderId == placed.OrderId, ct);
        if (existing is not null)
        {
            logger.LogInformation("Order {OrderId} already has a {Status} reservation; not reserving again", placed.OrderId, existing.Status);
            return;
        }

        var now = clock.GetUtcNow();
        var requested = placed.Lines
            .GroupBy(l => StockItem.NormalizeSku(l.Sku))
            .Select(g => new ReservationLine { Sku = g.Key, Quantity = g.Sum(l => l.Quantity) })
            .ToList();
        var skus = requested.Select(l => l.Sku).ToList();
        var stock = await db.StockItems.Where(s => skus.Contains(s.Sku)).ToDictionaryAsync(s => s.Sku, ct);

        var shortages = requested
            .Select(l => new StockShortage(l.Sku, l.Quantity, stock.TryGetValue(l.Sku, out var s) ? s.Available : 0))
            .Where(s => s.Available < s.Requested)
            .ToList();

        var key = placed.OrderId.ToString();
        if (shortages.Count > 0)
        {
            var reason = "Insufficient stock for " + string.Join(", ", shortages.Select(s => $"{s.Sku} (requested {s.Requested}, available {s.Available})"));
            db.Reservations.Add(Reservation.Create(placed.OrderId, ReservationStatus.Failed, requested, reason, now));
            db.Enqueue(Topics.InventoryEvents, key, new StockReservationFailed(placed.OrderId, reason, shortages), cause.CorrelationId, cause.EventId, clock);
            return;
        }

        foreach (var line in requested)
            stock[line.Sku].Reserve(line.Quantity, now);

        db.Reservations.Add(Reservation.Create(placed.OrderId, ReservationStatus.Reserved, requested, null, now));
        db.Enqueue(Topics.InventoryEvents, key,
            new StockReserved(placed.OrderId, requested.Select(l => new ReservedLine(l.Sku, l.Quantity)).ToList()),
            cause.CorrelationId, cause.EventId, clock);
        EnqueueStockLevels(stock.Values, cause);
    }

    private async Task ReleaseAsync(EventEnvelope cause, OrderCancelled cancelled, CancellationToken ct)
    {
        var now = clock.GetUtcNow();
        var reservation = await db.Reservations.SingleOrDefaultAsync(r => r.OrderId == cancelled.OrderId, ct);
        if (reservation is null)
        {
            // Cancellation overtook placement; leave a marker so the late OrderPlaced is ignored.
            db.Reservations.Add(Reservation.Create(cancelled.OrderId, ReservationStatus.CancelledBeforePlaced, [], cancelled.Reason, now));
            return;
        }
        if (reservation.Status != ReservationStatus.Reserved) return;

        var skus = reservation.Lines.Select(l => l.Sku).ToList();
        var stock = await db.StockItems.Where(s => skus.Contains(s.Sku)).ToDictionaryAsync(s => s.Sku, ct);
        foreach (var line in reservation.Lines)
            stock[line.Sku].Release(line.Quantity, now);
        reservation.MarkReleased(now);

        db.Enqueue(Topics.InventoryEvents, cancelled.OrderId.ToString(),
            new StockReleased(cancelled.OrderId, reservation.Lines.Select(l => new ReservedLine(l.Sku, l.Quantity)).ToList()),
            cause.CorrelationId, cause.EventId, clock);
        EnqueueStockLevels(stock.Values, cause);
    }

    private void EnqueueStockLevels(IEnumerable<StockItem> items, EventEnvelope cause)
    {
        foreach (var item in items)
            db.Enqueue(Topics.InventoryEvents, item.Sku, new StockLevelChanged(item.Sku, item.OnHand, item.Reserved, item.Available, item.Revision),
                cause.CorrelationId, cause.EventId, clock);
    }
}
