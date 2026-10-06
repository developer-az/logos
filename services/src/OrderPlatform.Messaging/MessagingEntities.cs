using Microsoft.EntityFrameworkCore;

namespace OrderPlatform.Messaging;

/// <summary>An event written in the same database transaction as the state change that caused it,
/// then published to Kafka by <see cref="Outbox.OutboxDispatcher{TDbContext}"/>.</summary>
public sealed class OutboxMessage
{
    public long Id { get; set; }
    public Guid EventId { get; set; }
    public required string Topic { get; set; }
    public required string Key { get; set; }
    public required string EventType { get; set; }
    public required string Body { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset? PublishedAt { get; set; }
    public int Attempts { get; set; }
    public string? LastError { get; set; }
}

/// <summary>Records that a consumer already handled an event, which makes redelivery a no-op.</summary>
public sealed class InboxMessage
{
    public Guid EventId { get; set; }
    public required string Consumer { get; set; }
    public required string EventType { get; set; }
    public DateTimeOffset ProcessedAt { get; set; }
}

public interface IMessagingDbContext
{
    DbSet<OutboxMessage> OutboxMessages { get; }
    DbSet<InboxMessage> InboxMessages { get; }
}

public static class MessagingModelBuilderExtensions
{
    public static ModelBuilder ApplyMessagingModel(this ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<OutboxMessage>(b =>
        {
            b.ToTable("outbox_messages");
            b.HasKey(x => x.Id);
            b.Property(x => x.Id).HasColumnName("id").ValueGeneratedOnAdd();
            b.Property(x => x.EventId).HasColumnName("event_id");
            b.Property(x => x.Topic).HasColumnName("topic").HasMaxLength(249);
            b.Property(x => x.Key).HasColumnName("key").HasMaxLength(200);
            b.Property(x => x.EventType).HasColumnName("event_type").HasMaxLength(200);
            b.Property(x => x.Body).HasColumnName("body");
            b.Property(x => x.CreatedAt).HasColumnName("created_at");
            b.Property(x => x.PublishedAt).HasColumnName("published_at");
            b.Property(x => x.Attempts).HasColumnName("attempts");
            b.Property(x => x.LastError).HasColumnName("last_error").HasMaxLength(2000);
            b.HasIndex(x => x.EventId).IsUnique();
            b.HasIndex(x => x.PublishedAt);
        });

        modelBuilder.Entity<InboxMessage>(b =>
        {
            b.ToTable("inbox_messages");
            b.HasKey(x => new { x.EventId, x.Consumer });
            b.Property(x => x.EventId).HasColumnName("event_id");
            b.Property(x => x.Consumer).HasColumnName("consumer").HasMaxLength(200);
            b.Property(x => x.EventType).HasColumnName("event_type").HasMaxLength(200);
            b.Property(x => x.ProcessedAt).HasColumnName("processed_at");
        });

        return modelBuilder;
    }
}
