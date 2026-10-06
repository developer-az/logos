using Order.Service.Domain;

namespace Order.Service.Tests;

public class OrderTests
{
    private static readonly DateTimeOffset Now = new(2026, 10, 6, 12, 0, 0, TimeSpan.Zero);

    private static Domain.Order Place(params OrderItem[] items) =>
        Domain.Order.Place(Guid.NewGuid(), "customer-1", items, Guid.NewGuid(), null, Now);

    private static OrderItem Item(string sku, int qty, decimal price) => new() { Sku = sku, Quantity = qty, UnitPrice = price };

    [Fact]
    public void Placing_merges_repeated_skus_and_computes_the_total()
    {
        var order = Place(Item("sku-1", 2, 10m), Item(" SKU-1 ", 1, 10m), Item("SKU-2", 3, 2.50m));

        Assert.Equal(OrderStatus.Pending, order.Status);
        Assert.Collection(order.Items,
            i => { Assert.Equal("SKU-1", i.Sku); Assert.Equal(3, i.Quantity); },
            i => { Assert.Equal("SKU-2", i.Sku); Assert.Equal(3, i.Quantity); });
        Assert.Equal(37.50m, order.Total);
    }

    public static TheoryData<OrderItem[], string> InvalidOrders => new()
    {
        { [], "At least one line" },
        { [Item("", 1, 1m)], "needs a sku" },
        { [Item("A", 0, 1m)], "must be positive" },
        { [Item("A", 1, -1m)], "cannot be negative" },
        { [Item("A", 1, 1m), Item("a", 1, 2m)], "different unit prices" },
        { [Item("A", Domain.Order.MaxQuantityPerLine, 1m), Item("A", 1, 1m)], "exceeds" },
    };

    [Theory]
    [MemberData(nameof(InvalidOrders))]
    public void Placing_rejects_invalid_lines(OrderItem[] items, string expected)
    {
        var ex = Assert.Throws<DomainException>(() => Place(items));
        Assert.Contains(expected, ex.Message);
    }

    [Fact]
    public void Placing_requires_a_customer()
    {
        Assert.Throws<DomainException>(() => Domain.Order.Place(Guid.NewGuid(), " ", [Item("A", 1, 1m)], Guid.NewGuid(), null, Now));
    }

    [Fact]
    public void A_pending_order_can_be_confirmed_then_cancelled()
    {
        var order = Place(Item("A", 1, 1m));
        var v0 = order.Version;

        order.Confirm(Now.AddSeconds(1));
        Assert.Equal(OrderStatus.Confirmed, order.Status);
        Assert.NotEqual(v0, order.Version);

        order.Cancel("changed my mind", Now.AddSeconds(2));
        Assert.Equal(OrderStatus.Cancelled, order.Status);
        Assert.Equal("changed my mind", order.StatusReason);
        Assert.Equal(Now.AddSeconds(2), order.UpdatedAt);
    }

    [Fact]
    public void Rejected_and_cancelled_orders_are_terminal()
    {
        var rejected = Place(Item("A", 1, 1m));
        rejected.Reject("no stock", Now);
        Assert.Throws<DomainException>(() => rejected.Cancel(null, Now));
        Assert.Throws<DomainException>(() => rejected.Confirm(Now));

        var cancelled = Place(Item("A", 1, 1m));
        cancelled.Cancel(null, Now);
        Assert.Throws<DomainException>(() => cancelled.Confirm(Now));
        Assert.Throws<DomainException>(() => cancelled.Reject("x", Now));
    }
}
