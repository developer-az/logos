global using Xunit;
using Inventory.Service.Data;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.Extensions.Time.Testing;

namespace Inventory.Service.Tests;

public sealed class InventoryDb : IDisposable
{
    private readonly SqliteConnection _connection = new("DataSource=:memory:");

    public InventoryDb()
    {
        _connection.Open();
        using var db = NewContext();
        db.Database.EnsureCreated();
    }

    public FakeTimeProvider Clock { get; } = new(new DateTimeOffset(2026, 10, 6, 12, 0, 0, TimeSpan.Zero));

    public InventoryDbContext NewContext() => new(new DbContextOptionsBuilder<InventoryDbContext>().UseSqlite(_connection).Options);

    public void Dispose() => _connection.Dispose();
}

public sealed class InventoryApiFactory : WebApplicationFactory<InventoryServiceApp>
{
    private readonly SqliteConnection _connection = new("DataSource=:memory:");

    public InventoryApiFactory()
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
            services.RemoveAll<DbContextOptions<InventoryDbContext>>();
            services.AddDbContext<InventoryDbContext>(o => o.UseSqlite(_connection));
        });
    }

    public InventoryDbContext NewContext() => new(new DbContextOptionsBuilder<InventoryDbContext>().UseSqlite(_connection).Options);

    protected override void Dispose(bool disposing)
    {
        base.Dispose(disposing);
        _connection.Dispose();
    }
}
