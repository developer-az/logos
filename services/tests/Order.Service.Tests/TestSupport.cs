global using Xunit;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.Extensions.Time.Testing;
using Order.Service;
using Order.Service.Data;

namespace Order.Service.Tests;

/// <summary>An in-memory SQLite OrdersDbContext for handler tests.</summary>
public sealed class OrdersDb : IDisposable
{
    private readonly SqliteConnection _connection = new("DataSource=:memory:");

    public OrdersDb()
    {
        _connection.Open();
        using var db = NewContext();
        db.Database.EnsureCreated();
    }

    public FakeTimeProvider Clock { get; } = new(new DateTimeOffset(2026, 10, 6, 12, 0, 0, TimeSpan.Zero));

    public OrdersDbContext NewContext() => new(new DbContextOptionsBuilder<OrdersDbContext>().UseSqlite(_connection).Options);

    public void Dispose() => _connection.Dispose();
}

/// <summary>The real app over SQLite with Kafka switched off, for HTTP-level tests.</summary>
public sealed class OrderApiFactory : WebApplicationFactory<OrderServiceApp>
{
    private readonly SqliteConnection _connection = new("DataSource=:memory:");

    public OrderApiFactory()
    {
        _connection.Open();
        using var db = NewContext();
        db.Database.EnsureCreated();
    }

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        builder.UseSetting("Kafka:Enabled", "false");
        builder.UseSetting("Database:MigrateOnStartup", "false");
        builder.ConfigureServices(services =>
        {
            services.RemoveAll<DbContextOptions<OrdersDbContext>>();
            // EF Core 9+ also registers the provider through this; remove it or Npgsql and SQLite both load.
            services.RemoveAll<IDbContextOptionsConfiguration<OrdersDbContext>>();
            services.AddDbContext<OrdersDbContext>(o => o.UseSqlite(_connection));
        });
    }

    public OrdersDbContext NewContext() => new(new DbContextOptionsBuilder<OrdersDbContext>().UseSqlite(_connection).Options);

    protected override void Dispose(bool disposing)
    {
        base.Dispose(disposing);
        _connection.Dispose();
    }
}
