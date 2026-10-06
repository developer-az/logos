namespace OrderPlatform.Contracts;

/// <summary>Kafka topic names. Every message is keyed by order id (or SKU for stock-level events)
/// so that all events for one aggregate land on one partition and are consumed in order.</summary>
public static class Topics
{
    public const string OrderEvents = "orders.events.v1";
    public const string InventoryEvents = "inventory.events.v1";

    /// <summary>Dead-letter topic for a source topic: messages that failed every retry.</summary>
    public static string DeadLetter(string topic) => $"{topic}.dlt";
}
