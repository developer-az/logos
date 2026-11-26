using System.Net;
using System.Net.Http.Json;
using Microsoft.EntityFrameworkCore;
using OrderPlatform.Contracts;
using Procurement.Service.Api;

namespace Procurement.Service.Tests;

public sealed class ProcurementApiTests(ProcurementApiFactory factory) : IClassFixture<ProcurementApiFactory>
{
    private readonly HttpClient _client = factory.CreateClient();

    [Fact]
    public async Task Suppliers_lists_a_quote_per_supplier_for_every_catalogue_sku()
    {
        var quotes = await _client.GetFromJsonAsync<List<QuoteResponse>>("/procurement/suppliers");

        Assert.Equal(15, quotes!.Count);
        Assert.Equal(5, quotes.Select(q => q.Sku).Distinct().Count());
        Assert.All(quotes.GroupBy(q => q.Sku), group => Assert.Equal(3, group.Count()));
        var cheapest = quotes.Where(q => q.Sku == "MONITOR-27").OrderBy(q => q.UnitCostCents).First();
        Assert.Equal("vertex", cheapest.SupplierId);
    }

    [Fact]
    public async Task Placing_an_order_publishes_the_event_in_the_same_transaction()
    {
        var response = await _client.PostAsJsonAsync("/procurement/purchase-orders",
            new PurchaseOrderRequest("WEBCAM-HD", "kiloparts", 12));

        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        var order = await response.Content.ReadFromJsonAsync<PurchaseOrderResponse>();
        Assert.NotNull(order);
        Assert.Equal(("WEBCAM-HD", "Kilo Parts", 12, "InTransit"),
            (order.Sku, order.SupplierName, order.Quantity, order.Status));

        await using var db = factory.NewContext();
        Assert.Equal(1, await db.PurchaseOrders.CountAsync(p => p.Id == order.Id));
        var envelope = EventEnvelope.Deserialize(await db.OutboxMessages
            .Where(m => m.Key == "WEBCAM-HD" && m.EventType == PurchaseOrderPlaced.EventType)
            .Select(m => m.Body)
            .SingleAsync());
        var placed = envelope.PayloadAs<PurchaseOrderPlaced>();
        Assert.Equal((order.Id, 12, "kiloparts"), (placed.PurchaseOrderId, placed.Quantity, placed.SupplierId));
    }

    [Fact]
    public async Task An_order_below_the_supplier_minimum_is_refused()
    {
        var response = await _client.PostAsJsonAsync("/procurement/purchase-orders",
            new PurchaseOrderRequest("MONITOR-27", "vertex", 2));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task An_unknown_supplier_is_refused()
    {
        var response = await _client.PostAsJsonAsync("/procurement/purchase-orders",
            new PurchaseOrderRequest("MOUSE-01", "nobody", 10));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }
}
