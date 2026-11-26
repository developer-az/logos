using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using OrderPlatform.Contracts;
using OrderPlatform.Messaging.Outbox;
using Procurement.Service;
using Procurement.Service.Data;
using Procurement.Service.Domain;

namespace Procurement.Service.Api;

public sealed record PurchaseOrderRequest(string Sku, string SupplierId, int Quantity);

public sealed record QuoteResponse(Guid QuoteId, string Sku, string SupplierId, string SupplierName,
    int UnitCostCents, int LeadTimeDays, int Moq, double OnTimeRate, DateTimeOffset ReceivedAt)
{
    public static QuoteResponse From(SupplierQuote q) =>
        new(q.QuoteId, q.Sku, q.SupplierId, q.SupplierName, q.UnitCostCents, q.LeadTimeDays, q.Moq, q.OnTimeRate, q.ReceivedAt);
}

public sealed record PurchaseOrderResponse(Guid Id, string Sku, string SupplierId, string SupplierName,
    int Quantity, int UnitCostCents, int TotalCents, int LeadTimeDays, string Status,
    DateTimeOffset PlacedAt, DateTimeOffset ExpectedAt, DateTimeOffset? ReceivedAt)
{
    public static PurchaseOrderResponse From(PurchaseOrder p) =>
        new(p.Id, p.Sku, p.SupplierId, p.SupplierName, p.Quantity, p.UnitCostCents, p.TotalCents,
            p.LeadTimeDays, p.Status.ToString(), p.PlacedAt, p.ExpectedAt, p.ReceivedAt);
}

public static class ProcurementEndpoints
{
    public static IEndpointRouteBuilder MapProcurementEndpoints(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/procurement").WithTags("Procurement");

        group.MapGet("/suppliers", async (ProcurementDbContext db, CancellationToken ct) =>
            (await db.Quotes.AsNoTracking()
                .OrderBy(q => q.Sku).ThenBy(q => q.UnitCostCents)
                .ToListAsync(ct))
            .Select(QuoteResponse.From));

        group.MapGet("/purchase-orders", ListAsync);
        group.MapGet("/purchase-orders/{id:guid}", GetAsync);
        group.MapPost("/purchase-orders", PlaceAsync);
        return app;
    }

    private static async Task<IResult> ListAsync(ProcurementDbContext db, CancellationToken ct, int limit = 50) =>
        Results.Ok((await db.PurchaseOrders.AsNoTracking()
                .OrderByDescending(p => p.PlacedAt)
                .Take(Math.Clamp(limit, 1, 200))
                .ToListAsync(ct))
            .Select(PurchaseOrderResponse.From));

    private static async Task<IResult> GetAsync(Guid id, ProcurementDbContext db, CancellationToken ct) =>
        await db.PurchaseOrders.AsNoTracking().SingleOrDefaultAsync(p => p.Id == id, ct) is { } order
            ? Results.Ok(PurchaseOrderResponse.From(order))
            : Results.NotFound();

    /// <summary>
    /// Accepts a purchase order (201) and stages the event in the same transaction. Goods arrive
    /// later in a goods-received event; inventory raises stock from that, not from this call.
    /// </summary>
    private static async Task<IResult> PlaceAsync(
        PurchaseOrderRequest request,
        ProcurementDbContext db,
        TimeProvider clock,
        IOptions<ProcurementOptions> options,
        CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(request.Sku) || string.IsNullOrWhiteSpace(request.SupplierId))
            return Results.ValidationProblem(new Dictionary<string, string[]>
            {
                ["purchaseOrder"] = ["sku and supplierId are required."],
            });

        var sku = request.Sku.Trim().ToUpperInvariant();
        var quote = await db.Quotes.AsNoTracking()
            .SingleOrDefaultAsync(q => q.Sku == sku && q.SupplierId == request.SupplierId, ct);
        if (quote is null)
            return Results.ValidationProblem(new Dictionary<string, string[]>
            {
                ["purchaseOrder"] = [$"No quote for {sku} from {request.SupplierId}."],
            });

        var leadTime = TimeSpan.FromSeconds(quote.LeadTimeDays * options.Value.DaySeconds);
        PurchaseOrder order;
        try
        {
            order = PurchaseOrder.Place(Guid.NewGuid(), quote, request.Quantity, leadTime, clock.GetUtcNow());
        }
        catch (DomainException ex)
        {
            return Results.ValidationProblem(new Dictionary<string, string[]> { ["quantity"] = [ex.Message] });
        }

        db.PurchaseOrders.Add(order);
        db.Enqueue(Topics.ProcurementEvents, order.Sku,
            new PurchaseOrderPlaced(order.Id, order.Sku, order.SupplierId, order.SupplierName,
                order.Quantity, order.UnitCostCents, order.LeadTimeDays),
            Guid.NewGuid(), null, clock);
        await db.SaveChangesAsync(ct);

        return Results.Created($"/procurement/purchase-orders/{order.Id}", PurchaseOrderResponse.From(order));
    }
}
