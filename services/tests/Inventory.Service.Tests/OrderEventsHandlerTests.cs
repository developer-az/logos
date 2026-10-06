using Inventory.Service.Domain;
using Inventory.Service.Messaging;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;
using OrderPlatform.Contracts;

namespace Inventory.Service.Tests;

public sealed class OrderEventsHandlerTests : IDisposable
{
    private readonly InventoryDb _db = new();

    public OrderEventsHandlerTests()
    {
        using var db = _db.NewContext();
        db.StockItems.AddRange(StockItem.Create("A", 10, _db.Clock.GetUtcNow()), StockItem.Create("B", 1, _db.Clock.GetUtcNow()));
        db.SaveChanges();
    }

    private async Task Handle(EventEnvelope envelope)
    {
        await using var db = _db.NewContext();
        await new OrderEventsHandler(db, _db.Clock, NullLogger<OrderEventsHandler>.Instance).HandleAsync(envelope, default);
    }

    private static EventEnvelope Placed(Guid orderId, params (string Sku, int Qty)[] lines) =>
        EventEnvelope.Create(new OrderPlaced(orderId, "c-1", lines.Select(l => new OrderLine(l.Sku, l.Qty, 1m)).ToList(), lines.Sum(l => l.Qty)), Guid.NewGuid());

    private static EventEnvelope Cancelled(Guid orderId) => EventEnvelope.Create(new OrderCancelled(orderId, null), Guid.NewGuid());

    private Dictionary<string, StockItem> Stock()
    {
        using var db = _db.NewContext();
        return db.StockItems.AsNoTracking().ToDictionary(s => s.Sku);
    }

    private List<EventEnvelope> Emitted()
    {
        using var db = _db.NewContext();
        return db.OutboxMessages.AsNoTracking().OrderBy(m => m.Id).Select(m => m.Body).ToList().Select(EventEnvelope.Deserialize).ToList();
    }

    private ReservationStatus? StatusOf(Guid orderId)
    {
        using var db = _db.NewContext();
        return db.Reservations.AsNoTracking().SingleOrDefault(r => r.OrderId == orderId)?.Status;
    }

    [Fact]
    public async Task Reserves_every_line_and_publishes_the_result_and_new_levels()
    {
        var orderId = Guid.NewGuid();
        var placed = Placed(orderId, ("A", 4), ("b", 1));

        await Handle(placed);

        var stock = Stock();
        Assert.Equal(4, stock["A"].Reserved);
        Assert.Equal(0, stock["B"].Available);
        Assert.Equal(ReservationStatus.Reserved, StatusOf(orderId));

        var emitted = Emitted();
        Assert.Equal(StockReserved.EventType, emitted[0].EventType);
        Assert.Equal(placed.CorrelationId, emitted[0].CorrelationId);
        Assert.Equal(placed.EventId, emitted[0].CausationId);
        var levels = emitted.Skip(1).Select(e => e.PayloadAs<StockLevelChanged>()).OrderBy(l => l.Sku).ToList();
        Assert.Equal([new StockLevelChanged("A", 10, 4, 6, 2), new StockLevelChanged("B", 1, 1, 0, 2)], levels);
    }

    [Fact]
    public async Task Holds_nothing_when_any_line_is_short_and_lists_every_shortage()
    {
        var orderId = Guid.NewGuid();

        await Handle(Placed(orderId, ("A", 4), ("B", 2), ("UNKNOWN", 1)));

        Assert.All(Stock().Values, s => Assert.Equal(0, s.Reserved));
        Assert.Equal(ReservationStatus.Failed, StatusOf(orderId));
        var failed = Assert.Single(Emitted()).PayloadAs<StockReservationFailed>();
        Assert.Equal([new StockShortage("B", 2, 1), new StockShortage("UNKNOWN", 1, 0)], failed.Shortages);
        Assert.Contains("B (requested 2, available 1)", failed.Reason);
    }

    [Fact]
    public async Task Redelivery_of_OrderPlaced_does_not_double_reserve()
    {
        var placed = Placed(Guid.NewGuid(), ("A", 4));

        await Handle(placed);
        await Handle(placed);
        // Same order, different event id (e.g. a republished outbox row): the reservation guard catches it.
        await Handle(Placed(placed.PayloadAs<OrderPlaced>().OrderId, ("A", 4)));

        Assert.Equal(4, Stock()["A"].Reserved);
        Assert.Single(Emitted(), e => e.EventType == StockReserved.EventType);
    }

    [Fact]
    public async Task Cancelling_returns_reserved_stock()
    {
        var orderId = Guid.NewGuid();
        await Handle(Placed(orderId, ("A", 4)));

        await Handle(Cancelled(orderId));

        Assert.Equal(0, Stock()["A"].Reserved);
        Assert.Equal(ReservationStatus.Released, StatusOf(orderId));
        var released = Emitted().Single(e => e.EventType == StockReleased.EventType).PayloadAs<StockReleased>();
        Assert.Equal([new ReservedLine("A", 4)], released.Lines);
        Assert.Equal(new StockLevelChanged("A", 10, 0, 10, 3), Emitted().Last().PayloadAs<StockLevelChanged>());
    }

    [Fact]
    public async Task A_cancellation_that_overtakes_placement_prevents_the_reservation()
    {
        var orderId = Guid.NewGuid();

        await Handle(Cancelled(orderId));
        await Handle(Placed(orderId, ("A", 4)));

        Assert.Equal(0, Stock()["A"].Reserved);
        Assert.Equal(ReservationStatus.CancelledBeforePlaced, StatusOf(orderId));
        Assert.Empty(Emitted());
    }

    [Fact]
    public async Task Cancelling_a_failed_reservation_releases_nothing()
    {
        var orderId = Guid.NewGuid();
        await Handle(Placed(orderId, ("B", 5)));

        await Handle(Cancelled(orderId));

        Assert.Equal(ReservationStatus.Failed, StatusOf(orderId));
        Assert.Single(Emitted());
    }

    [Fact]
    public async Task Concurrent_reservations_of_the_same_sku_cannot_both_commit()
    {
        // Two consumers read the same stock row, then both try to reserve the last unit.
        await using var first = _db.NewContext();
        await using var second = _db.NewContext();
        var a = await first.StockItems.SingleAsync(s => s.Sku == "B");
        var b = await second.StockItems.SingleAsync(s => s.Sku == "B");
        a.Reserve(1, _db.Clock.GetUtcNow());
        b.Reserve(1, _db.Clock.GetUtcNow());

        await first.SaveChangesAsync();
        await Assert.ThrowsAsync<DbUpdateConcurrencyException>(() => second.SaveChangesAsync());
        Assert.Equal(1, Stock()["B"].Reserved);
    }

    public void Dispose() => _db.Dispose();
}
