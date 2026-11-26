using Inventory.Service.Data;
using Inventory.Service.Domain;
using Microsoft.EntityFrameworkCore;
using OrderPlatform.Contracts;
using OrderPlatform.Messaging;
using OrderPlatform.Messaging.Inbox;
using OrderPlatform.Messaging.Outbox;

namespace Inventory.Service.Messaging;

/// <summary>
/// The procurement saga's last hop: when goods arrive, inventory adds them to on-hand stock and
/// publishes the new level. Procurement never writes stock itself, so the inventory service stays
/// the only owner of the quantity.
/// </summary>
public sealed class ProcurementEventsHandler(InventoryDbContext db, TimeProvider clock, ILogger<ProcurementEventsHandler> logger)
    : IMessageHandler
{
    public const string ConsumerName = "inventory-service";

    public async Task HandleAsync(EventEnvelope envelope, CancellationToken ct)
    {
        if (envelope.EventType != GoodsReceived.EventType) return;
        if (await db.HasProcessedAsync(envelope, ConsumerName, ct)) return;

        var received = envelope.PayloadAs<GoodsReceived>();
        var sku = StockItem.NormalizeSku(received.Sku);
        var now = clock.GetUtcNow();
        var item = await db.StockItems.SingleOrDefaultAsync(s => s.Sku == sku, ct);
        if (item is null)
        {
            // First time this SKU is seen: the receipt is the authority that the stock exists.
            logger.LogInformation("Creating stock for {Sku} from a goods receipt of {Quantity}", sku, received.Quantity);
            item = StockItem.Create(sku, received.Quantity, now);
            db.StockItems.Add(item);
        }
        else
        {
            item.Restock(received.Quantity, now);
        }

        db.Enqueue(Topics.InventoryEvents, item.Sku,
            new StockLevelChanged(item.Sku, item.OnHand, item.Reserved, item.Available, item.Revision),
            envelope.CorrelationId, envelope.EventId, clock);
        db.MarkProcessed(envelope, ConsumerName, clock);
        await db.SaveChangesAsync(ct);
    }
}
