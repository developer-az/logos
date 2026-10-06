using System.Text.Json;
using Metrics.Core.Domain;
using Metrics.Core.Events;

namespace Metrics.Core.Tests;

public class IssueEventProcessorTests
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    [Fact]
    public void Parses_the_contract_fixture_produced_by_the_gateway()
    {
        var wire = File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "Contract", "normalized-transition.json"));

        var evt = JsonSerializer.Deserialize<IssueEvent>(wire, Json)!;

        Assert.Equal(IssueEventType.Transitioned, evt.Type);
        Assert.Equal(StatusCategory.InProgress, evt.ToCategory);
        Assert.Equal("ABC-1", evt.IssueKey);
        Assert.Equal(new DateTimeOffset(2026, 10, 1, 9, 0, 0, TimeSpan.Zero), evt.OccurredAt);
    }

    [Fact]
    public void Reports_duplicates_and_rejects_future_schema_versions()
    {
        var processor = new IssueEventProcessor(new InMemoryIssueTimelineStore());
        var evt = new IssueEvent
        {
            Id = "1", Type = IssueEventType.Created, OccurredAt = DateTimeOffset.UnixEpoch,
            IssueKey = "ABC-1", ProjectKey = "ABC", ToCategory = StatusCategory.ToDo,
        };

        Assert.Equal(ProcessOutcome.Applied, processor.Process(evt).Outcome);
        Assert.Equal(ProcessOutcome.Duplicate, processor.Process(evt).Outcome);
        Assert.Throws<UnsupportedSchemaVersionException>(() => processor.Process(evt with { Id = "2", SchemaVersion = 99 }));
    }
}
