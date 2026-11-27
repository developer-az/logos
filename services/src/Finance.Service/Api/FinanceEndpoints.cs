using Finance.Service.Data;
using Finance.Service.Domain;
using Microsoft.EntityFrameworkCore;

namespace Finance.Service.Api;

public sealed record SettlementResponse(Guid OrderId, int AmountCents, int CostCents, int MarginCents,
    string Status, DateTimeOffset CreatedAt, DateTimeOffset UpdatedAt)
{
    public static SettlementResponse From(OrderSettlement s) =>
        new(s.OrderId, s.AmountCents, s.CostCents, s.AmountCents - s.CostCents, s.Status.ToString(), s.CreatedAt, s.UpdatedAt);
}

public sealed record FinanceSummary(int CapturedCents, int RefundedCents, int CogsCents, int MarginCents,
    int Pending, int Captured, int Refunded, int Cancelled);

public static class FinanceEndpoints
{
    public static IEndpointRouteBuilder MapFinanceEndpoints(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/finance").WithTags("Finance");

        group.MapGet("/summary", async (FinanceDbContext db, CancellationToken ct) =>
        {
            var settlements = await db.Settlements.AsNoTracking().ToListAsync(ct);
            var captured = settlements.Where(s => s.Status is SettlementStatus.Captured or SettlementStatus.Refunded).Sum(s => s.AmountCents);
            var refunded = settlements.Where(s => s.Status == SettlementStatus.Refunded).Sum(s => s.AmountCents);
            // Cost of every order that was ever captured, less the cost reversed by its refund.
            var cogs = settlements.Where(s => s.Status is SettlementStatus.Captured or SettlementStatus.Refunded).Sum(s => s.CostCents)
                       - settlements.Where(s => s.Status == SettlementStatus.Refunded).Sum(s => s.CostCents);
            return Results.Ok(new FinanceSummary(
                captured, refunded, cogs, captured - refunded - cogs,
                settlements.Count(s => s.Status == SettlementStatus.Pending),
                settlements.Count(s => s.Status == SettlementStatus.Captured),
                settlements.Count(s => s.Status == SettlementStatus.Refunded),
                settlements.Count(s => s.Status == SettlementStatus.Cancelled)));
        });

        group.MapGet("/settlements", async (FinanceDbContext db, CancellationToken ct, int limit = 50) =>
            Results.Ok((await db.Settlements.AsNoTracking()
                    .OrderByDescending(s => s.UpdatedAt)
                    .Take(Math.Clamp(limit, 1, 200))
                    .ToListAsync(ct))
                .Select(SettlementResponse.From)));

        group.MapGet("/settlements/{orderId:guid}", async (Guid orderId, FinanceDbContext db, CancellationToken ct) =>
            await db.Settlements.AsNoTracking().SingleOrDefaultAsync(s => s.OrderId == orderId, ct) is { } settlement
                ? Results.Ok(SettlementResponse.From(settlement))
                : Results.NotFound());

        return app;
    }
}
