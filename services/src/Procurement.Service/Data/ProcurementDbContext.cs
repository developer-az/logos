using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Design;
using OrderPlatform.Messaging;
using Procurement.Service.Domain;

namespace Procurement.Service.Data;

public sealed class ProcurementDbContext(DbContextOptions<ProcurementDbContext> options)
    : DbContext(options), IMessagingDbContext
{
    public DbSet<SupplierQuote> Quotes => Set<SupplierQuote>();
    public DbSet<PurchaseOrder> PurchaseOrders => Set<PurchaseOrder>();
    public DbSet<OutboxMessage> OutboxMessages => Set<OutboxMessage>();
    public DbSet<InboxMessage> InboxMessages => Set<InboxMessage>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<SupplierQuote>(b =>
        {
            b.ToTable("supplier_quotes");
            b.HasKey(q => q.QuoteId);
            b.Property(q => q.Sku).HasMaxLength(64);
            b.Property(q => q.SupplierId).HasMaxLength(64);
            b.Property(q => q.SupplierName).HasMaxLength(64);
            // One standing offer per supplier per SKU; a new quote replaces the old row.
            b.HasIndex(q => new { q.Sku, q.SupplierId }).IsUnique();
        });

        modelBuilder.Entity<PurchaseOrder>(b =>
        {
            b.ToTable("purchase_orders");
            b.HasKey(p => p.Id);
            b.Property(p => p.Sku).HasMaxLength(64);
            b.Property(p => p.SupplierId).HasMaxLength(64);
            b.Property(p => p.SupplierName).HasMaxLength(64);
            b.Property(p => p.Status).HasConversion<string>().HasMaxLength(32);
            b.Property(p => p.Version).IsConcurrencyToken();
            b.Ignore(p => p.TotalCents);
            b.HasIndex(p => new { p.Status, p.ExpectedAt });
        });

        modelBuilder.ApplyMessagingModel();
        modelBuilder.UseSortableDateTimeOffsetOnSqlite(Database);
    }
}

public sealed class ProcurementDbContextFactory : IDesignTimeDbContextFactory<ProcurementDbContext>
{
    public ProcurementDbContext CreateDbContext(string[] args) =>
        new(new DbContextOptionsBuilder<ProcurementDbContext>()
            .UseNpgsql("Host=localhost;Database=procurement;Username=postgres").Options);
}
