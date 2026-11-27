using Finance.Service.Domain;

namespace Finance.Service.Tests;

public sealed class SettlementTests
{
    private static readonly DateTimeOffset Now = new(2026, 11, 26, 12, 0, 0, TimeSpan.Zero);

    [Fact]
    public void An_order_is_captured_once_and_refunded_once()
    {
        var settlement = OrderSettlement.Create(Guid.NewGuid(), 5900, 5400, Now);

        Assert.Equal(SettlementStatus.Pending, settlement.Status);
        Assert.True(settlement.Capture(Now));
        Assert.False(settlement.Capture(Now));
        Assert.Equal(SettlementStatus.Captured, settlement.Status);

        Assert.True(settlement.Refund(Now));
        Assert.False(settlement.Refund(Now));
        Assert.Equal(SettlementStatus.Refunded, settlement.Status);
    }

    [Fact]
    public void Cancelling_before_confirmation_moves_no_money()
    {
        var settlement = OrderSettlement.Create(Guid.NewGuid(), 5900, 5400, Now);

        Assert.False(settlement.Refund(Now));

        Assert.Equal(SettlementStatus.Cancelled, settlement.Status);
        Assert.False(settlement.Capture(Now));
        Assert.Equal(SettlementStatus.Cancelled, settlement.Status);
    }

    [Fact]
    public void Negative_amounts_are_refused()
    {
        Assert.Throws<DomainException>(() => OrderSettlement.Create(Guid.NewGuid(), -1, 0, Now));
        Assert.Throws<DomainException>(() => OrderSettlement.Create(Guid.NewGuid(), 100, -1, Now));
    }
}
