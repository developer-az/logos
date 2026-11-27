using System.Net;
using System.Net.Http.Json;
using Catalog.Service.Api;
using Catalog.Service.Domain;

namespace Catalog.Service.Tests;

public sealed class ProductTests
{
    private static readonly DateTimeOffset Now = new(2026, 11, 27, 12, 0, 0, TimeSpan.Zero);

    [Fact]
    public void A_product_needs_a_positive_price_and_a_name()
    {
        var product = Product.Create("mouse-01", "Nimbus Wireless Mouse", 2950, Now);
        Assert.Equal(("MOUSE-01", 2950, true), (product.Sku, product.PriceCents, product.Active));

        Assert.Throws<DomainException>(() => Product.Create("X", "X", 0, Now));
        Assert.Throws<DomainException>(() => Product.Create("X", " ", 100, Now));
        Assert.Throws<DomainException>(() => product.SetPrice(null, -1, Now));
    }
}

public sealed class CatalogApiTests
{
    [Fact]
    public async Task The_seeded_catalogue_lists_the_demo_products()
    {
        using var factory = new CatalogApiFactory();
        var products = await factory.CreateClient().GetFromJsonAsync<List<ProductResponse>>("/catalog");

        Assert.NotNull(products);
        Assert.Equal(5, products.Count);
        Assert.Equal(products.OrderBy(p => p.Sku).Select(p => p.Sku), products.Select(p => p.Sku));
        var mouse = products.Single(p => p.Sku == "MOUSE-01");
        Assert.Equal(("Nimbus Wireless Mouse", 2950), (mouse.Name, mouse.PriceCents));
    }

    [Fact]
    public async Task Changing_a_price_is_visible_to_the_order_service_immediately()
    {
        using var factory = new CatalogApiFactory();
        var client = factory.CreateClient();

        var put = await client.PutAsJsonAsync("/catalog/mouse-01", new SetPriceRequest(null, 3100));
        put.EnsureSuccessStatusCode();

        var product = await client.GetFromJsonAsync<ProductResponse>("/catalog/MOUSE-01");
        Assert.Equal(3100, product!.PriceCents);
        Assert.Equal("Nimbus Wireless Mouse", product.Name);
    }

    [Fact]
    public async Task A_new_sku_needs_a_name_and_a_positive_price()
    {
        using var factory = new CatalogApiFactory();
        var client = factory.CreateClient();

        var noName = await client.PutAsJsonAsync("/catalog/NEW-1", new SetPriceRequest(null, 500));
        Assert.Equal(HttpStatusCode.BadRequest, noName.StatusCode);

        var free = await client.PutAsJsonAsync("/catalog/NEW-1", new SetPriceRequest("New Thing", 0));
        Assert.Equal(HttpStatusCode.BadRequest, free.StatusCode);

        var good = await client.PutAsJsonAsync("/catalog/NEW-1", new SetPriceRequest("New Thing", 500));
        good.EnsureSuccessStatusCode();
        var product = await client.GetFromJsonAsync<ProductResponse>("/catalog/NEW-1");
        Assert.Equal(("NEW-1", "New Thing", 500), (product!.Sku, product.Name, product.PriceCents));
    }

    [Fact]
    public async Task An_unknown_sku_is_a_404()
    {
        using var factory = new CatalogApiFactory();
        var response = await factory.CreateClient().GetAsync("/catalog/NOPE");
        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }
}
