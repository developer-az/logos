using System.Text.Json;
using OrderPlatform.Contracts;

namespace OrderPlatform.Messaging.Tests;

public class EventEnvelopeTests
{
    [Fact]
    public void Round_trips_type_metadata_and_payload()
    {
        var correlation = Guid.NewGuid();
        var cause = Guid.NewGuid();
        var placed = new OrderPlaced(Guid.NewGuid(), "c-1", [new OrderLine("SKU-1", 2, 9.99m)], 19.98m);

        var envelope = EventEnvelope.Create(placed, correlation, cause);
        var parsed = EventEnvelope.Deserialize(envelope.Serialize());

        Assert.Equal("order.placed", parsed.EventType);
        Assert.Equal(1, parsed.SchemaVersion);
        Assert.Equal(correlation, parsed.CorrelationId);
        Assert.Equal(cause, parsed.CausationId);
        Assert.Equal(envelope.EventId, parsed.EventId);
        var payload = parsed.PayloadAs<OrderPlaced>();
        Assert.Equal(placed.OrderId, payload.OrderId);
        Assert.Equal(placed.Lines, payload.Lines);
        Assert.Equal(19.98m, payload.Total);
    }

    [Fact]
    public void Uses_camel_case_on_the_wire()
    {
        var json = EventEnvelope.Create(new OrderConfirmed(Guid.Empty), Guid.Empty).Serialize();
        using var doc = JsonDocument.Parse(json);

        Assert.True(doc.RootElement.TryGetProperty("eventType", out _));
        Assert.True(doc.RootElement.GetProperty("payload").TryGetProperty("orderId", out _));
    }

    [Fact]
    public void Rejects_bodies_that_are_not_envelopes()
    {
        Assert.ThrowsAny<JsonException>(() => EventEnvelope.Deserialize("not json"));
        Assert.ThrowsAny<JsonException>(() => EventEnvelope.Deserialize("null"));
    }
}
