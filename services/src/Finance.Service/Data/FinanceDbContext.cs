using Finance.Service.Domain;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Design;
using OrderPlatform.Messaging;

namespace Finance.Service.Data;

public sealed class FinanceDbContext(DbContextOptions<FinanceDbContext> options)
    : DbContext(options), IMessagingDbContext
{
    public DbSet<OrderSettlement> Settlements => Set<OrderSettlement>();
    public DbSet<OutboxMessage> OutboxMessages => Set<OutboxMessage>();
    public DbSet<InboxMessage> InboxMessages => Set<InboxMessage>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<OrderSettlement>(b =>
        {
            b.ToTable("order_settlements");
            b.HasKey(s => s.OrderId);
            b.Property(s => s.Status).HasConversion<string>().HasMaxLength(32);
            b.Property(s => s.Version).IsConcurrencyToken();
            b.HasIndex(s => new { s.Status, s.UpdatedAt });
        });

        modelBuilder.ApplyMessagingModel();
        modelBuilder.UseSortableDateTimeOffsetOnSqlite(Database);
    }
}

public sealed class FinanceDbContextFactory : IDesignTimeDbContextFactory<FinanceDbContext>
{
    public FinanceDbContext CreateDbContext(string[] args) =>
        new(new DbContextOptionsBuilder<FinanceDbContext>()
            .UseNpgsql("Host=localhost;Database=finance;Username=postgres").Options);
}
