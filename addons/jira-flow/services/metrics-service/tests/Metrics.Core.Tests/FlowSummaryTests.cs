using Metrics.Core.Domain;

namespace Metrics.Core.Tests;

public class FlowSummaryTests
{
    private static TimeSpan H(double h) => TimeSpan.FromHours(h);

    [Theory]
    [InlineData(0.0, 1)]
    [InlineData(0.5, 3)]
    [InlineData(1.0, 5)]
    [InlineData(0.85, 4.4)] // rank 3.4 -> 4 + 0.4 * (5 - 4)
    public void Percentile_uses_linear_interpolation(double p, double expectedHours)
    {
        var values = new[] { H(5), H(1), H(3), H(2), H(4) };
        Assert.Equal(H(expectedHours), FlowSummary.Percentile(values, p));
    }

    [Fact]
    public void Percentile_of_empty_set_is_null() => Assert.Null(FlowSummary.Percentile([], 0.5));

    [Fact]
    public void Summary_only_counts_completed_issues_in_the_project()
    {
        var metrics = new[]
        {
            new IssueMetrics("ABC-1", "ABC", null, null, DateTimeOffset.UnixEpoch, H(10), H(4), 0, false),
            new IssueMetrics("ABC-2", "ABC", null, null, null, null, null, 0, false),               // open
            new IssueMetrics("ABC-3", "ABC", null, null, DateTimeOffset.UnixEpoch, H(1), H(1), 0, true), // deleted
            new IssueMetrics("XYZ-1", "XYZ", null, null, DateTimeOffset.UnixEpoch, H(99), H(99), 0, false),
        };

        var s = FlowSummary.From("ABC", metrics);

        Assert.Equal(1, s.CompletedCount);
        Assert.Equal(H(4), s.CycleTimeP50);
        Assert.Equal(H(10), s.LeadTimeP85);
    }
}
