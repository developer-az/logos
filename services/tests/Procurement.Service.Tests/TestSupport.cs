global using Xunit;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.Extensions.Time.Testing;
using Procurement.Service.Data;

namespace Procurement.Service.Tests;

public sealed class ProcurementDb : IDisposable
{
    private readonly SqliteConnection _connection = new("DataSource=:memory:");

    public ProcurementDb()
    {
        _connection.Open();
        using var db = NewContext();
        db.Database.EnsureCreated();
    }

    public FakeTimeProvider Clock { get; } = new(new DateTimeOffset(2026, 11, 26, 12, 0, 0, TimeSpan.Zero));

    public ProcurementDbContext NewContext() =>
        new(new DbContextOptionsBuilder<ProcurementDbContext>().UseSqlite(_connection).Options);

    public void Dispose() => _connection.Dispose();
}

public sealed class ProcurementApiFactory : WebApplicationFactory<ProcurementServiceApp>
{
    private readonly SqliteConnection _connection = new("DataSource=:memory:");

    public ProcurementApiFactory()
    {
        _connection.Open();
        using var db = NewContext();
        db.Database.EnsureCreated();
    }

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        builder.UseSetting("Kafka:Enabled", "false");
        builder.UseSetting("Database:MigrateOnStartup", "false");
        builder.UseSetting("Procurement:SeedDemoData", "true");
        builder.ConfigureServices(services =>
        {
            services.RemoveAll<DbContextOptions<ProcurementDbContext>>();
            // EF Core 9+ also registers the provider through this; remove it or Npgsql and SQLite both load.
            services.RemoveAll<IDbContextOptionsConfiguration<ProcurementDbContext>>();
            services.AddDbContext<ProcurementDbContext>(o => o.UseSqlite(_connection));
        });
    }

    public ProcurementDbContext NewContext() =>
        new(new DbContextOptionsBuilder<ProcurementDbContext>().UseSqlite(_connection).Options);

    protected override void Dispose(bool disposing)
    {
        base.Dispose(disposing);
        _connection.Dispose();
    }
}
