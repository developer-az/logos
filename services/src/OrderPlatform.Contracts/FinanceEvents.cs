namespace OrderPlatform.Contracts;

/// <summary>
/// Money recognised when an order is confirmed. <paramref name="CostCents"/> is the standard cost
/// of the goods sold, recognised with the capture so margin is a property of the event.
/// </summary>
public sealed record PaymentCaptured(
    Guid OrderId,
    int AmountCents,
    int CostCents) : IIntegrationEvent
{
    public static string EventType => "finance.payment-captured";
    public static int SchemaVersion => 1;
}

/// <summary>A captured order was cancelled; the charge and its cost of goods are reversed.</summary>
public sealed record RefundIssued(
    Guid OrderId,
    int AmountCents,
    int CostCents) : IIntegrationEvent
{
    public static string EventType => "finance.refund-issued";
    public static int SchemaVersion => 1;
}
