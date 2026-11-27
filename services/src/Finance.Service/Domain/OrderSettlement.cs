namespace Finance.Service.Domain;

public sealed class DomainException(string message) : Exception(message);

public enum SettlementStatus
{
    /// <summary>The order was placed; no money has moved yet.</summary>
    Pending,
    /// <summary>The order was confirmed and the charge recognised.</summary>
    Captured,
    /// <summary>A captured order was cancelled; the charge and its cost were reversed.</summary>
    Refunded,
    /// <summary>The order was cancelled before it was confirmed; nothing was charged.</summary>
    Cancelled,
}

/// <summary>
/// What one order is worth to the ledger. Created from <c>order.placed</c> (which carries the lines
/// and total), captured on <c>order.confirmed</c>, reversed on a later cancellation. Amounts are
/// integer cents; cost is the standard cost of the goods, so margin is derivable from the event.
/// </summary>
public sealed class OrderSettlement
{
    private OrderSettlement() { }

    public Guid OrderId { get; private set; }
    public int AmountCents { get; private set; }
    public int CostCents { get; private set; }
    public SettlementStatus Status { get; private set; }
    public DateTimeOffset CreatedAt { get; private set; }
    public DateTimeOffset UpdatedAt { get; private set; }

    /// <summary>Optimistic concurrency token: two handlers cannot settle the same order twice.</summary>
    public Guid Version { get; private set; }

    public static OrderSettlement Create(Guid orderId, int amountCents, int costCents, DateTimeOffset now)
    {
        if (orderId == Guid.Empty) throw new DomainException("orderId is required.");
        if (amountCents < 0) throw new DomainException("amountCents cannot be negative.");
        if (costCents < 0) throw new DomainException("costCents cannot be negative.");

        return new OrderSettlement
        {
            OrderId = orderId,
            AmountCents = amountCents,
            CostCents = costCents,
            Status = SettlementStatus.Pending,
            CreatedAt = now,
            UpdatedAt = now,
            Version = Guid.NewGuid(),
        };
    }

    /// <summary>Refresh the amounts from a redelivered or late order.placed, leaving the status alone.</summary>
    public void Describe(int amountCents, int costCents, DateTimeOffset now)
    {
        if (amountCents < 0 || costCents < 0) throw new DomainException("Amounts cannot be negative.");
        AmountCents = amountCents;
        CostCents = costCents;
        Touch(now);
    }

    public bool Capture(DateTimeOffset now)
    {
        if (Status != SettlementStatus.Pending) return false;
        Status = SettlementStatus.Captured;
        Touch(now);
        return true;
    }

    /// <summary>Returns true when a refund is owed, false when there was nothing captured.</summary>
    public bool Refund(DateTimeOffset now)
    {
        if (Status == SettlementStatus.Captured)
        {
            Status = SettlementStatus.Refunded;
            Touch(now);
            return true;
        }
        if (Status == SettlementStatus.Pending)
        {
            Status = SettlementStatus.Cancelled;
            Touch(now);
        }
        return false;
    }

    private void Touch(DateTimeOffset now)
    {
        UpdatedAt = now;
        Version = Guid.NewGuid();
    }
}
