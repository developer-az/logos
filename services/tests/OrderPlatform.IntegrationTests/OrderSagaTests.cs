using System.Net;
using System.Net.Http.Json;
using Confluent.Kafka;
using Inventory.Service.Api;
using Order.Service.Api;
using OrderPlatform.Contracts;

namespace OrderPlatform.IntegrationTests;

/// <summary>End-to-end: HTTP → Postgres outbox → Kafka → other service → Kafka → back.</summary>
[Collection(PlatformCollection.Name)]
public sealed class OrderSagaTests(PlatformFixture platform)
{
    private static readonly TimeSpan Timeout = TimeSpan.FromSeconds(60);

    private static string NewSku() => ("IT-" + Guid.NewGuid().ToString("N")[..8]).ToUpperInvariant();

    private async Task SetStock(string sku, int onHand) =>
        (await platform.Inventory.PutAsJsonAsync($"/inventory/{sku}", new SetStockRequest(onHand))).EnsureSuccessStatusCode();

    private async Task<OrderResponse> Place(string sku, int quantity)
    {
        var response = await platform.Orders.PostAsJsonAsync("/orders",
            new PlaceOrderRequest("customer-it", [new PlaceOrderLine(sku, quantity, 10m)]));
        Assert.Equal(HttpStatusCode.Accepted, response.StatusCode);
        return (await response.Content.ReadFromJsonAsync<OrderResponse>())!;
    }

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

    private Task<OrderResponse> OrderInStatus(Guid id, string status) => Eventually(
        async () => (await platform.Orders.GetFromJsonAsync<OrderResponse>($"/orders/{id}"))!, o => o.Status == status, $"order {id} to be {status}");

    private Task<StockResponse> Stock(string sku, Func<StockResponse, bool> done) => Eventually(
        async () => (await platform.Inventory.GetFromJsonAsync<StockResponse>($"/inventory/{sku}"))!, done, $"stock of {sku}");

    [DockerFact]
    public async Task An_order_with_stock_is_confirmed_and_holds_the_stock()
    {
        var sku = NewSku();
        await SetStock(sku, 5);

        var order = await Place(sku, 2);

        await OrderInStatus(order.Id, "Confirmed");
        var stock = await Stock(sku, _ => true);
        Assert.Equal((5, 2, 3), (stock.OnHand, stock.Reserved, stock.Available));
    }

    [DockerFact]
    public async Task An_order_without_enough_stock_is_rejected_and_holds_nothing()
    {
        var sku = NewSku();
        await SetStock(sku, 1);

        var order = await Place(sku, 2);

        var rejected = await OrderInStatus(order.Id, "Rejected");
        Assert.Contains($"{sku} (requested 2, available 1)", rejected.StatusReason);
        Assert.Equal(0, (await Stock(sku, _ => true)).Reserved);
    }

    [DockerFact]
    public async Task Cancelling_a_confirmed_order_returns_its_stock_and_the_event_chain_shares_one_correlation_id()
    {
        var sku = NewSku();
        await SetStock(sku, 3);
        var order = await Place(sku, 3);
        await OrderInStatus(order.Id, "Confirmed");

        (await platform.Orders.PostAsJsonAsync($"/orders/{order.Id}/cancel", new CancelOrderRequest("test"))).EnsureSuccessStatusCode();

        await Stock(sku, s => s.Reserved == 0 && s.Available == 3);

        var chain = ReadEvents(order.Id.ToString(), expected: 5);
        Assert.Equal(
            [OrderPlaced.EventType, StockReserved.EventType, OrderConfirmed.EventType, OrderCancelled.EventType, StockReleased.EventType],
            chain.OrderBy(e => e.OccurredAt).Select(e => e.EventType));
        Assert.All(chain, e => Assert.Equal(order.CorrelationId, e.CorrelationId));
    }

    [DockerFact]
    public async Task Concurrent_orders_never_oversell()
    {
        var sku = NewSku();
        await SetStock(sku, 10);

        var orders = await Task.WhenAll(Enumerable.Range(0, 25).Select(_ => Place(sku, 1)));

        var final = await Task.WhenAll(orders.Select(o => Eventually(
            async () => (await platform.Orders.GetFromJsonAsync<OrderResponse>($"/orders/{o.Id}"))!,
            r => r.Status != "Pending", $"order {o.Id} to settle")));
        Assert.Equal(10, final.Count(o => o.Status == "Confirmed"));
        Assert.Equal(15, final.Count(o => o.Status == "Rejected"));
        var stock = await Stock(sku, _ => true);
        Assert.Equal((10, 10, 0), (stock.OnHand, stock.Reserved, stock.Available));
    }

    /// <summary>Reads both topics from the start as an independent consumer, as the dashboard would.</summary>
    private List<EventEnvelope> ReadEvents(string key, int expected)
    {
        using var consumer = new ConsumerBuilder<string, string>(new ConsumerConfig
        {
            BootstrapServers = platform.BootstrapServers,
            GroupId = "it-reader-" + Guid.NewGuid(),
            AutoOffsetReset = AutoOffsetReset.Earliest,
            EnableAutoCommit = false,
        }).Build();
        consumer.Subscribe([Topics.OrderEvents, Topics.InventoryEvents]);

        var events = new List<EventEnvelope>();
        var deadline = DateTime.UtcNow + Timeout;
        while (events.Count < expected && DateTime.UtcNow < deadline)
        {
            var result = consumer.Consume(TimeSpan.FromMilliseconds(500));
            if (result?.Message.Key == key) events.Add(EventEnvelope.Deserialize(result.Message.Value));
        }
        consumer.Close();
        return events;
    }
}
