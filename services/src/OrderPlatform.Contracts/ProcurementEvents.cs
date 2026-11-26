namespace OrderPlatform.Contracts;

/// <summary>A supplier's standing offer for one SKU, keyed by SKU so one SKU's quotes stay ordered.</summary>
public sealed record SupplierQuoteReceived(
    Guid QuoteId,
    string Sku,
    string SupplierId,
    string SupplierName,
    int UnitCostCents,
    int LeadTimeDays,
    int Moq,
    double OnTimeRate) : IIntegrationEvent
{
    public static string EventType => "procurement.quote-received";
    public static int SchemaVersion => 1;
}

/// <summary>Raised when an operator accepts a quote. The expected arrival is fixed here.</summary>
public sealed record PurchaseOrderPlaced(
    Guid PurchaseOrderId,
    string Sku,
    string SupplierId,
    string SupplierName,
    int Quantity,
    int UnitCostCents,
    int LeadTimeDays) : IIntegrationEvent
{
    public static string EventType => "procurement.purchase-order-placed";
    public static int SchemaVersion => 1;
}

/// <summary>
/// The goods arrived. Inventory consumes this and raises on-hand stock; procurement never writes
/// stock itself, so the inventory service stays the only owner of the quantity.
/// </summary>
public sealed record GoodsReceived(
    Guid PurchaseOrderId,
    string Sku,
    int Quantity,
    int UnitCostCents) : IIntegrationEvent
{
    public static string EventType => "procurement.goods-received";
    public static int SchemaVersion => 1;
}
