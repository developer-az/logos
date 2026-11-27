global using Xunit;
using Finance.Service.Data;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.Extensions.Time.Testing;

namespace Finance.Service.Tests;

public sealed class FinanceDb : IDisposable
{
    private readonly SqliteConnection _connection = new("DataSource=:memory:");

    public FinanceDb()
    {
        _connection.Open();
        using var db = NewContext();
        db.Database.EnsureCreated();
    }

    public FakeTimeProvider Clock { get; } = new(new DateTimeOffset(2026, 11, 26, 12, 0, 0, TimeSpan.Zero));

    public FinanceDbContext NewContext() =>
        new(new DbContextOptionsBuilder<FinanceDbContext>().UseSqlite(_connection).Options);

    public void Dispose() => _connection.Dispose();
}

public sealed class FinanceApiFactory : WebApplicationFactory<FinanceServiceApp>
{
    private readonly SqliteConnection _connection = new("DataSource=:memory:");

    public FinanceApiFactory()
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
            services.RemoveAll<DbContextOptions<FinanceDbContext>>();
            // EF Core 9+ also registers the provider through this; remove it or Npgsql and SQLite both load.
            services.RemoveAll<IDbContextOptionsConfiguration<FinanceDbContext>>();
            services.AddDbContext<FinanceDbContext>(o => o.UseSqlite(_connection));
        });
    }

    public FinanceDbContext NewContext() =>
        new(new DbContextOptionsBuilder<FinanceDbContext>().UseSqlite(_connection).Options);

    protected override void Dispose(bool disposing)
    {
        base.Dispose(disposing);
        _connection.Dispose();
    }
}
