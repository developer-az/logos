using Inventory.Service.Domain;
using Inventory.Service.Messaging;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;
using OrderPlatform.Contracts;

namespace Inventory.Service.Tests;

public sealed class ProcurementEventsHandlerTests : IDisposable
{
    private readonly InventoryDb _db = new();

    public ProcurementEventsHandlerTests()
    {
        using var db = _db.NewContext();
        db.StockItems.Add(StockItem.Create("WEBCAM-HD", 2, _db.Clock.GetUtcNow()));
        db.SaveChanges();
    }

    public void Dispose() => _db.Dispose();

    private async Task Handle(EventEnvelope envelope)
    {
        await using var db = _db.NewContext();
        await new ProcurementEventsHandler(db, _db.Clock, NullLogger<ProcurementEventsHandler>.Instance)
            .HandleAsync(envelope, default);
    }

    [Fact]
    public async Task A_receipt_adds_the_goods_and_publishes_the_new_level()
    {
        var received = EventEnvelope.Create(new GoodsReceived(Guid.NewGuid(), "WEBCAM-HD", 12, 5616), Guid.NewGuid());

        await Handle(received);

        await using var db = _db.NewContext();
        var item = await db.StockItems.SingleAsync(s => s.Sku == "WEBCAM-HD");
        Assert.Equal(14, item.OnHand);
        Assert.Equal(14, item.Available);

        var level = EventEnvelope.Deserialize(await db.OutboxMessages
            .Where(m => m.EventType == StockLevelChanged.EventType)
            .Select(m => m.Body)
            .SingleAsync()).PayloadAs<StockLevelChanged>();
        Assert.Equal(("WEBCAM-HD", 14, 0, 14), (level.Sku, level.OnHand, level.Reserved, level.Available));
    }

    [Fact]
    public async Task A_receipt_for_a_sku_that_is_not_known_creates_it()
    {
        await Handle(EventEnvelope.Create(new GoodsReceived(Guid.NewGuid(), "MONITOR-27", 5, 21000), Guid.NewGuid()));

        await using var db = _db.NewContext();
        var item = await db.StockItems.SingleAsync(s => s.Sku == "MONITOR-27");
        Assert.Equal(5, item.OnHand);
    }

    [Fact]
    public async Task The_same_receipt_twice_is_applied_once()
    {
        var received = EventEnvelope.Create(new GoodsReceived(Guid.NewGuid(), "WEBCAM-HD", 12, 5616), Guid.NewGuid());

        await Handle(received);
        await Handle(received);

        await using var db = _db.NewContext();
        var item = await db.StockItems.SingleAsync(s => s.Sku == "WEBCAM-HD");
        Assert.Equal(14, item.OnHand);
        Assert.Equal(1, await db.OutboxMessages.CountAsync(m => m.EventType == StockLevelChanged.EventType));
    }
}
