using Catalog.Service.Data;
using Catalog.Service.Domain;
using Microsoft.EntityFrameworkCore;

namespace Catalog.Service.Api;

public sealed record ProductResponse(string Sku, string Name, int PriceCents, bool Active, DateTimeOffset UpdatedAt)
{
    public static ProductResponse From(Product p) => new(p.Sku, p.Name, p.PriceCents, p.Active, p.UpdatedAt);
}

public sealed record SetPriceRequest(string? Name, int PriceCents);

public static class CatalogEndpoints
{
    public static IEndpointRouteBuilder MapCatalogEndpoints(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/catalog").WithTags("Catalog");

        // The order service prices every line from this list. Inactive SKUs are not sold.
        group.MapGet("/", async (CatalogDbContext db, CancellationToken ct) =>
            (await db.Products.AsNoTracking().Where(p => p.Active).OrderBy(p => p.Sku).ToListAsync(ct))
            .Select(ProductResponse.From));

        group.MapGet("/{sku}", async (string sku, CatalogDbContext db, CancellationToken ct) =>
        {
            var normalized = sku.Trim().ToUpperInvariant();
            return await db.Products.AsNoTracking().SingleOrDefaultAsync(p => p.Sku == normalized, ct) is { } product
                ? Results.Ok(ProductResponse.From(product))
                : Results.NotFound();
        });

        group.MapPut("/{sku}", SetPriceAsync);
        return app;
    }

    /// <summary>Upserts a price (merchandising/ops). New SKUs are created active.</summary>
    private static async Task<IResult> SetPriceAsync(string sku, SetPriceRequest request,
        CatalogDbContext db, TimeProvider clock, CancellationToken ct)
    {
        var now = clock.GetUtcNow();
        Product product;
        try
        {
            var normalized = Product.NormalizeSku(sku);
            var existing = await db.Products.SingleOrDefaultAsync(p => p.Sku == normalized, ct);
            if (existing is null)
            {
                if (string.IsNullOrWhiteSpace(request.Name))
                    return Results.ValidationProblem(new Dictionary<string, string[]>
                    {
                        ["name"] = ["name is required when the SKU is new."],
                    });
                product = Product.Create(normalized, request.Name, request.PriceCents, now);
                db.Products.Add(product);
            }
            else
            {
                product = existing;
                product.SetPrice(request.Name, request.PriceCents, now);
            }
        }
        catch (DomainException ex)
        {
            return Results.ValidationProblem(new Dictionary<string, string[]> { ["price"] = [ex.Message] });
        }

        await db.SaveChangesAsync(ct);
        return Results.Ok(ProductResponse.From(product));
    }
}
