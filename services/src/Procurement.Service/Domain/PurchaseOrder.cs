namespace Procurement.Service.Domain;

public enum PurchaseOrderStatus
{
    /// <summary>Raised with the supplier; goods have not arrived.</summary>
    InTransit,
    /// <summary>Goods were received and stock was handed to the inventory service.</summary>
    Received,
}

/// <summary>
/// A purchase order raised from a quote. The expected arrival is fixed when it is raised, so a
/// later quote change cannot move an order already in flight.
/// </summary>
public sealed class PurchaseOrder
{
    private PurchaseOrder() { }

    public Guid Id { get; private set; }
    public string Sku { get; private set; } = "";
    public string SupplierId { get; private set; } = "";
    public string SupplierName { get; private set; } = "";
    public int Quantity { get; private set; }
    public int UnitCostCents { get; private set; }
    public int LeadTimeDays { get; private set; }
    public DateTimeOffset PlacedAt { get; private set; }
    public DateTimeOffset ExpectedAt { get; private set; }
    public PurchaseOrderStatus Status { get; private set; }
    public DateTimeOffset? ReceivedAt { get; private set; }

    /// <summary>Optimistic concurrency token, so two replicas cannot both receive the same order.</summary>
    public Guid Version { get; private set; }

    public int TotalCents => Quantity * UnitCostCents;

    public static PurchaseOrder Place(Guid id, SupplierQuote quote, int quantity, TimeSpan leadTime, DateTimeOffset now)
    {
        ArgumentNullException.ThrowIfNull(quote);
        if (quantity <= 0) throw new DomainException("Quantity must be positive.");
        if (quantity < quote.Moq)
            throw new DomainException($"{quote.SupplierName} has a minimum order of {quote.Moq}.");

        return new PurchaseOrder
        {
            Id = id,
            Sku = quote.Sku,
            SupplierId = quote.SupplierId,
            SupplierName = quote.SupplierName,
            Quantity = quantity,
            UnitCostCents = quote.UnitCostCents,
            LeadTimeDays = quote.LeadTimeDays,
            PlacedAt = now,
            ExpectedAt = now + leadTime,
            Status = PurchaseOrderStatus.InTransit,
            Version = Guid.NewGuid(),
        };
    }

    public void Receive(DateTimeOffset now)
    {
        if (Status != PurchaseOrderStatus.InTransit)
            throw new DomainException($"Purchase order {Id} is {Status}, not InTransit.");
        Status = PurchaseOrderStatus.Received;
        ReceivedAt = now;
        Version = Guid.NewGuid();
    }

    /// <summary>True when the supplier's lead time has elapsed and nothing has received it yet.</summary>
    public bool IsDue(DateTimeOffset now) => Status == PurchaseOrderStatus.InTransit && ExpectedAt <= now;
}
