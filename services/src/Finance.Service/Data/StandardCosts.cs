namespace Finance.Service.Data;

/// <summary>
/// Standard cost per SKU, the accounting basis for cost of goods sold. Kept deliberately separate
/// from procurement's negotiated supplier prices: standard costing values stock at a fixed cost,
/// and a purchase-price variance would be reconciled elsewhere.
/// </summary>
public static class StandardCosts
{
    private static readonly IReadOnlyDictionary<string, int> Costs = new Dictionary<string, int>
    {
        ["KEYBOARD-01"] = 4200,
        ["MOUSE-01"] = 1800,
        ["MONITOR-27"] = 21000,
        ["USB-C-HUB"] = 2600,
        ["WEBCAM-HD"] = 5400,
    };

    public static string Normalize(string sku) => sku.Trim().ToUpperInvariant();

    /// <summary>Cost in cents, or 0 for a SKU with no standard cost (the handler logs it).</summary>
    public static int For(string sku) =>
        Costs.TryGetValue(Normalize(sku), out var cost) ? cost : 0;

    public static bool Knows(string sku) => Costs.ContainsKey(Normalize(sku));
}
