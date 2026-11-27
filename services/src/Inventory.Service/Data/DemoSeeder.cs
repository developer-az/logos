using Inventory.Service.Domain;
using Microsoft.EntityFrameworkCore;
using OrderPlatform.Contracts;
using OrderPlatform.Messaging.Outbox;

namespace Inventory.Service.Data;

/// <summary>
/// Gives a fresh local environment some stock to order against, and publishes each level so read
/// models see the stock that exists rather than only the SKUs that have changed since startup.
/// </summary>
public static class DemoSeeder
{
    private static readonly (string Sku, int OnHand)[] Items =
        [("KEYBOARD-01", 50), ("MOUSE-01", 120), ("MONITOR-27", 15), ("USB-C-HUB", 40), ("WEBCAM-HD", 0)];

    public static async Task SeedAsync(InventoryDbContext db, TimeProvider clock, CancellationToken ct = default)
    {
        if (await db.StockItems.AnyAsync(ct)) return;
        var now = clock.GetUtcNow();
        var correlationId = Guid.NewGuid();
        var items = Items.Select(i => StockItem.Create(i.Sku, i.OnHand, now)).ToList();
        db.StockItems.AddRange(items);
        foreach (var item in items)
        {
            db.Enqueue(Topics.InventoryEvents, item.Sku,
                new StockLevelChanged(item.Sku, item.OnHand, item.Reserved, item.Available, item.Revision),
                correlationId, null, clock);
        }
        await db.SaveChangesAsync(ct);
    }
}
