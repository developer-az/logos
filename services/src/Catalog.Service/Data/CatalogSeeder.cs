using Catalog.Service.Domain;
using Microsoft.EntityFrameworkCore;

namespace Catalog.Service.Data;

/// <summary>The products the demo sells. A real catalogue would be maintained by merchandising.</summary>
public static class CatalogSeeder
{
    private static readonly (string Sku, string Name, int PriceCents)[] Products =
    [
        ("KEYBOARD-01", "Aurora 75% Keyboard", 8900),
        ("MOUSE-01", "Nimbus Wireless Mouse", 2950),
        ("MONITOR-27", "Vertex 27-inch Monitor", 29900),
        ("USB-C-HUB", "USB-C Dock 8-in-1", 4500),
        ("WEBCAM-HD", "Clearline Webcam", 5900),
    ];

    public static async Task SeedAsync(CatalogDbContext db, TimeProvider clock, CancellationToken ct = default)
    {
        if (await db.Products.AnyAsync(ct)) return;
        var now = clock.GetUtcNow();
        db.Products.AddRange(Products.Select(p => Product.Create(p.Sku, p.Name, p.PriceCents, now)));
        await db.SaveChangesAsync(ct);
    }
}
