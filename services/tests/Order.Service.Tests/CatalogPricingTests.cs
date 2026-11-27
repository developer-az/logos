using System.Net;
using System.Net.Http.Json;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.Extensions.Options;
using Order.Service.Api;
using Order.Service.Catalog;

namespace Order.Service.Tests;

/// <summary>The order service prices from the catalogue when one is configured.</summary>
public sealed class CatalogPricingTests
{
    private sealed class StubFactory(HttpMessageHandler handler) : IHttpClientFactory
    {
        public HttpClient CreateClient(string name) => new(handler, disposeHandler: false);
    }

    private sealed class Handler(Func<HttpRequestMessage, HttpResponseMessage> respond) : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct) =>
            Task.FromResult(respond(request));
    }

    private sealed class PriceFromCatalogueFactory(HttpMessageHandler handler) : OrderApiFactory
    {
        protected override void ConfigureAdditionalServices(IServiceCollection services)
        {
            services.Configure<CatalogOptions>(o => o.BaseUrl = "http://catalog");
            services.RemoveAll<IHttpClientFactory>();
            services.AddSingleton<IHttpClientFactory>(new StubFactory(handler));
        }
    }

    private static HttpResponseMessage Catalogue(params (string Sku, int Cents)[] products) =>
        new(HttpStatusCode.OK)
        {
            Content = JsonContent.Create(products.Select(p => new { sku = p.Sku, name = p.Sku, priceCents = p.Cents })),
        };

    private static Task<HttpResponseMessage> Place(HttpClient client, params PlaceOrderLine[] lines) =>
        client.PostAsJsonAsync("/orders", new PlaceOrderRequest("customer-catalog", lines));

    [Fact]
    public async Task The_catalogue_price_replaces_what_the_client_sent()
    {
        using var factory = new PriceFromCatalogueFactory(new Handler(_ => Catalogue(("MOUSE-01", 2950))));
        var client = factory.CreateClient();

        var response = await Place(client, new PlaceOrderLine("MOUSE-01", 2, 0.01m));

        response.EnsureSuccessStatusCode();
        var order = await response.Content.ReadFromJsonAsync<OrderResponse>();
        Assert.Equal(59.00m, order!.Total);
        Assert.Equal(29.50m, order.Lines.Single().UnitPrice);
    }

    [Fact]
    public async Task A_sku_the_catalogue_does_not_sell_is_refused()
    {
        using var factory = new PriceFromCatalogueFactory(new Handler(_ => Catalogue(("MOUSE-01", 2950))));
        var client = factory.CreateClient();

        var response = await Place(client, new PlaceOrderLine("GOLD-BAR", 1, 1m));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Contains("Not in the catalogue", await response.Content.ReadAsStringAsync());
    }

    [Fact]
    public async Task An_unreachable_catalogue_refuses_the_order_instead_of_trusting_the_client()
    {
        using var factory = new PriceFromCatalogueFactory(
            new Handler(_ => throw new HttpRequestException("connection refused")));
        var client = factory.CreateClient();

        var response = await Place(client, new PlaceOrderLine("MOUSE-01", 1, 5m));

        Assert.Equal(HttpStatusCode.ServiceUnavailable, response.StatusCode);
        Assert.Contains("Pricing is unavailable", await response.Content.ReadAsStringAsync());
    }
}
