using System.Text.Json;
using System.Text.Json.Serialization;

namespace OrderPlatform.Contracts;

/// <summary>
/// Wire format for every event on Kafka. The payload is kept as raw JSON so consumers can
/// route on <see cref="EventType"/> and skip types they do not understand.
/// </summary>
public sealed record EventEnvelope(
    Guid EventId,
    string EventType,
    int SchemaVersion,
    Guid CorrelationId,
    Guid? CausationId,
    DateTimeOffset OccurredAt,
    JsonElement Payload)
{
    public static EventEnvelope Create<T>(T payload, Guid correlationId, Guid? causationId = null, DateTimeOffset? occurredAt = null)
        where T : IIntegrationEvent =>
        new(Guid.NewGuid(), T.EventType, T.SchemaVersion, correlationId, causationId,
            occurredAt ?? DateTimeOffset.UtcNow, JsonSerializer.SerializeToElement(payload, EventJson.Options));

    public T PayloadAs<T>() where T : IIntegrationEvent =>
        Payload.Deserialize<T>(EventJson.Options)
        ?? throw new JsonException($"Payload of event {EventId} could not be read as {typeof(T).Name}.");

    public string Serialize() => JsonSerializer.Serialize(this, EventJson.Options);

    public static EventEnvelope Deserialize(string json) =>
        JsonSerializer.Deserialize<EventEnvelope>(json, EventJson.Options)
        ?? throw new JsonException("Message body is not an event envelope.");
}

public interface IIntegrationEvent
{
    static abstract string EventType { get; }
    static abstract int SchemaVersion { get; }
}

public static class EventJson
{
    public static readonly JsonSerializerOptions Options = new(JsonSerializerDefaults.Web)
    {
        Converters = { new JsonStringEnumConverter(JsonNamingPolicy.CamelCase) },
    };
}
