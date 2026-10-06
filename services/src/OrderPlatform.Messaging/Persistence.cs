using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Storage.ValueConversion;

namespace OrderPlatform.Messaging;

public static class PersistenceModelExtensions
{
    /// <summary>SQLite (used by the tests) cannot compare or sort DateTimeOffset columns;
    /// store them as sortable integers there. PostgreSQL keeps native timestamptz.</summary>
    public static ModelBuilder UseSortableDateTimeOffsetOnSqlite(this ModelBuilder modelBuilder, DatabaseFacade database)
    {
        if (database.ProviderName != "Microsoft.EntityFrameworkCore.Sqlite") return modelBuilder;

        foreach (var property in modelBuilder.Model.GetEntityTypes().SelectMany(t => t.GetProperties()))
        {
            if (property.ClrType == typeof(DateTimeOffset) || property.ClrType == typeof(DateTimeOffset?))
                property.SetValueConverter(new DateTimeOffsetToBinaryConverter());
        }
        return modelBuilder;
    }
}
