using System.Net;
using System.Net.Http.Json;
using Inventory.Service.Api;
using Procurement.Service.Api;

namespace OrderPlatform.IntegrationTests;

/// <summary>HTTP → procurement outbox → Kafka → inventory → Kafka, over real brokers and databases.</summary>
[Collection(PlatformCollection.Name)]
public sealed class ProcurementSagaTests(PlatformFixture platform)
{
    private static readonly TimeSpan Timeout = TimeSpan.FromSeconds(60);
    private const string Sku = "USB-C-HUB";

    private static async Task<T> Eventually<T>(Func<Task<T>> read, Func<T, bool> done, string what)
    {
        var deadline = DateTime.UtcNow + Timeout;
        T value;
        while (!done(value = await read()))
        {
            if (DateTime.UtcNow > deadline) Assert.Fail($"Timed out waiting for {what}; last value: {value}");
            await Task.Delay(100);
        }
        return value;
    }

    [DockerFact]
    public async Task A_purchase_order_restocks_inventory_when_the_goods_arrive()
    {
        (await platform.Inventory.PutAsJsonAsync($"/inventory/{Sku}", new SetStockRequest(0)))
            .EnsureSuccessStatusCode();

        var created = await platform.Procurement.PostAsJsonAsync("/procurement/purchase-orders",
            new PurchaseOrderRequest(Sku, "kiloparts", 12));
        Assert.Equal(HttpStatusCode.Created, created.StatusCode);
        var order = (await created.Content.ReadFromJsonAsync<PurchaseOrderResponse>())!;
        Assert.Equal((Sku, 12, "InTransit"), (order.Sku, order.Quantity, order.Status));

        var received = await Eventually(
            async () => (await platform.Procurement.GetFromJsonAsync<PurchaseOrderResponse>($"/procurement/purchase-orders/{order.Id}"))!,
            p => p.Status == "Received", "the goods receipt");
        Assert.NotNull(received.ReceivedAt);

        // Procurement never wrote stock: inventory applied the receipt event.
        var stock = await Eventually(
            async () => (await platform.Inventory.GetFromJsonAsync<StockResponse>($"/inventory/{Sku}"))!,
            s => s.OnHand >= 12, "inventory to be restocked");
        Assert.Equal(12, stock.OnHand);
    }

    [DockerFact]
    public async Task The_catalogue_seeds_three_quotes_per_sku()
    {
        var quotes = await platform.Procurement.GetFromJsonAsync<List<QuoteResponse>>("/procurement/suppliers");

        Assert.Equal(15, quotes!.Count);
        Assert.Equal(5, quotes.Select(q => q.Sku).Distinct().Count());
        Assert.All(quotes.GroupBy(q => q.Sku), group => Assert.Equal(3, group.Count()));
    }
}
