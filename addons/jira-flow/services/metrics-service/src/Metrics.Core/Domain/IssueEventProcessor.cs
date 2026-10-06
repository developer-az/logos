using Metrics.Core.Events;

namespace Metrics.Core.Domain;

public enum ProcessOutcome { Applied, Duplicate }

public sealed record ProcessResult(ProcessOutcome Outcome, IssueMetrics Metrics);

/// <summary>Transport-agnostic handler: the Kafka consumer calls this, tests call it directly.</summary>
public sealed class IssueEventProcessor(IIssueTimelineStore store)
{
    public ProcessResult Process(IssueEvent evt)
    {
        if (evt.SchemaVersion > IssueEvent.CurrentSchemaVersion)
            throw new UnsupportedSchemaVersionException(evt.SchemaVersion);

        var timeline = store.GetOrCreate(evt.IssueKey);
        // A timeline is only touched by the consumer that owns its partition, but the HTTP
        // read path may call Compute() concurrently, so serialize access per issue.
        lock (timeline)
        {
            var applied = timeline.Apply(evt);
            return new ProcessResult(applied ? ProcessOutcome.Applied : ProcessOutcome.Duplicate, timeline.Compute());
        }
    }
}

public sealed class UnsupportedSchemaVersionException(int version)
    : Exception($"Issue event schema version {version} is newer than supported version {IssueEvent.CurrentSchemaVersion}.");
