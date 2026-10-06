import type { DashboardSnapshot } from '@orderflow/contracts';
import { formatCount, formatDuration, formatMoney, formatPercent } from '../lib/format';

/** Headline numbers. Plain stat tiles: a single value is read faster than any chart of it. */
export function KpiTiles({ snapshot }: { snapshot: DashboardSnapshot }) {
  const { orders, decisionLatency, throughput } = snapshot;
  // The current minute is still filling up, so rate uses the last complete one.
  const lastFull = throughput[throughput.length - 2];
  const tiles = [
    { label: 'Orders', value: formatCount(orders.total), hint: `${formatCount(orders.byStatus.placed)} awaiting decision` },
    {
      label: 'Acceptance rate',
      value: formatPercent(orders.acceptanceRate),
      hint: `${formatCount(orders.byStatus.rejected)} rejected`,
    },
    { label: 'Revenue', value: formatMoney(orders.revenueCents, snapshot.currency), hint: 'confirmed orders' },
    {
      label: 'Decision time p95',
      value: formatDuration(decisionLatency.p95Ms),
      hint:
        decisionLatency.samples > 0
          ? `p50 ${formatDuration(decisionLatency.p50Ms)} · ${formatCount(decisionLatency.samples)} orders`
          : 'no decisions yet',
    },
    {
      label: 'Events last minute',
      value: lastFull ? formatCount(lastFull.orders + lastFull.inventory) : '—',
      hint: lastFull ? `${formatCount(lastFull.orders)} order · ${formatCount(lastFull.inventory)} inventory` : '',
    },
  ];
  return (
    <section className="kpis" aria-label="Key figures">
      {tiles.map((t) => (
        <div className="tile" key={t.label}>
          <div className="tile-label">{t.label}</div>
          <div className="tile-value">{t.value}</div>
          <div className="tile-hint">{t.hint}</div>
        </div>
      ))}
    </section>
  );
}
