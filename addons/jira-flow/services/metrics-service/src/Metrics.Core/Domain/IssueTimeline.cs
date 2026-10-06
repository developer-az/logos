using Metrics.Core.Events;

namespace Metrics.Core.Domain;

/// <summary>
/// All events seen for one issue. Metrics are recomputed from the full, time-sorted history on
/// every change, so duplicate delivery (at-least-once) and late or out-of-order events cannot
/// corrupt the result.
/// </summary>
public sealed class IssueTimeline
{
    private readonly Dictionary<string, IssueEvent> _eventsById = new(StringComparer.Ordinal);

    public IssueTimeline(string issueKey) => IssueKey = issueKey;

    public string IssueKey { get; }

    public int EventCount => _eventsById.Count;

    /// <returns><c>false</c> when the event id was already applied (duplicate delivery).</returns>
    public bool Apply(IssueEvent evt)
    {
        if (!string.Equals(evt.IssueKey, IssueKey, StringComparison.Ordinal))
            throw new ArgumentException($"Event for {evt.IssueKey} applied to timeline {IssueKey}.", nameof(evt));

        return _eventsById.TryAdd(evt.Id, evt);
    }

    public IssueMetrics Compute()
    {
        // Tie-break on id so equal timestamps give a stable, deterministic order.
        var ordered = _eventsById.Values
            .OrderBy(e => e.OccurredAt)
            .ThenBy(e => e.Id, StringComparer.Ordinal)
            .ToList();

        DateTimeOffset? createdAt = ordered.FirstOrDefault(e => e.Type == IssueEventType.Created)?.OccurredAt
                                    ?? ordered.FirstOrDefault()?.OccurredAt;
        DateTimeOffset? firstInProgressAt = null;
        DateTimeOffset? doneAt = null;
        var reopenCount = 0;
        var deleted = false;

        foreach (var e in ordered)
        {
            if (e.Type == IssueEventType.Deleted)
            {
                deleted = true;
                continue;
            }

            switch (e.ToCategory)
            {
                case StatusCategory.InProgress:
                    firstInProgressAt ??= e.OccurredAt;
                    if (doneAt is not null) { reopenCount++; doneAt = null; }
                    break;
                case StatusCategory.Done:
                    doneAt = e.OccurredAt;
                    break;
                case StatusCategory.ToDo:
                    if (doneAt is not null) { reopenCount++; doneAt = null; }
                    break;
            }
        }

        return new IssueMetrics(
            IssueKey,
            ordered.FirstOrDefault()?.ProjectKey ?? string.Empty,
            createdAt,
            firstInProgressAt,
            doneAt,
            LeadTime: createdAt is not null && doneAt is not null ? doneAt - createdAt : null,
            // An issue moved straight from To Do to Done has no measurable cycle time.
            CycleTime: firstInProgressAt is not null && doneAt is not null ? doneAt - firstInProgressAt : null,
            reopenCount,
            deleted);
    }
}

/// <param name="LeadTime">Created to (final) done.</param>
/// <param name="CycleTime">First entry into an in-progress status to (final) done.</param>
public sealed record IssueMetrics(
    string IssueKey,
    string ProjectKey,
    DateTimeOffset? CreatedAt,
    DateTimeOffset? StartedAt,
    DateTimeOffset? CompletedAt,
    TimeSpan? LeadTime,
    TimeSpan? CycleTime,
    int ReopenCount,
    bool Deleted)
{
    public bool IsComplete => CompletedAt is not null && !Deleted;
}
