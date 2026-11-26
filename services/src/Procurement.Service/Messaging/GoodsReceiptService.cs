using Microsoft.EntityFrameworkCore;
using OrderPlatform.Contracts;
using OrderPlatform.Messaging.Outbox;
using Procurement.Service.Data;
using Procurement.Service.Domain;

namespace Procurement.Service.Messaging;

/// <summary>
/// Turns purchase orders whose lead time has elapsed into goods receipts.
///
/// The status change and the outbox event are saved in one transaction, so a crash cannot leave
/// an order marked received with no receipt published. Two replicas polling at once can load the
/// same order; the concurrency token lets one commit win and the loser simply retries on the next
/// tick.
/// </summary>
public sealed class GoodsReceiptService(
    ProcurementDbContext db,
    TimeProvider clock,
    ILogger<GoodsReceiptService> logger)
{
    public async Task<int> ReceiveDueAsync(CancellationToken ct)
    {
        var now = clock.GetUtcNow();
        var due = await db.PurchaseOrders
            .Where(p => p.Status == PurchaseOrderStatus.InTransit && p.ExpectedAt <= now)
            .OrderBy(p => p.ExpectedAt)
            .Take(100)
            .ToListAsync(ct);
        if (due.Count == 0) return 0;

        foreach (var order in due)
        {
            order.Receive(now);
            db.Enqueue(Topics.ProcurementEvents, order.Sku,
                new GoodsReceived(order.Id, order.Sku, order.Quantity, order.UnitCostCents),
                Guid.NewGuid(), null, clock);
            logger.LogInformation("Received {Quantity} of {Sku} for purchase order {PurchaseOrderId}",
                order.Quantity, order.Sku, order.Id);
        }

        try
        {
            await db.SaveChangesAsync(ct);
        }
        catch (DbUpdateConcurrencyException)
        {
            // Another replica received these first; it also published the receipts.
            logger.LogInformation("Another replica received a due purchase order first; skipping this batch");
            return 0;
        }
        return due.Count;
    }
}
