global using Xunit;
using Catalog.Service.Data;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;

namespace Catalog.Service.Tests;

public sealed class CatalogApiFactory : WebApplicationFactory<CatalogServiceApp>
{
    private readonly SqliteConnection _connection = new("DataSource=:memory:");

    public CatalogApiFactory()
    {
        _connection.Open();
        using var db = NewContext();
        db.Database.EnsureCreated();
    }

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        builder.UseSetting("Database:MigrateOnStartup", "false");
        builder.UseSetting("Catalog:SeedDemoData", "true");
        builder.ConfigureServices(services =>
        {
            services.RemoveAll<DbContextOptions<CatalogDbContext>>();
            services.RemoveAll<IDbContextOptionsConfiguration<CatalogDbContext>>();
            services.AddDbContext<CatalogDbContext>(o => o.UseSqlite(_connection));
        });
    }

    public CatalogDbContext NewContext() =>
        new(new DbContextOptionsBuilder<CatalogDbContext>().UseSqlite(_connection).Options);

    protected override void Dispose(bool disposing)
    {
        base.Dispose(disposing);
        _connection.Dispose();
    }
}
