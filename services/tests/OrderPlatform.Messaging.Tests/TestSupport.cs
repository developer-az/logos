global using Xunit;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using OrderPlatform.Messaging;

namespace OrderPlatform.Messaging.Tests;

public sealed class TestDbContext(DbContextOptions<TestDbContext> options) : DbContext(options), IMessagingDbContext
{
    public DbSet<OutboxMessage> OutboxMessages => Set<OutboxMessage>();
    public DbSet<InboxMessage> InboxMessages => Set<InboxMessage>();

    protected override void OnModelCreating(ModelBuilder modelBuilder) =>
        modelBuilder.ApplyMessagingModel().UseSortableDateTimeOffsetOnSqlite(Database);
}

/// <summary>Records produced messages; can be told to fail for chosen messages.</summary>
public sealed class FakeProducer : IMessageProducer
{
    public List<OutgoingMessage> Produced { get; } = [];
    public Func<OutgoingMessage, bool> ShouldFail { get; set; } = _ => false;

    public Task ProduceAsync(OutgoingMessage message, CancellationToken ct)
    {
        if (ShouldFail(message)) throw new InvalidOperationException("broker unavailable");
        lock (Produced) Produced.Add(message);
        return Task.CompletedTask;
    }
}

public static class Sqlite
{
    /// <summary>An in-memory database that lives as long as the returned connection stays open.</summary>
    public static SqliteConnection OpenInMemory()
    {
        var connection = new SqliteConnection("DataSource=:memory:");
        connection.Open();
        return connection;
    }
}
