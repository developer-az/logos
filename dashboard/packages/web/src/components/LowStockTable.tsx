import type { InventoryView } from '@orderflow/contracts';
import { formatCount } from '../lib/format';

export function LowStockTable({ items, threshold, skus }: { items: InventoryView[]; threshold: number; skus: number }) {
  return (
    <section className="card" aria-labelledby="stock-title">
      <h2 id="stock-title">Low stock</h2>
      <p className="sub">
        {formatCount(items.length)} of {formatCount(skus)} SKUs at or below {threshold} available
      </p>
      {items.length === 0 ? (
        <p className="empty">Every SKU is above the threshold.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th scope="col">SKU</th>
              <th scope="col">State</th>
              <th scope="col" className="num">Available</th>
              <th scope="col" className="num">Reserved</th>
              <th scope="col" className="num hide-narrow">On hand</th>
            </tr>
          </thead>
          <tbody>
            {items.map((i) => (
              <tr key={i.sku}>
                <td className="mono">{i.sku}</td>
                <td>
                  {i.available <= 0 ? (
                    <span className="status status-critical">
                      <span aria-hidden="true">●</span> Out of stock
                    </span>
                  ) : (
                    <span className="status status-warning">
                      <span aria-hidden="true">▲</span> Low
                    </span>
                  )}
                </td>
                <td className="num">{formatCount(i.available)}</td>
                <td className="num">{formatCount(i.reserved)}</td>
                <td className="num hide-narrow">{formatCount(i.onHand)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
