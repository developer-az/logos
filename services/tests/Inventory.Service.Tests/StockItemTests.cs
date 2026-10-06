using Inventory.Service.Domain;

namespace Inventory.Service.Tests;

public class StockItemTests
{
    private static readonly DateTimeOffset Now = DateTimeOffset.UnixEpoch;

    [Fact]
    public void Reserving_and_releasing_moves_units_between_available_and_reserved()
    {
        var item = StockItem.Create(" mouse-01 ", 10, Now);
        Assert.Equal("MOUSE-01", item.Sku);

        item.Reserve(7, Now);
        Assert.Equal((10, 7, 3), (item.OnHand, item.Reserved, item.Available));

        item.Release(4, Now);
        Assert.Equal((10, 3, 7), (item.OnHand, item.Reserved, item.Available));
    }

    [Fact]
    public void Cannot_reserve_more_than_available()
    {
        var item = StockItem.Create("A", 5, Now);
        item.Reserve(5, Now);

        Assert.Throws<DomainException>(() => item.Reserve(1, Now));
        Assert.Equal(0, item.Available);
    }

    [Fact]
    public void On_hand_cannot_drop_below_what_is_reserved()
    {
        var item = StockItem.Create("A", 5, Now);
        item.Reserve(3, Now);

        Assert.Throws<DomainException>(() => item.SetOnHand(2, Now));
        item.SetOnHand(3, Now);
        Assert.Equal(0, item.Available);
    }

    [Theory]
    [InlineData(0)]
    [InlineData(-1)]
    public void Quantities_must_be_positive(int quantity)
    {
        var item = StockItem.Create("A", 5, Now);
        Assert.Throws<DomainException>(() => item.Reserve(quantity, Now));
        Assert.Throws<DomainException>(() => item.Release(quantity, Now));
    }

    [Fact]
    public void Every_change_rotates_the_concurrency_token()
    {
        var item = StockItem.Create("A", 5, Now);
        var before = item.Version;
        item.Reserve(1, Now);
        Assert.NotEqual(before, item.Version);
    }
}
