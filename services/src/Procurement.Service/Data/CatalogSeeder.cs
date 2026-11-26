using Microsoft.EntityFrameworkCore;
using OrderPlatform.Contracts;
using OrderPlatform.Messaging.Outbox;
using Procurement.Service.Domain;

namespace Procurement.Service.Data;

/// <summary>Publishes the standing quotes for the demo catalogue, once.</summary>
public static class CatalogSeeder
{
    public static async Task SeedAsync(ProcurementDbContext db, TimeProvider clock, CancellationToken ct = default)
    {
        if (await db.Quotes.AnyAsync(ct)) return;

        var now = clock.GetUtcNow();
        var correlationId = Guid.NewGuid();
        foreach (var item in Catalog.Items)
        {
            foreach (var supplier in Catalog.Suppliers)
            {
                var quote = SupplierQuote.Create(Guid.NewGuid(), item.Sku, supplier.SupplierId, supplier.SupplierName,
                    Catalog.QuoteCost(item, supplier), supplier.LeadTimeDays, supplier.Moq, supplier.OnTimeRate, now);
                db.Quotes.Add(quote);
                db.Enqueue(Topics.ProcurementEvents, quote.Sku,
                    new SupplierQuoteReceived(quote.QuoteId, quote.Sku, quote.SupplierId, quote.SupplierName,
                        quote.UnitCostCents, quote.LeadTimeDays, quote.Moq, quote.OnTimeRate),
                    correlationId, null, clock);
            }
        }

        await db.SaveChangesAsync(ct);
    }
}
