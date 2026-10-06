namespace OrderPlatform.Contracts;

public sealed record ReservedLine(string Sku, int Quantity);

public sealed record StockShortage(string Sku, int Requested, int Available);

/// <summary>Every line of the order was reserved, all or nothing.</summary>
public sealed record StockReserved(Guid OrderId, IReadOnlyList<ReservedLine> Lines) : IIntegrationEvent
{
    public static string EventType => "inventory.stock-reserved";
    public static int SchemaVersion => 1;
}

/// <summary>At least one line could not be reserved; nothing was held.</summary>
public sealed record StockReservationFailed(Guid OrderId, string Reason, IReadOnlyList<StockShortage> Shortages) : IIntegrationEvent
{
    public static string EventType => "inventory.stock-reservation-failed";
    public static int SchemaVersion => 1;
}

/// <summary>A reservation was returned to available stock (the order was cancelled).</summary>
public sealed record StockReleased(Guid OrderId, IReadOnlyList<ReservedLine> Lines) : IIntegrationEvent
{
    public static string EventType => "inventory.stock-released";
    public static int SchemaVersion => 1;
}

/// <summary>Snapshot of one SKU after any change. Keyed by SKU; intended for dashboards and read models.
/// <paramref name="Version"/> increases by one per change to that SKU; keep the snapshot with the highest version.</summary>
public sealed record StockLevelChanged(string Sku, int OnHand, int Reserved, int Available, long Version) : IIntegrationEvent
{
    public static string EventType => "inventory.stock-level-changed";
    public static int SchemaVersion => 1;
}
