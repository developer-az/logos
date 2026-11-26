namespace Procurement.Service.Data;

/// <summary>
/// The catalogue procurement buys for. It mirrors the SKUs the inventory service seeds, so a
/// receipt restocks something a customer can actually order. Costs are the distributor's cost,
/// not the shelf price.
/// </summary>
public static class Catalog
{
    public sealed record Item(string Sku, int UnitCostCents);

    public sealed record Supplier(
        string SupplierId,
        string SupplierName,
        double CostFactor,
        int LeadTimeDays,
        int Moq,
        double OnTimeRate);

    public static readonly IReadOnlyList<Item> Items =
    [
        new("KEYBOARD-01", 4200),
        new("MOUSE-01", 1800),
        new("MONITOR-27", 21000),
        new("USB-C-HUB", 2600),
        new("WEBCAM-HD", 5400),
    ];

    /// <summary>Cheapest is slowest, fastest is dearest; MOQ decides how much cash a restock ties up.</summary>
    public static readonly IReadOnlyList<Supplier> Suppliers =
    [
        new("northwind", "Northwind Supply", 0.96, 3, 6, 0.97),
        new("vertex", "Vertex Components", 0.88, 6, 12, 0.91),
        new("kiloparts", "Kilo Parts", 1.04, 1, 3, 0.86),
    ];

    public static int QuoteCost(Item item, Supplier supplier) =>
        (int)Math.Round(item.UnitCostCents * supplier.CostFactor, MidpointRounding.AwayFromZero);

    public static bool KnowsSku(string sku) =>
        Items.Any(i => string.Equals(i.Sku, sku, StringComparison.OrdinalIgnoreCase));
}
