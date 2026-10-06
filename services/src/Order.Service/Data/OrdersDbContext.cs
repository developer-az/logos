using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Design;
using OrderPlatform.Messaging;

namespace Order.Service.Data;

public sealed class OrdersDbContext(DbContextOptions<OrdersDbContext> options) : DbContext(options), IMessagingDbContext
{
    public DbSet<Domain.Order> Orders => Set<Domain.Order>();
    public DbSet<OutboxMessage> OutboxMessages => Set<OutboxMessage>();
    public DbSet<InboxMessage> InboxMessages => Set<InboxMessage>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<Domain.Order>(b =>
        {
            b.ToTable("orders");
            b.HasKey(o => o.Id);
            b.Property(o => o.CustomerId).HasMaxLength(100);
            b.Property(o => o.Status).HasConversion<string>().HasMaxLength(20);
            b.Property(o => o.Total).HasPrecision(18, 2);
            b.Property(o => o.StatusReason).HasMaxLength(500);
            b.Property(o => o.IdempotencyKey).HasMaxLength(100);
            b.Property(o => o.Version).IsConcurrencyToken();
            b.HasIndex(o => o.IdempotencyKey).IsUnique();
            b.HasIndex(o => new { o.Status, o.CreatedAt });
            b.OwnsMany(o => o.Items, items =>
            {
                items.ToTable("order_items");
                items.WithOwner().HasForeignKey("OrderId");
                items.Property<int>("Id");
                items.HasKey("Id");
                items.Property(i => i.Sku).HasMaxLength(64);
                items.Property(i => i.UnitPrice).HasPrecision(18, 2);
            });
            b.Navigation(o => o.Items).HasField("_items").UsePropertyAccessMode(PropertyAccessMode.Field);
        });

        modelBuilder.ApplyMessagingModel();
        modelBuilder.UseSortableDateTimeOffsetOnSqlite(Database);
    }
}

/// <summary>Lets `dotnet ef migrations` build the context without starting the app.</summary>
public sealed class OrdersDbContextFactory : IDesignTimeDbContextFactory<OrdersDbContext>
{
    public OrdersDbContext CreateDbContext(string[] args) =>
        new(new DbContextOptionsBuilder<OrdersDbContext>()
            .UseNpgsql("Host=localhost;Database=orders;Username=postgres").Options);
}
