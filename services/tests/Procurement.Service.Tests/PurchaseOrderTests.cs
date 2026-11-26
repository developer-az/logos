using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;
using OrderPlatform.Contracts;
using Procurement.Service.Data;
using Procurement.Service.Domain;
using Procurement.Service.Messaging;

namespace Procurement.Service.Tests;

public sealed class PurchaseOrderTests
{
    private static SupplierQuote Quote(int moq = 6) =>
        SupplierQuote.Create(Guid.NewGuid(), "WEBCAM-HD", "northwind", "Northwind Supply", 5184, 3, moq, 0.97,
            new DateTimeOffset(2026, 11, 26, 12, 0, 0, TimeSpan.Zero));

    [Fact]
    public void A_purchase_order_fixes_its_arrival_and_rejects_less_than_the_minimum()
    {
        var now = new DateTimeOffset(2026, 11, 26, 12, 0, 0, TimeSpan.Zero);
        var quote = Quote(moq: 6);

        var order = PurchaseOrder.Place(Guid.NewGuid(), quote, 12, TimeSpan.FromDays(3), now);
        Assert.Equal(now + TimeSpan.FromDays(3), order.ExpectedAt);
        Assert.Equal(12 * 5184, order.TotalCents);
        Assert.Equal(PurchaseOrderStatus.InTransit, order.Status);

        Assert.Throws<DomainException>(() => PurchaseOrder.Place(Guid.NewGuid(), quote, 5, TimeSpan.FromDays(3), now));
        Assert.Throws<DomainException>(() => PurchaseOrder.Place(Guid.NewGuid(), quote, 0, TimeSpan.FromDays(3), now));
    }

    [Fact]
    public void An_order_can_only_be_received_once()
    {
        var now = new DateTimeOffset(2026, 11, 26, 12, 0, 0, TimeSpan.Zero);
        var order = PurchaseOrder.Place(Guid.NewGuid(), Quote(), 12, TimeSpan.FromDays(3), now);

        Assert.False(order.IsDue(now));
        Assert.True(order.IsDue(now + TimeSpan.FromDays(3)));

        order.Receive(now + TimeSpan.FromDays(3));
        Assert.Equal(PurchaseOrderStatus.Received, order.Status);
        Assert.Throws<DomainException>(() => order.Receive(now + TimeSpan.FromDays(4)));
    }
}

public sealed class GoodsReceiptTests : IDisposable
{
    private readonly ProcurementDb _db = new();

    public void Dispose() => _db.Dispose();

    [Fact]
    public async Task Due_orders_become_goods_receipts_once()
    {
        Guid purchaseOrderId;
        await using (var db = _db.NewContext())
        {
            await CatalogSeeder.SeedAsync(db, _db.Clock);
            var quote = await db.Quotes.SingleAsync(q => q.Sku == "WEBCAM-HD" && q.SupplierId == "kiloparts");
            var order = PurchaseOrder.Place(Guid.NewGuid(), quote, 9,
                TimeSpan.FromSeconds(quote.LeadTimeDays * 10), _db.Clock.GetUtcNow());
            purchaseOrderId = order.Id;
            db.PurchaseOrders.Add(order);
            await db.SaveChangesAsync();
        }

        await using (var db = _db.NewContext())
        {
            var service = new GoodsReceiptService(db, _db.Clock, NullLogger<GoodsReceiptService>.Instance);
            Assert.Equal(0, await service.ReceiveDueAsync(default));

            _db.Clock.Advance(TimeSpan.FromSeconds(120));
            Assert.Equal(1, await service.ReceiveDueAsync(default));
            Assert.Equal(0, await service.ReceiveDueAsync(default));
        }

        await using (var db = _db.NewContext())
        {
            var order = await db.PurchaseOrders.SingleAsync(p => p.Id == purchaseOrderId);
            Assert.Equal(PurchaseOrderStatus.Received, order.Status);
            Assert.NotNull(order.ReceivedAt);

            var receipt = await db.OutboxMessages
                .Where(m => m.EventType == GoodsReceived.EventType)
                .Select(m => m.Body)
                .SingleAsync();
            var payload = EventEnvelope.Deserialize(receipt).PayloadAs<GoodsReceived>();
            Assert.Equal((purchaseOrderId, "WEBCAM-HD", 9), (payload.PurchaseOrderId, payload.Sku, payload.Quantity));
        }
    }
}
