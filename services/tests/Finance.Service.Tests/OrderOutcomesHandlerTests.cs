using Finance.Service.Data;
using Finance.Service.Domain;
using Finance.Service.Messaging;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;
using OrderPlatform.Contracts;
using OrderPlatform.Messaging.Outbox;

namespace Finance.Service.Tests;

public sealed class OrderOutcomesHandlerTests : IDisposable
{
    private readonly FinanceDb _db = new();

    public void Dispose() => _db.Dispose();

    private async Task Handle(EventEnvelope envelope)
    {
        await using var db = _db.NewContext();
        var handler = new OrderOutcomesHandler(db, _db.Clock, NullLogger<OrderOutcomesHandler>.Instance);
        await handler.HandleAsync(envelope, default);
        await db.SaveChangesAsync();
    }

    private static EventEnvelope Placed(Guid orderId, params (string Sku, int Quantity, decimal Price)[] lines) =>
        EventEnvelope.Create(
            new OrderPlaced(orderId, "c-1",
                lines.Select(l => new OrderLine(l.Sku, l.Quantity, l.Price)).ToList(),
                lines.Sum(l => l.Price * l.Quantity)),
            Guid.NewGuid());

    private static EventEnvelope Confirmed(Guid orderId) =>
        EventEnvelope.Create(new OrderConfirmed(orderId), Guid.NewGuid());

    private static EventEnvelope Cancelled(Guid orderId) =>
        EventEnvelope.Create(new OrderCancelled(orderId, "customer changed their mind"), Guid.NewGuid());

    private async Task<List<EventEnvelope>> Emitted()
    {
        await using var db = _db.NewContext();
        return (await db.OutboxMessages.AsNoTracking().OrderBy(m => m.Id).Select(m => m.Body).ToListAsync())
            .Select(EventEnvelope.Deserialize).ToList();
    }

    private async Task<OrderSettlement> Settlement(Guid orderId)
    {
        await using var db = _db.NewContext();
        return await db.Settlements.AsNoTracking().SingleAsync(s => s.OrderId == orderId);
    }

    [Fact]
    public async Task Confirmation_captures_the_order_with_its_standard_cost()
    {
        var orderId = Guid.NewGuid();
        await Handle(Placed(orderId, ("MOUSE-01", 2, 29.50m), ("KEYBOARD-01", 1, 89m)));
        await Handle(Confirmed(orderId));

        var settlement = await Settlement(orderId);
        Assert.Equal(SettlementStatus.Captured, settlement.Status);
        Assert.Equal(14800, settlement.AmountCents); // 2 × 29.50 + 89.00
        Assert.Equal(7800, settlement.CostCents);   // 2 × 18.00 + 42.00

        var capture = (await Emitted()).Single(e => e.EventType == PaymentCaptured.EventType)
            .PayloadAs<PaymentCaptured>();
        Assert.Equal(new PaymentCaptured(orderId, 14800, 7800), capture);
    }

    [Fact]
    public async Task A_recorded_cancellation_after_capture_publishes_a_refund()
    {
        var orderId = Guid.NewGuid();
        await Handle(Placed(orderId, ("WEBCAM-HD", 1, 59m)));
        await Handle(Confirmed(orderId));
        await Handle(Cancelled(orderId));

        Assert.Equal(SettlementStatus.Refunded, (await Settlement(orderId)).Status);
        var refund = (await Emitted()).Single(e => e.EventType == RefundIssued.EventType)
            .PayloadAs<RefundIssued>();
        Assert.Equal(new RefundIssued(orderId, 5900, 5400), refund);
    }

    [Fact]
    public async Task A_cancellation_before_confirmation_moves_no_money()
    {
        var orderId = Guid.NewGuid();
        await Handle(Placed(orderId, ("MOUSE-01", 1, 29.50m)));
        await Handle(Cancelled(orderId));

        Assert.Equal(SettlementStatus.Cancelled, (await Settlement(orderId)).Status);
        Assert.Empty(await Emitted());
    }

    [Fact]
    public async Task A_redelivered_confirmation_does_not_charge_twice()
    {
        var orderId = Guid.NewGuid();
        var placed = Placed(orderId, ("MONITOR-27", 1, 299m));
        var confirmed = Confirmed(orderId);
        await Handle(placed);
        await Handle(confirmed);
        await Handle(confirmed);

        var captures = (await Emitted()).Where(e => e.EventType == PaymentCaptured.EventType).ToList();
        Assert.Single(captures);
    }

    [Fact]
    public async Task A_confirmation_for_an_unseen_order_is_not_invented()
    {
        await Handle(Confirmed(Guid.NewGuid()));
        Assert.Empty(await Emitted());
    }
}
