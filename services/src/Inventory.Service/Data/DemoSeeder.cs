using Inventory.Service.Domain;
using Microsoft.EntityFrameworkCore;

namespace Inventory.Service.Data;

/// <summary>Gives a fresh local environment some stock to order against.</summary>
public static class DemoSeeder
{
    private static readonly (string Sku, int OnHand)[] Items =
        [("KEYBOARD-01", 50), ("MOUSE-01", 120), ("MONITOR-27", 15), ("USB-C-HUB", 40), ("WEBCAM-HD", 0)];

    public static async Task SeedAsync(InventoryDbContext db, TimeProvider clock, CancellationToken ct = default)
    {
        if (await db.StockItems.AnyAsync(ct)) return;
        db.StockItems.AddRange(Items.Select(i => StockItem.Create(i.Sku, i.OnHand, clock.GetUtcNow())));
        await db.SaveChangesAsync(ct);
    }
}
