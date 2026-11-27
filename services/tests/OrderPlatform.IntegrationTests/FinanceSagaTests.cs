using System.Net.Http.Json;
using Finance.Service.Api;
using Inventory.Service.Api;
using Order.Service.Api;

namespace OrderPlatform.IntegrationTests;

/// <summary>Order outcomes → finance events, over real Kafka and PostgreSQL.</summary>
[Collection(PlatformCollection.Name)]
public sealed class FinanceSagaTests(PlatformFixture platform)
{
    private static readonly TimeSpan Timeout = TimeSpan.FromSeconds(60);
    private const string Sku = "MOUSE-01";

    private static async Task<SettlementResponse> Eventually(
        Func<Task<SettlementResponse?>> read, Func<SettlementResponse, bool> done, string what)
    {
        var deadline = DateTime.UtcNow + Timeout;
        SettlementResponse? value;
        while ((value = await read()) is null || !done(value))
        {
            if (DateTime.UtcNow > deadline) Assert.Fail($"Timed out waiting for {what}");
            await Task.Delay(100);
        }
        return value;
    }

    private async Task<OrderResponse> Place(int quantity)
    {
        (await platform.Inventory.PutAsJsonAsync($"/inventory/{Sku}", new SetStockRequest(100)))
            .EnsureSuccessStatusCode();
        var response = await platform.Orders.PostAsJsonAsync("/orders",
            new PlaceOrderRequest("customer-money", [new PlaceOrderLine(Sku, quantity, 29.50m)]));
        response.EnsureSuccessStatusCode();
        return (await response.Content.ReadFromJsonAsync<OrderResponse>())!;
    }

    private Task<SettlementResponse> Settlement(Guid orderId, Func<SettlementResponse, bool> done, string what) =>
        Eventually(async () =>
        {
            var response = await platform.Finance.GetAsync($"/finance/settlements/{orderId}");
            return response.IsSuccessStatusCode
                ? await response.Content.ReadFromJsonAsync<SettlementResponse>()
                : null;
        }, done, what);

    [DockerFact]
    public async Task A_confirmed_order_is_captured_with_its_standard_cost()
    {
        var order = await Place(2);

        var settlement = await Settlement(order.Id, s => s.Status == "Captured", "the capture");

        Assert.Equal(5900, settlement.AmountCents); // 2 × $29.50
        Assert.Equal(3600, settlement.CostCents);   // 2 × $18.00 standard cost
        Assert.Equal(2300, settlement.MarginCents);
    }

    [DockerFact]
    public async Task Cancelling_a_captured_order_refunds_it()
    {
        var order = await Place(1);
        await Settlement(order.Id, s => s.Status == "Captured", "the capture");

        (await platform.Orders.PostAsJsonAsync($"/orders/{order.Id}/cancel", new { reason = "test" }))
            .EnsureSuccessStatusCode();

        var refunded = await Settlement(order.Id, s => s.Status == "Refunded", "the refund");
        Assert.Equal(2950, refunded.AmountCents);
        Assert.Equal(1800, refunded.CostCents);
    }

    [DockerFact]
    public async Task The_summary_agrees_with_its_settlements()
    {
        var summary = await platform.Finance.GetFromJsonAsync<FinanceSummary>("/finance/summary");

        Assert.NotNull(summary);
        Assert.True(summary.Captured >= summary.Refunded);
        Assert.Equal(summary.CapturedCents - summary.RefundedCents - summary.CogsCents, summary.MarginCents);
    }
}
