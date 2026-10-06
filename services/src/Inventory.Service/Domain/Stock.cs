namespace Inventory.Service.Domain;

public sealed class DomainException(string message) : Exception(message);

/// <summary>Stock for one SKU. Invariant: 0 ≤ Reserved ≤ OnHand.</summary>
public sealed class StockItem
{
    private StockItem() { }

    public string Sku { get; private set; } = "";
    public int OnHand { get; private set; }
    public int Reserved { get; private set; }
    public int Available => OnHand - Reserved;
    public DateTimeOffset UpdatedAt { get; private set; }

    /// <summary>Per-SKU counter, +1 on every change. Published so read models can drop stale snapshots.</summary>
    public long Revision { get; private set; }

    /// <summary>Optimistic concurrency token: two consumers reserving the same SKU cannot both win.</summary>
    public Guid Version { get; private set; }

    public static StockItem Create(string sku, int onHand, DateTimeOffset now)
    {
        var item = new StockItem { Sku = NormalizeSku(sku) };
        item.SetOnHand(onHand, now);
        return item;
    }

    public static string NormalizeSku(string sku) =>
        string.IsNullOrWhiteSpace(sku) ? throw new DomainException("sku is required.") : sku.Trim().ToUpperInvariant();

    public void SetOnHand(int onHand, DateTimeOffset now)
    {
        if (onHand < 0) throw new DomainException("onHand cannot be negative.");
        if (onHand < Reserved) throw new DomainException($"onHand {onHand} is below the {Reserved} units already reserved for {Sku}.");
        OnHand = onHand;
        Touch(now);
    }

    public void Reserve(int quantity, DateTimeOffset now)
    {
        if (quantity <= 0) throw new DomainException("Reserved quantity must be positive.");
        if (quantity > Available) throw new DomainException($"Only {Available} of {Sku} available, {quantity} requested.");
        Reserved += quantity;
        Touch(now);
    }

    public void Release(int quantity, DateTimeOffset now)
    {
        if (quantity <= 0 || quantity > Reserved) throw new DomainException($"Cannot release {quantity} of {Sku}; {Reserved} reserved.");
        Reserved -= quantity;
        Touch(now);
    }

    private void Touch(DateTimeOffset now)
    {
        UpdatedAt = now;
        Revision++;
        Version = Guid.NewGuid();
    }
}

public enum ReservationStatus
{
    /// <summary>Stock is held for the order.</summary>
    Reserved,
    /// <summary>Not enough stock; nothing was held.</summary>
    Failed,
    /// <summary>The order was cancelled and its stock returned.</summary>
    Released,
    /// <summary>OrderCancelled arrived before OrderPlaced; a later OrderPlaced must not reserve.</summary>
    CancelledBeforePlaced,
}

public sealed class ReservationLine
{
    public required string Sku { get; init; }
    public int Quantity { get; init; }
}

/// <summary>The inventory decision for one order. Doubles as a guard so each order is reserved at most once.</summary>
public sealed class Reservation
{
    private readonly List<ReservationLine> _lines = [];

    private Reservation() { }

    public Guid OrderId { get; private set; }
    public ReservationStatus Status { get; private set; }
    public IReadOnlyList<ReservationLine> Lines => _lines;
    public string? Reason { get; private set; }
    public DateTimeOffset CreatedAt { get; private set; }
    public DateTimeOffset UpdatedAt { get; private set; }

    public static Reservation Create(Guid orderId, ReservationStatus status, IEnumerable<ReservationLine> lines, string? reason, DateTimeOffset now)
    {
        var r = new Reservation { OrderId = orderId, Status = status, Reason = reason, CreatedAt = now, UpdatedAt = now };
        r._lines.AddRange(lines);
        return r;
    }

    public void MarkReleased(DateTimeOffset now)
    {
        if (Status != ReservationStatus.Reserved) throw new DomainException($"Reservation for {OrderId} is {Status}, not Reserved.");
        Status = ReservationStatus.Released;
        UpdatedAt = now;
    }
}
