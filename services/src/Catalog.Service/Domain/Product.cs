namespace Catalog.Service.Domain;

public sealed class DomainException(string message) : Exception(message);

/// <summary>The shelf price of one SKU. This service is the authority the order service prices from.</summary>
public sealed class Product
{
    private Product() { }

    public string Sku { get; private set; } = "";
    public string Name { get; private set; } = "";
    public int PriceCents { get; private set; }
    public bool Active { get; private set; }
    public DateTimeOffset UpdatedAt { get; private set; }

    public static Product Create(string sku, string name, int priceCents, DateTimeOffset now)
    {
        var product = new Product { Sku = NormalizeSku(sku), Active = true, UpdatedAt = now };
        product.SetPrice(name, priceCents, now);
        return product;
    }

    public static string NormalizeSku(string sku) =>
        string.IsNullOrWhiteSpace(sku) ? throw new DomainException("sku is required.") : sku.Trim().ToUpperInvariant();

    public void SetPrice(string? name, int priceCents, DateTimeOffset now)
    {
        if (priceCents <= 0) throw new DomainException("priceCents must be positive.");
        if (name is not null)
        {
            if (string.IsNullOrWhiteSpace(name)) throw new DomainException("name cannot be blank.");
            Name = name.Trim();
        }
        PriceCents = priceCents;
        UpdatedAt = now;
    }

    public void Deactivate(DateTimeOffset now)
    {
        Active = false;
        UpdatedAt = now;
    }

    public void Activate(DateTimeOffset now)
    {
        Active = true;
        UpdatedAt = now;
    }
}
