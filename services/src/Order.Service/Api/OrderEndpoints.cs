using Microsoft.EntityFrameworkCore;
using Order.Service.Data;
using Order.Service.Domain;
using OrderPlatform.Contracts;
using OrderPlatform.Messaging.Outbox;

namespace Order.Service.Api;

public sealed record PlaceOrderLine(string Sku, int Quantity, decimal UnitPrice);
public sealed record PlaceOrderRequest(string CustomerId, IReadOnlyList<PlaceOrderLine> Lines);
public sealed record CancelOrderRequest(string? Reason);

public sealed record OrderLineResponse(string Sku, int Quantity, decimal UnitPrice);
public sealed record OrderResponse(Guid Id, string CustomerId, string Status, string? StatusReason, decimal Total,
    IReadOnlyList<OrderLineResponse> Lines, Guid CorrelationId, DateTimeOffset CreatedAt, DateTimeOffset UpdatedAt)
{
    public static OrderResponse From(Domain.Order o) => new(o.Id, o.CustomerId, o.Status.ToString(), o.StatusReason, o.Total,
        o.Items.Select(i => new OrderLineResponse(i.Sku, i.Quantity, i.UnitPrice)).ToList(), o.CorrelationId, o.CreatedAt, o.UpdatedAt);
}

public static class OrderEndpoints
{
    public const string IdempotencyHeader = "Idempotency-Key";
    public const string CorrelationHeader = "X-Correlation-Id";

    public static IEndpointRouteBuilder MapOrderEndpoints(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/orders").WithTags("Orders");
        group.MapPost("/", PlaceAsync);
        group.MapGet("/{id:guid}", GetAsync);
        group.MapGet("/", ListAsync);
        group.MapPost("/{id:guid}/cancel", CancelAsync);
        return app;
    }

    /// <summary>Accepts the order (202) and stages OrderPlaced in the same transaction.
    /// The final status arrives asynchronously once inventory has decided.</summary>
    private static async Task<IResult> PlaceAsync(PlaceOrderRequest request, HttpContext http, OrdersDbContext db, TimeProvider clock, CancellationToken ct)
    {
        var idempotencyKey = http.Request.Headers[IdempotencyHeader].FirstOrDefault();
        if (idempotencyKey is { Length: > 100 })
            return Results.ValidationProblem(new Dictionary<string, string[]> { [IdempotencyHeader] = ["Must be at most 100 characters."] });

        if (idempotencyKey is not null)
        {
            var existing = await db.Orders.AsNoTracking().SingleOrDefaultAsync(o => o.IdempotencyKey == idempotencyKey, ct);
            if (existing is not null) return Results.Ok(OrderResponse.From(existing));
        }

        var correlationId = Guid.TryParse(http.Request.Headers[CorrelationHeader].FirstOrDefault(), out var c) ? c : Guid.NewGuid();
        Domain.Order order;
        try
        {
            order = Domain.Order.Place(Guid.NewGuid(), request.CustomerId,
                (request.Lines ?? []).Select(l => new OrderItem { Sku = l.Sku, Quantity = l.Quantity, UnitPrice = l.UnitPrice }),
                correlationId, idempotencyKey, clock.GetUtcNow());
        }
        catch (DomainException ex)
        {
            return Results.ValidationProblem(new Dictionary<string, string[]> { ["order"] = [ex.Message] });
        }

        db.Orders.Add(order);
        db.Enqueue(Topics.OrderEvents, order.Id.ToString(),
            new OrderPlaced(order.Id, order.CustomerId, order.Items.Select(i => new OrderLine(i.Sku, i.Quantity, i.UnitPrice)).ToList(), order.Total),
            correlationId, causationId: null, clock);

        try
        {
            await db.SaveChangesAsync(ct);
        }
        catch (DbUpdateException) when (idempotencyKey is not null)
        {
            // A concurrent request with the same key won the unique index.
            db.ChangeTracker.Clear();
            var winner = await db.Orders.AsNoTracking().SingleAsync(o => o.IdempotencyKey == idempotencyKey, ct);
            return Results.Ok(OrderResponse.From(winner));
        }

        return Results.Accepted($"/orders/{order.Id}", OrderResponse.From(order));
    }

    private static async Task<IResult> GetAsync(Guid id, OrdersDbContext db, CancellationToken ct) =>
        await db.Orders.AsNoTracking().SingleOrDefaultAsync(o => o.Id == id, ct) is { } order
            ? Results.Ok(OrderResponse.From(order))
            : Results.NotFound();

    private static async Task<IResult> ListAsync(OrdersDbContext db, CancellationToken ct, string? status = null, int limit = 50)
    {
        IQueryable<Domain.Order> query = db.Orders.AsNoTracking();
        if (status is not null)
        {
            if (!Enum.TryParse<OrderStatus>(status, ignoreCase: true, out var parsed))
                return Results.ValidationProblem(new Dictionary<string, string[]> { ["status"] = [$"Unknown status '{status}'."] });
            query = query.Where(o => o.Status == parsed);
        }

        var orders = await query.OrderByDescending(o => o.CreatedAt).Take(Math.Clamp(limit, 1, 200)).ToListAsync(ct);
        return Results.Ok(orders.Select(OrderResponse.From));
    }

    private static async Task<IResult> CancelAsync(Guid id, CancelOrderRequest? request, OrdersDbContext db, TimeProvider clock, CancellationToken ct)
    {
        var order = await db.Orders.SingleOrDefaultAsync(o => o.Id == id, ct);
        if (order is null) return Results.NotFound();

        try
        {
            order.Cancel(request?.Reason, clock.GetUtcNow());
        }
        catch (DomainException ex)
        {
            return Results.Problem(ex.Message, statusCode: StatusCodes.Status409Conflict);
        }

        db.Enqueue(Topics.OrderEvents, order.Id.ToString(), new OrderCancelled(order.Id, request?.Reason), order.CorrelationId, null, clock);
        try
        {
            await db.SaveChangesAsync(ct);
        }
        catch (DbUpdateConcurrencyException)
        {
            return Results.Problem("The order changed while cancelling; retry.", statusCode: StatusCodes.Status409Conflict);
        }
        return Results.Ok(OrderResponse.From(order));
    }
}
