namespace Metrics.Core.Domain;

/// <summary>
/// Project-level flow statistics. Cycle-time distributions are right-skewed (a few issues take
/// far longer than the rest), so we report percentiles rather than a mean, which outliers distort.
/// </summary>
public sealed record FlowSummary(
    string ProjectKey,
    int CompletedCount,
    TimeSpan? CycleTimeP50,
    TimeSpan? CycleTimeP85,
    TimeSpan? LeadTimeP50,
    TimeSpan? LeadTimeP85)
{
    public static FlowSummary From(string projectKey, IEnumerable<IssueMetrics> metrics)
    {
        var done = metrics.Where(m => m.IsComplete && m.ProjectKey == projectKey).ToList();
        var cycle = done.Where(m => m.CycleTime is not null).Select(m => m.CycleTime!.Value).ToList();
        var lead = done.Where(m => m.LeadTime is not null).Select(m => m.LeadTime!.Value).ToList();

        return new FlowSummary(
            projectKey,
            done.Count,
            Percentile(cycle, 0.50),
            Percentile(cycle, 0.85),
            Percentile(lead, 0.50),
            Percentile(lead, 0.85));
    }

    /// <summary>Linear interpolation between closest ranks (the "R-7" / Excel PERCENTILE.INC method).</summary>
    public static TimeSpan? Percentile(IReadOnlyCollection<TimeSpan> values, double p)
    {
        ArgumentOutOfRangeException.ThrowIfLessThan(p, 0);
        ArgumentOutOfRangeException.ThrowIfGreaterThan(p, 1);
        if (values.Count == 0) return null;

        var sorted = values.Select(v => v.Ticks).Order().ToArray();
        var rank = p * (sorted.Length - 1);
        var lo = (int)Math.Floor(rank);
        var hi = (int)Math.Ceiling(rank);
        var ticks = sorted[lo] + (rank - lo) * (sorted[hi] - sorted[lo]);
        return TimeSpan.FromTicks((long)Math.Round(ticks));
    }
}
