using Inventory.Service.Data;
using Microsoft.EntityFrameworkCore;
using OrderPlatform.Contracts;

namespace Inventory.Service.Tests;

public sealed class DemoSeederTests : IDisposable
{
    private readonly InventoryDb _db = new();

    public void Dispose() => _db.Dispose();

    [Fact]
    public async Task Seeding_publishes_a_level_for_every_seeded_sku()
    {
        await using var db = _db.NewContext();
        await DemoSeeder.SeedAsync(db, _db.Clock);

        Assert.Equal(5, await db.StockItems.CountAsync());
        var levels = (await db.OutboxMessages.Select(m => m.Body).ToListAsync())
            .Select(EventEnvelope.Deserialize)
            .Select(e => e.PayloadAs<StockLevelChanged>())
            .ToList();

        // A read model that starts after seeding still learns the stock exists.
        Assert.Equal(5, levels.Count);
        Assert.Contains(levels, l => l.Sku == "WEBCAM-HD" && l.OnHand == 0 && l.Available == 0);
        Assert.Contains(levels, l => l.Sku == "MOUSE-01" && l.OnHand == 120);
    }

    [Fact]
    public async Task Seeding_twice_publishes_nothing_more()
    {
        await using var db = _db.NewContext();
        await DemoSeeder.SeedAsync(db, _db.Clock);
        await DemoSeeder.SeedAsync(db, _db.Clock);

        Assert.Equal(5, await db.OutboxMessages.CountAsync());
    }
}
