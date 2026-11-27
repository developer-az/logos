using Catalog.Service.Domain;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Design;

namespace Catalog.Service.Data;

public sealed class CatalogDbContext(DbContextOptions<CatalogDbContext> options) : DbContext(options)
{
    public DbSet<Product> Products => Set<Product>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<Product>(b =>
        {
            b.ToTable("products");
            b.HasKey(p => p.Sku);
            b.Property(p => p.Sku).HasMaxLength(64);
            b.Property(p => p.Name).HasMaxLength(128);
            b.HasIndex(p => p.Active);
        });
    }
}

public sealed class CatalogDbContextFactory : IDesignTimeDbContextFactory<CatalogDbContext>
{
    public CatalogDbContext CreateDbContext(string[] args) =>
        new(new DbContextOptionsBuilder<CatalogDbContext>()
            .UseNpgsql("Host=localhost;Database=catalog;Username=postgres").Options);
}
