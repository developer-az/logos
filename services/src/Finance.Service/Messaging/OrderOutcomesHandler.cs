using Finance.Service.Data;
using Finance.Service.Domain;
using Microsoft.EntityFrameworkCore;
using OrderPlatform.Contracts;
using OrderPlatform.Messaging;
using OrderPlatform.Messaging.Inbox;
using OrderPlatform.Messaging.Outbox;

namespace Finance.Service.Messaging;

/// <summary>
/// Turns order outcomes into money. Every order is described from <c>order.placed</c>, captured on
/// <c>order.confirmed</c> and reversed on <c>order.cancelled</c>; a cancellation before confirmation
/// moves nothing. Events are keyed by order id, so the three arrive in order.
/// </summary>
public sealed class OrderOutcomesHandler(FinanceDbContext db, TimeProvider clock, ILogger<OrderOutcomesHandler> logger)
    : IMessageHandler
{
    public const string ConsumerName = "finance-service";

    public async Task HandleAsync(EventEnvelope envelope, CancellationToken ct)
    {
        Func<Task>? handle = envelope.EventType switch
        {
            var t when t == OrderPlaced.EventType => () => DescribeAsync(envelope, envelope.PayloadAs<OrderPlaced>(), ct),
            var t when t == OrderConfirmed.EventType => () => CaptureAsync(envelope, envelope.PayloadAs<OrderConfirmed>(), ct),
            var t when t == OrderCancelled.EventType => () => ReverseAsync(envelope, envelope.PayloadAs<OrderCancelled>(), ct),
            _ => null,
        };
        if (handle is null) return;
        if (await db.HasProcessedAsync(envelope, ConsumerName, ct)) return;

        await handle();

        db.MarkProcessed(envelope, ConsumerName, clock);
        await db.SaveChangesAsync(ct);
    }

    private async Task DescribeAsync(EventEnvelope cause, OrderPlaced placed, CancellationToken ct)
    {
        var now = clock.GetUtcNow();
        var amount = ToCents(placed.Total);
        var cost = 0;
        foreach (var line in placed.Lines)
        {
            if (!StandardCosts.Knows(line.Sku))
                logger.LogWarning("No standard cost for {Sku}; its cost of goods counts as zero", line.Sku);
            cost += line.Quantity * StandardCosts.For(line.Sku);
        }

        var existing = await db.Settlements.SingleOrDefaultAsync(s => s.OrderId == placed.OrderId, ct);
        if (existing is null)
            db.Settlements.Add(OrderSettlement.Create(placed.OrderId, amount, cost, now));
        else
            existing.Describe(amount, cost, now);
    }

    private async Task CaptureAsync(EventEnvelope cause, OrderConfirmed confirmed, CancellationToken ct)
    {
        var settlement = await db.Settlements.SingleOrDefaultAsync(s => s.OrderId == confirmed.OrderId, ct);
        if (settlement is null)
        {
            // Started mid-stream or the placement was dead-lettered: do not invent a charge.
            logger.LogWarning("Order {OrderId} was confirmed but finance never saw it placed; not charging", confirmed.OrderId);
            return;
        }
        if (!settlement.Capture(clock.GetUtcNow())) return;

        db.Enqueue(Topics.FinanceEvents, settlement.OrderId.ToString(),
            new PaymentCaptured(settlement.OrderId, settlement.AmountCents, settlement.CostCents),
            cause.CorrelationId, cause.EventId, clock);
    }

    private async Task ReverseAsync(EventEnvelope cause, OrderCancelled cancelled, CancellationToken ct)
    {
        var settlement = await db.Settlements.SingleOrDefaultAsync(s => s.OrderId == cancelled.OrderId, ct);
        if (settlement is null)
        {
            logger.LogInformation("Order {OrderId} was cancelled before finance saw it placed; nothing to reverse", cancelled.OrderId);
            return;
        }
        if (!settlement.Refund(clock.GetUtcNow())) return;

        db.Enqueue(Topics.FinanceEvents, settlement.OrderId.ToString(),
            new RefundIssued(settlement.OrderId, settlement.AmountCents, settlement.CostCents),
            cause.CorrelationId, cause.EventId, clock);
    }

    /// <summary>Decimal currency to integer cents, without float drift.</summary>
    internal static int ToCents(decimal amount) =>
        (int)Math.Round(amount * 100m, MidpointRounding.AwayFromZero);
}
