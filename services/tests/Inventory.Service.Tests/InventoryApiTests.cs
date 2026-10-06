using System.Net;
using System.Net.Http.Json;
using Inventory.Service.Api;
using Inventory.Service.Domain;
using Microsoft.EntityFrameworkCore;
using OrderPlatform.Contracts;

namespace Inventory.Service.Tests;

public sealed class InventoryApiTests(InventoryApiFactory factory) : IClassFixture<InventoryApiFactory>
{
    private readonly HttpClient _client = factory.CreateClient();

    [Fact]
    public async Task Setting_stock_creates_the_sku_and_publishes_its_level()
    {
        var sku = ("SKU-" + Guid.NewGuid().ToString("N")[..8]).ToUpperInvariant();

        var response = await _client.PutAsJsonAsync($"/inventory/{sku.ToLowerInvariant()}", new SetStockRequest(25));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var stock = await _client.GetFromJsonAsync<StockResponse>($"/inventory/{sku}");
        Assert.Equal((25, 0, 25), (stock!.OnHand, stock.Reserved, stock.Available));

        await using var db = factory.NewContext();
        var level = EventEnvelope.Deserialize((await db.OutboxMessages.SingleAsync(m => m.Key == sku)).Body).PayloadAs<StockLevelChanged>();
        Assert.Equal(new StockLevelChanged(sku, 25, 0, 25, 1), level);
    }

    [Fact]
    public async Task Stock_cannot_be_set_below_what_is_reserved()
    {
        await using (var db = factory.NewContext())
        {
            var item = StockItem.Create("RESERVED-1", 5, DateTimeOffset.UtcNow);
            item.Reserve(4, DateTimeOffset.UtcNow);
            db.StockItems.Add(item);
            await db.SaveChangesAsync();
        }

        var response = await _client.PutAsJsonAsync("/inventory/RESERVED-1", new SetStockRequest(3));

        Assert.Equal(HttpStatusCode.Conflict, response.StatusCode);
    }

    [Fact]
    public async Task Unknown_skus_and_reservations_return_404()
    {
        Assert.Equal(HttpStatusCode.NotFound, (await _client.GetAsync("/inventory/NOPE")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await _client.GetAsync($"/reservations/{Guid.NewGuid()}")).StatusCode);
    }
}
