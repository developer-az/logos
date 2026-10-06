using System.Collections.Concurrent;

namespace Metrics.Core.Domain;

/// <summary>
/// Storage seam for issue timelines. The in-memory implementation is enough for the scaffold
/// (state can be rebuilt by replaying the topic from the earliest offset); a durable store such
/// as Postgres is on the add-on backlog.
/// </summary>
public interface IIssueTimelineStore
{
    IssueTimeline GetOrCreate(string issueKey);

    bool TryGet(string issueKey, out IssueTimeline? timeline);

    IReadOnlyCollection<IssueTimeline> All();
}

public sealed class InMemoryIssueTimelineStore : IIssueTimelineStore
{
    private readonly ConcurrentDictionary<string, IssueTimeline> _timelines = new(StringComparer.Ordinal);

    public IssueTimeline GetOrCreate(string issueKey) => _timelines.GetOrAdd(issueKey, k => new IssueTimeline(k));

    public bool TryGet(string issueKey, out IssueTimeline? timeline) => _timelines.TryGetValue(issueKey, out timeline);

    public IReadOnlyCollection<IssueTimeline> All() => _timelines.Values.ToList();
}
