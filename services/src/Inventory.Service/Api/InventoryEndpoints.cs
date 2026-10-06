using Inventory.Service.Data;
using Inventory.Service.Domain;
using Microsoft.EntityFrameworkCore;
using OrderPlatform.Contracts;
using OrderPlatform.Messaging.Outbox;

namespace Inventory.Service.Api;

public sealed record SetStockRequest(int OnHand);
public sealed record StockResponse(string Sku, int OnHand, int Reserved, int Available, DateTimeOffset UpdatedAt)
{
    public static StockResponse From(StockItem s) => new(s.Sku, s.OnHand, s.Reserved, s.Available, s.UpdatedAt);
}
public sealed record ReservationResponse(Guid OrderId, string Status, string? Reason, IReadOnlyList<ReservedLine> Lines, DateTimeOffset UpdatedAt);

public static class InventoryEndpoints
{
    public static IEndpointRouteBuilder MapInventoryEndpoints(this IEndpointRouteBuilder app)
    {
        var stock = app.MapGroup("/inventory").WithTags("Inventory");
        stock.MapGet("/", async (InventoryDbContext db, CancellationToken ct) =>
            (await db.StockItems.AsNoTracking().OrderBy(s => s.Sku).ToListAsync(ct)).Select(StockResponse.From));
        stock.MapGet("/{sku}", GetAsync);
        stock.MapPut("/{sku}", SetOnHandAsync);

        app.MapGet("/reservations/{orderId:guid}", async (Guid orderId, InventoryDbContext db, CancellationToken ct) =>
            await db.Reservations.AsNoTracking().SingleOrDefaultAsync(r => r.OrderId == orderId, ct) is { } r
                ? Results.Ok(new ReservationResponse(r.OrderId, r.Status.ToString(), r.Reason,
                    r.Lines.Select(l => new ReservedLine(l.Sku, l.Quantity)).ToList(), r.UpdatedAt))
                : Results.NotFound()).WithTags("Inventory");
        return app;
    }

    private static async Task<IResult> GetAsync(string sku, InventoryDbContext db, CancellationToken ct)
    {
        var normalized = sku.Trim().ToUpperInvariant();
        return await db.StockItems.AsNoTracking().SingleOrDefaultAsync(s => s.Sku == normalized, ct) is { } item
            ? Results.Ok(StockResponse.From(item))
            : Results.NotFound();
    }

    /// <summary>Sets the physical count for a SKU (creating it if new) and publishes the new level.</summary>
    private static async Task<IResult> SetOnHandAsync(string sku, SetStockRequest request, InventoryDbContext db, TimeProvider clock, CancellationToken ct)
    {
        var now = clock.GetUtcNow();
        StockItem item;
        try
        {
            var normalized = StockItem.NormalizeSku(sku);
            var existing = await db.StockItems.SingleOrDefaultAsync(s => s.Sku == normalized, ct);
            if (existing is null)
            {
                item = StockItem.Create(normalized, request.OnHand, now);
                db.StockItems.Add(item);
            }
            else
            {
                item = existing;
                item.SetOnHand(request.OnHand, now);
            }
        }
        catch (DomainException ex)
        {
            return Results.Problem(ex.Message, statusCode: StatusCodes.Status409Conflict);
        }

        db.Enqueue(Topics.InventoryEvents, item.Sku, new StockLevelChanged(item.Sku, item.OnHand, item.Reserved, item.Available, item.Revision),
            Guid.NewGuid(), null, clock);
        try
        {
            await db.SaveChangesAsync(ct);
        }
        catch (DbUpdateException)
        {
            return Results.Problem("Stock changed concurrently; retry.", statusCode: StatusCodes.Status409Conflict);
        }
        return Results.Ok(StockResponse.From(item));
    }
}
