using System.Text.Json.Serialization;

namespace Metrics.Core.Events;

/// <summary>
/// Normalized issue event produced by the ingest gateway to topic <c>jira.issue-events.v1</c>.
/// The Kafka message key is <see cref="IssueKey"/>, so all events for one issue land on one
/// partition and are consumed in order. Schema is mirrored in services/ingest-gateway/src/events.ts.
/// </summary>
public sealed record IssueEvent
{
    public const int CurrentSchemaVersion = 1;

    [JsonPropertyName("schemaVersion")] public int SchemaVersion { get; init; } = CurrentSchemaVersion;

    /// <summary>Globally unique, deterministic id derived from the source webhook; used for dedupe.</summary>
    [JsonPropertyName("id")] public required string Id { get; init; }

    [JsonPropertyName("type")] public required IssueEventType Type { get; init; }

    [JsonPropertyName("occurredAt")] public required DateTimeOffset OccurredAt { get; init; }

    [JsonPropertyName("issueKey")] public required string IssueKey { get; init; }

    [JsonPropertyName("projectKey")] public required string ProjectKey { get; init; }

    [JsonPropertyName("toCategory")] public required StatusCategory ToCategory { get; init; }

    [JsonPropertyName("fromStatus")] public string? FromStatus { get; init; }

    [JsonPropertyName("toStatus")] public string? ToStatus { get; init; }
}

[JsonConverter(typeof(JsonStringEnumConverter<IssueEventType>))]
public enum IssueEventType
{
    [JsonStringEnumMemberName("issue.created")] Created,
    [JsonStringEnumMemberName("issue.transitioned")] Transitioned,
    [JsonStringEnumMemberName("issue.deleted")] Deleted,
}

/// <summary>Jira's three fixed status categories; individual workflows map their statuses onto these.</summary>
[JsonConverter(typeof(JsonStringEnumConverter<StatusCategory>))]
public enum StatusCategory
{
    [JsonStringEnumMemberName("todo")] ToDo,
    [JsonStringEnumMemberName("in_progress")] InProgress,
    [JsonStringEnumMemberName("done")] Done,
}
