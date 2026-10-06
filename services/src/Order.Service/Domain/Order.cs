namespace Order.Service.Domain;

public enum OrderStatus { Pending, Confirmed, Rejected, Cancelled }

public sealed class OrderItem
{
    public required string Sku { get; init; }
    public int Quantity { get; init; }
    public decimal UnitPrice { get; init; }
}

public sealed class DomainException(string message) : Exception(message);

/// <summary>
/// Order aggregate. Lifecycle: Pending → Confirmed | Rejected (decided by inventory),
/// and Pending | Confirmed → Cancelled (by the customer). Rejected and Cancelled are terminal.
/// </summary>
public sealed class Order
{
    public const int MaxLines = 100;
    public const int MaxQuantityPerLine = 10_000;

    private readonly List<OrderItem> _items = [];

    private Order() { }

    public Guid Id { get; private set; }
    public string CustomerId { get; private set; } = "";
    public OrderStatus Status { get; private set; }
    public IReadOnlyList<OrderItem> Items => _items;
    public decimal Total { get; private set; }
    public string? StatusReason { get; private set; }
    public Guid CorrelationId { get; private set; }
    public string? IdempotencyKey { get; private set; }
    public DateTimeOffset CreatedAt { get; private set; }
    public DateTimeOffset UpdatedAt { get; private set; }

    /// <summary>Optimistic concurrency token, replaced on every state change.</summary>
    public Guid Version { get; private set; }

    public static Order Place(Guid id, string customerId, IEnumerable<OrderItem> items, Guid correlationId,
        string? idempotencyKey, DateTimeOffset now)
    {
        if (string.IsNullOrWhiteSpace(customerId)) throw new DomainException("customerId is required.");

        // Repeated SKUs are merged so inventory sees one reservation line per SKU.
        var merged = new List<OrderItem>();
        foreach (var group in (items ?? throw new DomainException("At least one line is required.")).GroupBy(i => i.Sku?.Trim().ToUpperInvariant()))
        {
            if (string.IsNullOrEmpty(group.Key)) throw new DomainException("Every line needs a sku.");
            var prices = group.Select(i => i.UnitPrice).Distinct().ToList();
            if (prices.Count > 1) throw new DomainException($"Sku {group.Key} appears with different unit prices.");
            if (group.Any(i => i.Quantity <= 0)) throw new DomainException($"Quantity for {group.Key} must be positive.");
            if (prices[0] < 0) throw new DomainException($"Unit price for {group.Key} cannot be negative.");

            var quantity = group.Sum(i => (long)i.Quantity);
            if (quantity > MaxQuantityPerLine) throw new DomainException($"Quantity for {group.Key} exceeds {MaxQuantityPerLine}.");
            merged.Add(new OrderItem { Sku = group.Key, Quantity = (int)quantity, UnitPrice = prices[0] });
        }

        if (merged.Count == 0) throw new DomainException("At least one line is required.");
        if (merged.Count > MaxLines) throw new DomainException($"An order can have at most {MaxLines} distinct skus.");

        var order = new Order
        {
            Id = id,
            CustomerId = customerId.Trim(),
            Status = OrderStatus.Pending,
            Total = merged.Sum(i => i.Quantity * i.UnitPrice),
            CorrelationId = correlationId,
            IdempotencyKey = idempotencyKey,
            CreatedAt = now,
            UpdatedAt = now,
            Version = Guid.NewGuid(),
        };
        order._items.AddRange(merged);
        return order;
    }

    public void Confirm(DateTimeOffset now)
    {
        EnsureStatus(OrderStatus.Pending, "confirm");
        Transition(OrderStatus.Confirmed, null, now);
    }

    public void Reject(string reason, DateTimeOffset now)
    {
        EnsureStatus(OrderStatus.Pending, "reject");
        Transition(OrderStatus.Rejected, reason, now);
    }

    public void Cancel(string? reason, DateTimeOffset now)
    {
        if (Status is not (OrderStatus.Pending or OrderStatus.Confirmed))
            throw new DomainException($"A {Status.ToString().ToLowerInvariant()} order cannot be cancelled.");
        Transition(OrderStatus.Cancelled, reason, now);
    }

    private void EnsureStatus(OrderStatus expected, string action)
    {
        if (Status != expected)
            throw new DomainException($"Cannot {action} an order that is {Status.ToString().ToLowerInvariant()}.");
    }

    private void Transition(OrderStatus status, string? reason, DateTimeOffset now)
    {
        Status = status;
        StatusReason = reason;
        UpdatedAt = now;
        Version = Guid.NewGuid();
    }
}
