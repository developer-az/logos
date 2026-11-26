namespace Procurement.Service;

public sealed class ProcurementOptions
{
    public const string Section = "Procurement";

    /// <summary>Publishes the demo catalogue's quotes on startup when the table is empty.</summary>
    public bool SeedDemoData { get; set; }

    /// <summary>
    /// How long one supplier day lasts. Production leaves it at a real day; the demo compresses
    /// it so a receipt can be watched. The quote's <c>LeadTimeDays</c> is multiplied by this.
    /// </summary>
    public double DaySeconds { get; set; } = 86_400;

    public TimeSpan ReceiptPollInterval { get; set; } = TimeSpan.FromSeconds(1);
}
