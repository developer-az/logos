namespace OrderPlatform.Contracts;

public sealed record OrderLine(string Sku, int Quantity, decimal UnitPrice);

/// <summary>An order was accepted and is waiting for stock to be reserved.</summary>
public sealed record OrderPlaced(Guid OrderId, string CustomerId, IReadOnlyList<OrderLine> Lines, decimal Total) : IIntegrationEvent
{
    public static string EventType => "order.placed";
    public static int SchemaVersion => 1;
}

/// <summary>Stock was reserved for every line; the order is confirmed.</summary>
public sealed record OrderConfirmed(Guid OrderId) : IIntegrationEvent
{
    public static string EventType => "order.confirmed";
    public static int SchemaVersion => 1;
}

/// <summary>Stock could not be reserved; the order is rejected and nothing is held.</summary>
public sealed record OrderRejected(Guid OrderId, string Reason) : IIntegrationEvent
{
    public static string EventType => "order.rejected";
    public static int SchemaVersion => 1;
}

/// <summary>The customer cancelled; any reservation for the order must be released.</summary>
public sealed record OrderCancelled(Guid OrderId, string? Reason) : IIntegrationEvent
{
    public static string EventType => "order.cancelled";
    public static int SchemaVersion => 1;
}
