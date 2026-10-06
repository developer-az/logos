using System.Net;
using System.Net.Http.Json;
using Microsoft.EntityFrameworkCore;
using Order.Service.Api;
using OrderPlatform.Contracts;

namespace Order.Service.Tests;

public sealed class OrderApiTests : IClassFixture<OrderApiFactory>
{
    private readonly OrderApiFactory _factory;
    private readonly HttpClient _client;

    public OrderApiTests(OrderApiFactory factory)
    {
        _factory = factory;
        _client = factory.CreateClient();
    }

    private static PlaceOrderRequest ValidRequest() => new("customer-42", [new PlaceOrderLine("KEYBOARD-01", 2, 49.99m)]);

    private async Task<OrderResponse> PlaceAsync(PlaceOrderRequest? request = null)
    {
        var response = await _client.PostAsJsonAsync("/orders", request ?? ValidRequest());
        Assert.Equal(HttpStatusCode.Accepted, response.StatusCode);
        return (await response.Content.ReadFromJsonAsync<OrderResponse>())!;
    }

    [Fact]
    public async Task Placing_an_order_returns_202_and_stages_OrderPlaced_in_the_outbox()
    {
        var response = await _client.PostAsJsonAsync("/orders", ValidRequest());

        Assert.Equal(HttpStatusCode.Accepted, response.StatusCode);
        var order = (await response.Content.ReadFromJsonAsync<OrderResponse>())!;
        Assert.Equal($"/orders/{order.Id}", response.Headers.Location!.ToString());
        Assert.Equal("Pending", order.Status);
        Assert.Equal(99.98m, order.Total);

        await using var db = _factory.NewContext();
        var staged = await db.OutboxMessages.SingleAsync(m => m.Key == order.Id.ToString());
        var placed = EventEnvelope.Deserialize(staged.Body).PayloadAs<OrderPlaced>();
        Assert.Equal(Topics.OrderEvents, staged.Topic);
        Assert.Equal(order.Id, placed.OrderId);
        Assert.Equal([new OrderLine("KEYBOARD-01", 2, 49.99m)], placed.Lines);
    }

    [Fact]
    public async Task Invalid_orders_are_rejected_with_400()
    {
        var response = await _client.PostAsJsonAsync("/orders", new PlaceOrderRequest("c", [new PlaceOrderLine("A", 0, 1m)]));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Contains("must be positive", await response.Content.ReadAsStringAsync());
    }

    [Fact]
    public async Task Repeating_a_request_with_the_same_idempotency_key_returns_the_original_order()
    {
        var key = Guid.NewGuid().ToString();
        HttpRequestMessage Request() => new(HttpMethod.Post, "/orders")
        {
            Content = JsonContent.Create(ValidRequest()),
            Headers = { { OrderEndpoints.IdempotencyHeader, key } },
        };

        var first = await _client.SendAsync(Request());
        var second = await _client.SendAsync(Request());

        Assert.Equal(HttpStatusCode.Accepted, first.StatusCode);
        Assert.Equal(HttpStatusCode.OK, second.StatusCode);
        var a = (await first.Content.ReadFromJsonAsync<OrderResponse>())!;
        var b = (await second.Content.ReadFromJsonAsync<OrderResponse>())!;
        Assert.Equal(a.Id, b.Id);

        await using var db = _factory.NewContext();
        Assert.Equal(1, await db.OutboxMessages.CountAsync(m => m.Key == a.Id.ToString()));
    }

    [Fact]
    public async Task Getting_an_order_returns_it_and_unknown_ids_return_404()
    {
        var placed = await PlaceAsync();

        var fetched = await _client.GetFromJsonAsync<OrderResponse>($"/orders/{placed.Id}");
        Assert.Equal(placed.Id, fetched!.Id);
        Assert.Equal(HttpStatusCode.NotFound, (await _client.GetAsync($"/orders/{Guid.NewGuid()}")).StatusCode);
    }

    [Fact]
    public async Task Cancelling_emits_OrderCancelled_and_a_second_cancel_conflicts()
    {
        var placed = await PlaceAsync();

        var cancel = await _client.PostAsJsonAsync($"/orders/{placed.Id}/cancel", new CancelOrderRequest("duplicate"));
        Assert.Equal(HttpStatusCode.OK, cancel.StatusCode);
        Assert.Equal("Cancelled", (await cancel.Content.ReadFromJsonAsync<OrderResponse>())!.Status);

        var again = await _client.PostAsJsonAsync($"/orders/{placed.Id}/cancel", new CancelOrderRequest(null));
        Assert.Equal(HttpStatusCode.Conflict, again.StatusCode);

        await using var db = _factory.NewContext();
        var types = await db.OutboxMessages.Where(m => m.Key == placed.Id.ToString()).OrderBy(m => m.Id).Select(m => m.EventType).ToListAsync();
        Assert.Equal([OrderPlaced.EventType, OrderCancelled.EventType], types);
    }

    [Fact]
    public async Task Listing_filters_by_status()
    {
        var placed = await PlaceAsync();
        await _client.PostAsJsonAsync($"/orders/{placed.Id}/cancel", new CancelOrderRequest(null));

        var cancelled = await _client.GetFromJsonAsync<List<OrderResponse>>("/orders?status=cancelled");
        Assert.Contains(cancelled!, o => o.Id == placed.Id);
        Assert.All(cancelled!, o => Assert.Equal("Cancelled", o.Status));
        Assert.Equal(HttpStatusCode.BadRequest, (await _client.GetAsync("/orders?status=bogus")).StatusCode);
    }

    [Fact]
    public async Task Liveness_probe_is_healthy()
    {
        Assert.Equal(HttpStatusCode.OK, (await _client.GetAsync("/health/live")).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await _client.GetAsync("/health/ready")).StatusCode);
    }
}
