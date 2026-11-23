import { useEffect, useRef, useState } from 'react';
import type { DashboardSnapshot } from '@orderflow/contracts';
import { formatCount, formatDuration, formatPercent } from '../lib/format';

/** The three figures that say whether orders are being processed correctly. One is the lead. */
export function KpiTiles({ snapshot }: { snapshot: DashboardSnapshot }) {
  const { orders, decisionLatency } = snapshot;
  const tiles = [
    {
      label: 'Orders',
      value: formatCount(orders.total),
      hint: `${formatCount(orders.byStatus.placed)} awaiting decision`,
      lead: true,
    },
    {
      label: 'Acceptance rate',
      value: formatPercent(orders.acceptanceRate),
      hint: `${formatCount(orders.byStatus.rejected)} rejected`,
    },
    {
      label: 'Decision time p95',
      value: formatDuration(decisionLatency.p95Ms),
      hint:
        decisionLatency.samples > 0
          ? `p50 ${formatDuration(decisionLatency.p50Ms)} · ${formatCount(decisionLatency.samples)} orders`
          : 'no decisions yet',
    },
  ];
  return (
    <section className="kpis" aria-label="Key figures">
      {tiles.map((t) => (
        <KpiCell key={t.label} {...t} />
      ))}
    </section>
  );
}

function KpiCell({ label, value, hint, lead = false }: { label: string; value: string; hint: string; lead?: boolean }) {
  const changing = useSettle(value);
  return (
    <div className={`tile${lead ? ' tile-lead' : ''}`}>
      <div className="tile-label">{label}</div>
      <div className={`tile-value${changing ? ' is-changing' : ''}`}>{value}</div>
      <div className="tile-hint">{hint}</div>
    </div>
  );
}

/** A figure settles when a new snapshot changes it; the number itself is never held back. */
function useSettle(value: string): boolean {
  const previous = useRef(value);
  const [changing, setChanging] = useState(false);

  useEffect(() => {
    if (previous.current === value) return;
    previous.current = value;
    setChanging(true);
    const timer = setTimeout(() => setChanging(false), 440);
    return () => clearTimeout(timer);
  }, [value]);

  return changing;
}
