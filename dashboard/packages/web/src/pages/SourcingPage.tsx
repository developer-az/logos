import { useEffect, useState } from 'react';
import { DEMO_LEAD_TIME_DAY_MS, type DashboardSnapshot, type SupplierQuote } from '@orderflow/contracts';
import { productName } from '../lib/catalogue';
import type { CatalogItem, CommerceActions } from '../lib/commerce';
import { formatAgo, formatDuration, formatMoney, formatPercent } from '../lib/format';

type Notice = { tone: 'ok' | 'error'; text: string } | null;

/**
 * The second saga. Every SKU is quoted by three suppliers with a real trade-off: the cheapest is
 * the slowest, the fastest is the dearest, and the minimum order decides how much cash a small
 * restock ties up. Raising a purchase order emits an event; the goods receipt raises stock.
 */
export function SourcingPage({
  snapshot,
  catalog,
  now,
  currency,
  actions,
}: {
  snapshot: DashboardSnapshot | null;
  catalog: CatalogItem[];
  now: Date;
  currency: string;
  actions: CommerceActions;
}) {
  const [picked, setPicked] = useState<string | null>(null);
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [notice, setNotice] = useState<Notice>(null);
  const [ordering, setOrdering] = useState<string | null>(null);

  const lowStock = snapshot?.inventory.lowStock ?? [];
  const quotes = snapshot?.procurement.quotes ?? [];
  const orders = snapshot?.procurement.purchaseOrders ?? [];
  const skus = [...new Set(quotes.map((q) => q.sku))].sort();
  const suggested = lowStock[0]?.sku ?? skus[0] ?? null;
  const sku = picked ?? suggested;
  // Pin the first suggestion once, so a live reorder point cannot change the SKU under a click.
  useEffect(() => {
    if (!picked && suggested) setPicked(suggested);
  }, [picked, suggested]);
  const skuQuotes = quotes
    .filter((q) => q.sku === sku)
    .sort((a, b) => a.unitCostCents - b.unitCostCents);
  const inStock = new Map(catalog.map((c) => [c.sku, c.available]));
  const cheapest = skuQuotes[0]?.supplierId;
  const fastest = skuQuotes.reduce<SupplierQuote | undefined>(
    (best, q) => (!best || q.leadTimeDays < best.leadTimeDays ? q : best),
    undefined,
  )?.supplierId;

  const quantityFor = (q: SupplierQuote) =>
    quantities[`${q.sku}|${q.supplierId}`] ?? Math.max(q.moq, 12);

  const order = async (q: SupplierQuote) => {
    setOrdering(q.quoteId);
    try {
      const result = await actions.placePurchaseOrder(q.sku, q.supplierId, quantityFor(q));
      setNotice(
        result.ok
          ? { tone: 'ok', text: `${result.message} Watch the stock level change when it arrives.` }
          : { tone: 'error', text: result.error },
      );
    } finally {
      setOrdering(null);
    }
  };

  return (
    <>
      <div className="title-row">
        <div>
          <h1>Sourcing</h1>
          <p className="sub">
            Three suppliers quote every SKU. Choosing one raises a purchase order; the receipt
            restocks the shelf.
          </p>
        </div>
        <span className="quiet-button" aria-hidden="true">
          {quotes.length} quotes
        </span>
      </div>

      {!snapshot ? (
        <p className="empty" role="status">
          Waiting for the first update…
        </p>
      ) : quotes.length === 0 ? (
        <section className="card" aria-labelledby="no-quotes">
          <h2 id="no-quotes">No supplier quotes</h2>
          <p className="card-hint">
            This backend does not publish <span className="mono">procurement.events.v1</span>. The
            public demo simulates the procurement service in the browser.
          </p>
        </section>
      ) : (
        <>
          {actions.unavailableReason && <p className="notice">{actions.unavailableReason}</p>}
          {notice && (
            <p className={`notice ${notice.tone === 'error' ? 'notice-error' : 'notice-ok'}`} role="status">
              {notice.text}
            </p>
          )}

          <div className="workbench workbench-top">
            <section className="card span-8" aria-labelledby="quotes-title">
              <div className="panel-head">
                <div>
                  <h2 id="quotes-title">
                    Supplier quotes{sku ? ` · ${productName(sku)}` : ''}
                  </h2>
                  <p className="card-hint">
                    Landed cost is unit cost × quantity. Lead time is compressed in this demo:
                    one supplier day is {formatDuration(DEMO_LEAD_TIME_DAY_MS)}.
                  </p>
                </div>
              </div>
              <table className="stack-table quote-table">
                <thead>
                  <tr>
                    <th>Supplier</th>
                    <th className="num">Unit cost</th>
                    <th className="num">Lead time</th>
                    <th className="num">MOQ</th>
                    <th className="num">On time</th>
                    <th className="num">Quantity</th>
                    <th className="num">Landed</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {skuQuotes.map((q) => {
                    const quantity = quantityFor(q);
                    return (
                      <tr key={q.quoteId}>
                        <td className="quote-supplier">
                          <strong>{q.supplierName}</strong>
                          <span className="quote-tags">
                            {q.supplierId === cheapest && <span className="tag">Cheapest</span>}
                            {q.supplierId === fastest && <span className="tag">Fastest</span>}
                          </span>
                        </td>
                        <td className="num" data-label="Unit cost">
                          {formatMoney(q.unitCostCents, currency)}
                        </td>
                        <td className="num" data-label="Lead time">
                          {q.leadTimeDays} d
                        </td>
                        <td className="num" data-label="MOQ">
                          {q.moq}
                        </td>
                        <td className="num" data-label="On time">
                          {formatPercent(q.onTimeRate)}
                        </td>
                        <td className="num" data-label="Quantity">
                          <input
                            className="qty-input"
                            type="number"
                            min={q.moq}
                            max={500}
                            value={quantity}
                            aria-label={`Quantity from ${q.supplierName}`}
                            onChange={(e) =>
                              setQuantities((current) => ({
                                ...current,
                                [`${q.sku}|${q.supplierId}`]: Math.max(
                                  q.moq,
                                  Math.min(500, Number(e.target.value) || q.moq),
                                ),
                              }))
                            }
                          />
                        </td>
                        <td className="num" data-label="Landed">
                          {formatMoney(q.unitCostCents * quantity, currency)}
                        </td>
                        <td className="stack-action">
                          <button
                            type="button"
                            className="quiet-button"
                            disabled={!!actions.unavailableReason || ordering !== null}
                            onClick={() => void order(q)}
                          >
                            {ordering === q.quoteId ? 'Ordering…' : 'Order'}
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </section>

            <div className="stack span-4">
              <section className="card" aria-labelledby="reorder-title">
                <h2 id="reorder-title">Reorder point</h2>
                <p className="card-hint">
                  Available stock at or below {snapshot.inventory.lowStockThreshold} triggers a
                  restock conversation.
                </p>
                <label className="sku-picker">
                  <span>Product</span>
                  <select value={sku ?? ''} onChange={(e) => setPicked(e.target.value)}>
                    {skus.map((option) => (
                      <option key={option} value={option}>
                        {productName(option)} · {option} · {inStock.get(option) ?? 0} available
                      </option>
                    ))}
                  </select>
                </label>
                {lowStock.length === 0 ? (
                  <p className="empty">Every SKU is above the reorder point.</p>
                ) : (
                  <ul className="reorder-list">
                    {lowStock.slice(0, 6).map((item) => (
                      <li key={item.sku}>
                        <button
                          type="button"
                          className={`reorder-sku${item.sku === sku ? ' is-picked' : ''}`}
                          onClick={() => setPicked(item.sku)}
                          aria-pressed={item.sku === sku}
                        >
                          <span className="reorder-product">
                            <span className="product-name">{productName(item.sku)}</span>
                            <span className="mono product-sku">{item.sku}</span>
                          </span>
                          <span className="reorder-level">
                            {item.available} available
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                <p className="card-hint reorder-note">
                  The list is what the read model flags right now. The picker reaches every SKU.
                </p>
              </section>

              <section className="card" aria-labelledby="stock-title">
                <h2 id="stock-title">Shelf now</h2>
                <p className="card-hint">Availability the store is selling against.</p>
                <dl className="facts">
                  <dt>Product</dt>
                  <dd>{sku ? productName(sku) : '—'}</dd>
                  <dt>SKU</dt>
                  <dd className="mono">{sku ?? '—'}</dd>
                  <dt>Available</dt>
                  <dd>{sku ? (inStock.get(sku) ?? 0) : '—'}</dd>
                  <dt>Open orders</dt>
                  <dd>{orders.filter((o) => o.status === 'in-transit').length}</dd>
                </dl>
              </section>
            </div>

            <section className="card span-12" aria-labelledby="po-title">
              <div className="panel-head">
                <div>
                  <h2 id="po-title">Purchase orders</h2>
                  <p className="card-hint">
                    Raised from the quotes above. Goods move to received when the lead time
                    elapses.
                  </p>
                </div>
              </div>
              {orders.length === 0 ? (
                <p className="empty">No purchase orders yet. Order from a supplier above.</p>
              ) : (
                <table className="stack-table">
                  <thead>
                    <tr>
                      <th>SKU</th>
                      <th>Supplier</th>
                      <th className="num">Quantity</th>
                      <th className="num">Total</th>
                      <th>Raised</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {orders.map((po) => {
                      const expectedAt =
                        Date.parse(po.placedAt) + po.leadTimeDays * DEMO_LEAD_TIME_DAY_MS;
                      return (
                        <tr key={po.purchaseOrderId}>
                          <td className="stack-sku">
                            <span className="product-name">{productName(po.sku)}</span>
                            <span className="mono product-sku">{po.sku}</span>
                          </td>
                          <td data-label="Supplier">{po.supplierName}</td>
                          <td className="num" data-label="Quantity">
                            {po.quantity}
                          </td>
                          <td className="num" data-label="Total">
                            {formatMoney(po.totalCents, currency)}
                          </td>
                          <td data-label="Raised">{formatAgo(po.placedAt, now)}</td>
                          <td data-label="Status">
                            {po.status === 'received' ? (
                              <span className="pill pill-confirmed">Received</span>
                            ) : (
                              <span className="pill pill-placed">
                                In transit · {formatDuration(Math.max(0, expectedAt - now.getTime()))}
                              </span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </section>
          </div>
        </>
      )}
    </>
  );
}
