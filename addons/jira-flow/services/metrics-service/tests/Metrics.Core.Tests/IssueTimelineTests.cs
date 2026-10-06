using Metrics.Core.Domain;
using Metrics.Core.Events;

namespace Metrics.Core.Tests;

public class IssueTimelineTests
{
    private static readonly DateTimeOffset T0 = new(2026, 10, 1, 9, 0, 0, TimeSpan.Zero);

    private static IssueEvent Evt(string id, IssueEventType type, StatusCategory to, double hours, string key = "ABC-1") => new()
    {
        Id = id,
        Type = type,
        OccurredAt = T0.AddHours(hours),
        IssueKey = key,
        ProjectKey = "ABC",
        ToCategory = to,
    };

    [Fact]
    public void Computes_lead_and_cycle_time_for_a_simple_flow()
    {
        var t = new IssueTimeline("ABC-1");
        t.Apply(Evt("1", IssueEventType.Created, StatusCategory.ToDo, 0));
        t.Apply(Evt("2", IssueEventType.Transitioned, StatusCategory.InProgress, 24));
        t.Apply(Evt("3", IssueEventType.Transitioned, StatusCategory.Done, 72));

        var m = t.Compute();

        Assert.Equal(TimeSpan.FromHours(72), m.LeadTime);
        Assert.Equal(TimeSpan.FromHours(48), m.CycleTime);
        Assert.True(m.IsComplete);
        Assert.Equal(0, m.ReopenCount);
    }

    [Fact]
    public void Duplicate_delivery_is_ignored()
    {
        var t = new IssueTimeline("ABC-1");
        Assert.True(t.Apply(Evt("1", IssueEventType.Created, StatusCategory.ToDo, 0)));
        Assert.False(t.Apply(Evt("1", IssueEventType.Created, StatusCategory.ToDo, 0)));
        Assert.Equal(1, t.EventCount);
    }

    [Fact]
    public void Out_of_order_events_give_the_same_result_as_in_order()
    {
        var events = new[]
        {
            Evt("1", IssueEventType.Created, StatusCategory.ToDo, 0),
            Evt("2", IssueEventType.Transitioned, StatusCategory.InProgress, 10),
            Evt("3", IssueEventType.Transitioned, StatusCategory.Done, 30),
        };
        var inOrder = new IssueTimeline("ABC-1");
        foreach (var e in events) inOrder.Apply(e);
        var shuffled = new IssueTimeline("ABC-1");
        foreach (var e in events.Reverse()) shuffled.Apply(e);

        Assert.Equal(inOrder.Compute(), shuffled.Compute());
    }

    [Fact]
    public void Reopened_issue_measures_to_final_done_and_counts_reopens()
    {
        var t = new IssueTimeline("ABC-1");
        t.Apply(Evt("1", IssueEventType.Created, StatusCategory.ToDo, 0));
        t.Apply(Evt("2", IssueEventType.Transitioned, StatusCategory.InProgress, 1));
        t.Apply(Evt("3", IssueEventType.Transitioned, StatusCategory.Done, 5));
        t.Apply(Evt("4", IssueEventType.Transitioned, StatusCategory.InProgress, 8));
        t.Apply(Evt("5", IssueEventType.Transitioned, StatusCategory.Done, 11));

        var m = t.Compute();

        Assert.Equal(1, m.ReopenCount);
        Assert.Equal(TimeSpan.FromHours(10), m.CycleTime);
    }

    [Fact]
    public void Issue_reopened_and_not_yet_done_is_incomplete()
    {
        var t = new IssueTimeline("ABC-1");
        t.Apply(Evt("1", IssueEventType.Created, StatusCategory.ToDo, 0));
        t.Apply(Evt("2", IssueEventType.Transitioned, StatusCategory.Done, 2));
        t.Apply(Evt("3", IssueEventType.Transitioned, StatusCategory.ToDo, 3));

        var m = t.Compute();

        Assert.False(m.IsComplete);
        Assert.Null(m.LeadTime);
    }

    [Fact]
    public void Straight_to_done_has_lead_time_but_no_cycle_time()
    {
        var t = new IssueTimeline("ABC-1");
        t.Apply(Evt("1", IssueEventType.Created, StatusCategory.ToDo, 0));
        t.Apply(Evt("2", IssueEventType.Transitioned, StatusCategory.Done, 4));

        var m = t.Compute();

        Assert.Equal(TimeSpan.FromHours(4), m.LeadTime);
        Assert.Null(m.CycleTime);
    }

    [Fact]
    public void Rejects_events_for_another_issue()
    {
        var t = new IssueTimeline("ABC-1");
        Assert.Throws<ArgumentException>(() => t.Apply(Evt("1", IssueEventType.Created, StatusCategory.ToDo, 0, key: "ABC-2")));
    }
}
