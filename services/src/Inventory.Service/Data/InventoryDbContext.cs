using Inventory.Service.Domain;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Design;
using OrderPlatform.Messaging;

namespace Inventory.Service.Data;

public sealed class InventoryDbContext(DbContextOptions<InventoryDbContext> options) : DbContext(options), IMessagingDbContext
{
    public DbSet<StockItem> StockItems => Set<StockItem>();
    public DbSet<Reservation> Reservations => Set<Reservation>();
    public DbSet<OutboxMessage> OutboxMessages => Set<OutboxMessage>();
    public DbSet<InboxMessage> InboxMessages => Set<InboxMessage>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<StockItem>(b =>
        {
            b.ToTable("stock_items", t => t.HasCheckConstraint("ck_stock_reserved_within_on_hand", "\"Reserved\" >= 0 AND \"Reserved\" <= \"OnHand\""));
            b.HasKey(s => s.Sku);
            b.Property(s => s.Sku).HasMaxLength(64);
            b.Property(s => s.Version).IsConcurrencyToken();
            b.Ignore(s => s.Available);
        });

        modelBuilder.Entity<Reservation>(b =>
        {
            b.ToTable("reservations");
            b.HasKey(r => r.OrderId);
            b.Property(r => r.Status).HasConversion<string>().HasMaxLength(32);
            b.Property(r => r.Reason).HasMaxLength(500);
            b.OwnsMany(r => r.Lines, lines =>
            {
                lines.ToTable("reservation_lines");
                lines.WithOwner().HasForeignKey("OrderId");
                lines.Property<int>("Id");
                lines.HasKey("Id");
                lines.Property(l => l.Sku).HasMaxLength(64);
            });
            b.Navigation(r => r.Lines).HasField("_lines").UsePropertyAccessMode(PropertyAccessMode.Field);
        });

        modelBuilder.ApplyMessagingModel();
        modelBuilder.UseSortableDateTimeOffsetOnSqlite(Database);
    }
}

public sealed class InventoryDbContextFactory : IDesignTimeDbContextFactory<InventoryDbContext>
{
    public InventoryDbContext CreateDbContext(string[] args) =>
        new(new DbContextOptionsBuilder<InventoryDbContext>()
            .UseNpgsql("Host=localhost;Database=inventory;Username=postgres").Options);
}
