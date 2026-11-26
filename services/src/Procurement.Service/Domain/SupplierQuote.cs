namespace Procurement.Service.Domain;

public sealed class DomainException(string message) : Exception(message);

/// <summary>
/// One supplier's standing offer for one SKU. Quotes arrive as events; the row here is the
/// service's own copy, used to price a purchase order.
/// </summary>
public sealed class SupplierQuote
{
    private SupplierQuote() { }

    public Guid QuoteId { get; private set; }
    public string Sku { get; private set; } = "";
    public string SupplierId { get; private set; } = "";
    public string SupplierName { get; private set; } = "";
    public int UnitCostCents { get; private set; }
    public int LeadTimeDays { get; private set; }
    public int Moq { get; private set; }
    public double OnTimeRate { get; private set; }
    public DateTimeOffset ReceivedAt { get; private set; }

    public static SupplierQuote Create(Guid quoteId, string sku, string supplierId, string supplierName,
        int unitCostCents, int leadTimeDays, int moq, double onTimeRate, DateTimeOffset now)
    {
        if (string.IsNullOrWhiteSpace(sku)) throw new DomainException("sku is required.");
        if (string.IsNullOrWhiteSpace(supplierId)) throw new DomainException("supplierId is required.");
        if (unitCostCents <= 0) throw new DomainException("unitCostCents must be positive.");
        if (leadTimeDays <= 0) throw new DomainException("leadTimeDays must be positive.");
        if (moq <= 0) throw new DomainException("moq must be positive.");
        if (onTimeRate is < 0 or > 1) throw new DomainException("onTimeRate must be between 0 and 1.");

        return new SupplierQuote
        {
            QuoteId = quoteId,
            Sku = NormalizeSku(sku),
            SupplierId = supplierId.Trim(),
            SupplierName = supplierName.Trim(),
            UnitCostCents = unitCostCents,
            LeadTimeDays = leadTimeDays,
            Moq = moq,
            OnTimeRate = onTimeRate,
            ReceivedAt = now,
        };
    }

    public static string NormalizeSku(string sku) =>
        string.IsNullOrWhiteSpace(sku) ? throw new DomainException("sku is required.") : sku.Trim().ToUpperInvariant();
}
