using System.Net;
using System.Net.Http.Json;
using Finance.Service.Api;
using Finance.Service.Domain;

namespace Finance.Service.Tests;

public sealed class FinanceApiTests
{
    [Fact]
    public async Task Summary_sums_captures_and_refunds_and_states_the_margin()
    {
        using var factory = new FinanceApiFactory();
        var capturedOrder = Guid.NewGuid();
        var refundedOrder = Guid.NewGuid();
        var pendingOrder = Guid.NewGuid();

        await using (var db = factory.NewContext())
        {
            var now = DateTimeOffset.UtcNow;
            var captured = OrderSettlement.Create(capturedOrder, 10000, 6000, now);
            captured.Capture(now);
            var refunded = OrderSettlement.Create(refundedOrder, 5000, 3000, now);
            refunded.Capture(now);
            refunded.Refund(now);
            db.Settlements.AddRange(captured, refunded, OrderSettlement.Create(pendingOrder, 1000, 500, now));
            await db.SaveChangesAsync();
        }

        var summary = await factory.CreateClient().GetFromJsonAsync<FinanceSummary>("/finance/summary");

        Assert.NotNull(summary);
        Assert.Equal(15000, summary.CapturedCents); // both captures
        Assert.Equal(5000, summary.RefundedCents);
        Assert.Equal(6000, summary.CogsCents);      // 6000 kept, 3000 reversed
        Assert.Equal(4000, summary.MarginCents);    // 10000 net revenue - 6000 cost
        Assert.Equal(1, summary.Pending);
        Assert.Equal(1, summary.Captured);
        Assert.Equal(1, summary.Refunded);
    }

    [Fact]
    public async Task A_settlement_can_be_read_by_order_id()
    {
        using var factory = new FinanceApiFactory();
        var orderId = Guid.NewGuid();
        await using (var db = factory.NewContext())
        {
            db.Settlements.Add(OrderSettlement.Create(orderId, 5900, 5400, DateTimeOffset.UtcNow));
            await db.SaveChangesAsync();
        }

        var settlement = await factory.CreateClient().GetFromJsonAsync<SettlementResponse>($"/finance/settlements/{orderId}");
        Assert.NotNull(settlement);
        Assert.Equal((5900, 5400, 500, "Pending"),
            (settlement.AmountCents, settlement.CostCents, settlement.MarginCents, settlement.Status));

        var missing = await factory.CreateClient().GetAsync($"/finance/settlements/{Guid.NewGuid()}");
        Assert.Equal(HttpStatusCode.NotFound, missing.StatusCode);
    }
}
