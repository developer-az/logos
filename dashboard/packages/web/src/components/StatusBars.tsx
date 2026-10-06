import type { OrderStatus } from '@orderflow/contracts';
import { formatCount } from '../lib/format';

const LABELS: Record<OrderStatus, string> = {
  placed: 'Awaiting decision',
  confirmed: 'Confirmed',
  rejected: 'Rejected',
  cancelled: 'Cancelled',
};
const ORDER: OrderStatus[] = ['placed', 'confirmed', 'rejected', 'cancelled'];

/**
 * Orders by status as horizontal bars: one measure (count) across categories, so one hue.
 * Status names are the labels; color would add nothing but a legend to decode.
 */
export function StatusBars({ byStatus }: { byStatus: Record<OrderStatus, number> }) {
  const max = Math.max(1, ...ORDER.map((s) => byStatus[s]));
  return (
    <section className="card" aria-labelledby="status-title">
      <h2 id="status-title">Orders by status</h2>
      <ul className="bars">
        {ORDER.map((s) => (
          <li key={s} className="bar-row" title={`${LABELS[s]}: ${formatCount(byStatus[s])}`}>
            <span className="bar-label">{LABELS[s]}</span>
            <span className="bar-track">
              <span
                className="bar-fill"
                data-testid={`bar-${s}`}
                style={{ width: `${(byStatus[s] / max) * 100}%` }}
              />
            </span>
            <span className="bar-value">{formatCount(byStatus[s])}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
