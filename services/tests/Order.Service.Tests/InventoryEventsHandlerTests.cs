using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;
using Order.Service.Domain;
using Order.Service.Messaging;
using OrderPlatform.Contracts;

namespace Order.Service.Tests;

public sealed class InventoryEventsHandlerTests : IDisposable
{
    private readonly OrdersDb _db = new();

    private Guid SeedPendingOrder(Action<Domain.Order>? mutate = null)
    {
        using var db = _db.NewContext();
        var order = Domain.Order.Place(Guid.NewGuid(), "c-1", [new OrderItem { Sku = "A", Quantity = 2, UnitPrice = 5m }],
            Guid.NewGuid(), null, _db.Clock.GetUtcNow());
        mutate?.Invoke(order);
        db.Orders.Add(order);
        db.SaveChanges();
        return order.Id;
    }

    private async Task Handle(EventEnvelope envelope)
    {
        await using var db = _db.NewContext();
        await new InventoryEventsHandler(db, _db.Clock, NullLogger<InventoryEventsHandler>.Instance).HandleAsync(envelope, default);
    }

    private (Domain.Order Order, List<OrderPlatform.Messaging.OutboxMessage> Outbox) Load(Guid id)
    {
        using var db = _db.NewContext();
        return (db.Orders.AsNoTracking().Single(o => o.Id == id), db.OutboxMessages.AsNoTracking().OrderBy(m => m.Id).ToList());
    }

    [Fact]
    public async Task Stock_reserved_confirms_the_order_and_emits_OrderConfirmed()
    {
        var id = SeedPendingOrder();
        var envelope = EventEnvelope.Create(new StockReserved(id, [new ReservedLine("A", 2)]), Guid.NewGuid());

        await Handle(envelope);

        var (order, outbox) = Load(id);
        Assert.Equal(OrderStatus.Confirmed, order.Status);
        var message = Assert.Single(outbox);
        Assert.Equal(Topics.OrderEvents, message.Topic);
        Assert.Equal(id.ToString(), message.Key);
        var emitted = EventEnvelope.Deserialize(message.Body);
        Assert.Equal(OrderConfirmed.EventType, emitted.EventType);
        Assert.Equal(envelope.CorrelationId, emitted.CorrelationId);
        Assert.Equal(envelope.EventId, emitted.CausationId);
    }

    [Fact]
    public async Task Reservation_failure_rejects_the_order_with_the_reason()
    {
        var id = SeedPendingOrder();

        await Handle(EventEnvelope.Create(new StockReservationFailed(id, "Insufficient stock for A", [new StockShortage("A", 2, 0)]), Guid.NewGuid()));

        var (order, outbox) = Load(id);
        Assert.Equal(OrderStatus.Rejected, order.Status);
        Assert.Equal("Insufficient stock for A", order.StatusReason);
        var rejected = EventEnvelope.Deserialize(Assert.Single(outbox).Body).PayloadAs<OrderRejected>();
        Assert.Equal("Insufficient stock for A", rejected.Reason);
    }

    [Fact]
    public async Task Redelivered_events_are_applied_once()
    {
        var id = SeedPendingOrder();
        var envelope = EventEnvelope.Create(new StockReserved(id, [new ReservedLine("A", 2)]), Guid.NewGuid());

        await Handle(envelope);
        await Handle(envelope);

        Assert.Single(Load(id).Outbox);
    }

    [Fact]
    public async Task A_late_reservation_for_a_cancelled_order_changes_nothing()
    {
        var id = SeedPendingOrder(o => o.Cancel("too slow", DateTimeOffset.UtcNow));

        await Handle(EventEnvelope.Create(new StockReserved(id, [new ReservedLine("A", 2)]), Guid.NewGuid()));

        var (order, outbox) = Load(id);
        Assert.Equal(OrderStatus.Cancelled, order.Status);
        Assert.Empty(outbox);
    }

    [Fact]
    public async Task Events_it_does_not_consume_are_ignored()
    {
        await Handle(EventEnvelope.Create(new StockLevelChanged("A", 10, 2, 8, 1), Guid.NewGuid()));

        await using var db = _db.NewContext();
        Assert.Empty(db.InboxMessages);
    }

    [Fact]
    public async Task An_unknown_order_fails_so_the_message_is_retried()
    {
        await Assert.ThrowsAsync<InvalidOperationException>(() =>
            Handle(EventEnvelope.Create(new StockReserved(Guid.NewGuid(), []), Guid.NewGuid())));
    }

    public void Dispose() => _db.Dispose();
}
