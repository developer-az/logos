using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using OrderPlatform.Contracts;
using OrderPlatform.Messaging.Outbox;

namespace OrderPlatform.Messaging.Tests;

public sealed class OutboxDispatcherTests : IDisposable
{
    private readonly Microsoft.Data.Sqlite.SqliteConnection _connection = Sqlite.OpenInMemory();
    private readonly ServiceProvider _services;
    private readonly FakeProducer _producer = new();

    public OutboxDispatcherTests()
    {
        _services = new ServiceCollection()
            .AddDbContext<TestDbContext>(o => o.UseSqlite(_connection))
            .BuildServiceProvider();
        using var scope = _services.CreateScope();
        scope.ServiceProvider.GetRequiredService<TestDbContext>().Database.EnsureCreated();
    }

    private OutboxDispatcher<TestDbContext> CreateDispatcher(int batchSize = 100) => new(
        _services.GetRequiredService<IServiceScopeFactory>(), _producer,
        Options.Create(new KafkaOptions { OutboxBatchSize = batchSize }), TimeProvider.System,
        NullLogger<OutboxDispatcher<TestDbContext>>.Instance);

    private void Stage(params Guid[] orderIds)
    {
        using var scope = _services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<TestDbContext>();
        foreach (var id in orderIds)
            db.Enqueue(Topics.OrderEvents, id.ToString(), new OrderConfirmed(id), Guid.NewGuid(), null, TimeProvider.System);
        db.SaveChanges();
    }

    private List<OutboxMessage> Rows()
    {
        using var scope = _services.CreateScope();
        return scope.ServiceProvider.GetRequiredService<TestDbContext>().OutboxMessages.OrderBy(m => m.Id).ToList();
    }

    [Fact]
    public async Task Publishes_pending_rows_in_insertion_order_and_marks_them()
    {
        var ids = Enumerable.Range(0, 5).Select(_ => Guid.NewGuid()).ToArray();
        Stage(ids);

        var published = await CreateDispatcher().DispatchPendingAsync(default);

        Assert.Equal(5, published);
        Assert.Equal(ids.Select(i => i.ToString()), _producer.Produced.Select(m => m.Key));
        Assert.All(_producer.Produced, m => Assert.Equal("order.confirmed", m.Headers["event-type"]));
        Assert.All(Rows(), r => Assert.NotNull(r.PublishedAt));
        Assert.Equal(0, await CreateDispatcher().DispatchPendingAsync(default));
    }

    [Fact]
    public async Task Stops_at_a_failure_so_later_events_are_not_published_ahead_of_it()
    {
        var ids = new[] { Guid.NewGuid(), Guid.NewGuid(), Guid.NewGuid() };
        Stage(ids);
        _producer.ShouldFail = m => m.Key == ids[1].ToString();

        var published = await CreateDispatcher().DispatchPendingAsync(default);

        Assert.Equal(1, published);
        var rows = Rows();
        Assert.NotNull(rows[0].PublishedAt);
        Assert.Null(rows[1].PublishedAt);
        Assert.Equal(1, rows[1].Attempts);
        Assert.Contains("broker unavailable", rows[1].LastError);
        Assert.Null(rows[2].PublishedAt);

        _producer.ShouldFail = _ => false;
        Assert.Equal(2, await CreateDispatcher().DispatchPendingAsync(default));
        Assert.Equal(ids.Select(i => i.ToString()), _producer.Produced.Select(m => m.Key));
    }

    [Fact]
    public async Task Respects_the_batch_size()
    {
        Stage(Guid.NewGuid(), Guid.NewGuid(), Guid.NewGuid());

        Assert.Equal(2, await CreateDispatcher(batchSize: 2).DispatchPendingAsync(default));
        Assert.Equal(1, await CreateDispatcher(batchSize: 2).DispatchPendingAsync(default));
    }

    public void Dispose()
    {
        _services.Dispose();
        _connection.Dispose();
    }
}
