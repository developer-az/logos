using System.Net.Http.Json;
using Microsoft.Extensions.Options;

namespace Order.Service.Catalog;

public sealed class CatalogOptions
{
    public const string Section = "Catalog";

    /// <summary>
    /// Base URL of the catalogue service. When set, every order is priced from it and a client's
    /// price is ignored. Empty keeps the older client-supplied prices (tests, old deployments).
    /// </summary>
    public string BaseUrl { get; set; } = "";
}

/// <summary>The catalogue's product shape, as JSON.</summary>
public sealed record CatalogProduct(string Sku, string Name, int PriceCents);

/// <summary>
/// Prices orders from the catalogue, which is the only authority on shelf prices. A catalogue
/// that cannot answer fails the order instead of falling back to a client price.
/// </summary>
public sealed class CatalogClient(
    IHttpClientFactory factory,
    IOptions<CatalogOptions> options,
    ILogger<CatalogClient> logger)
{
    public bool Enabled => !string.IsNullOrWhiteSpace(options.Value.BaseUrl);

    public async Task<Dictionary<string, decimal>> PricesAsync(IEnumerable<string> skus, CancellationToken ct)
    {
        var wanted = skus.Select(Normalize).ToHashSet(StringComparer.OrdinalIgnoreCase);
        var http = factory.CreateClient();
        http.BaseAddress = new Uri(options.Value.BaseUrl.TrimEnd('/') + "/");
        http.Timeout = TimeSpan.FromSeconds(2);

        var products = await http.GetFromJsonAsync<List<CatalogProduct>>("catalog", ct)
            ?? throw new HttpRequestException("the catalogue returned no body");

        var prices = new Dictionary<string, decimal>(StringComparer.OrdinalIgnoreCase);
        foreach (var product in products)
            if (wanted.Contains(product.Sku)) prices[product.Sku] = product.PriceCents / 100m;

        logger.LogDebug("Priced {Matched} of {Wanted} lines from the catalogue", prices.Count, wanted.Count);
        return prices;
    }

    public static string Normalize(string sku) => sku.Trim().ToUpperInvariant();
}
