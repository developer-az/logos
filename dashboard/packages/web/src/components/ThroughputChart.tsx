import { useId, useState, type KeyboardEvent, type PointerEvent } from 'react';
import type { ThroughputPoint } from '@orderflow/contracts';
import { formatClock, formatCount } from '../lib/format';
import { linearScale, linePath, niceMax } from '../lib/scale';
import { useElementWidth } from '../hooks/useElementWidth';

const H = 220;
const M = { top: 12, right: 84, bottom: 24, left: 36 };
const SERIES = [
  { key: 'orders', label: 'Order events', color: 'var(--series-1)' },
  { key: 'inventory', label: 'Inventory events', color: 'var(--series-2)' },
] as const;

/**
 * Events per minute over the last hour, one line per topic. Single y-axis (both series are
 * counts of the same unit), legend plus direct end labels, crosshair tooltip on hover or
 * arrow keys, and a table view for screen readers and exact values.
 */
export function ThroughputChart({ points }: { points: ThroughputPoint[] }) {
  const [active, setActive] = useState<number | null>(null);
  const titleId = useId();
  const [wrapRef, W] = useElementWidth<HTMLDivElement>(640);
  const n = points.length;
  const yMax = niceMax(Math.max(0, ...points.flatMap((p) => [p.orders, p.inventory])));
  const x = (i: number) => M.left + (n <= 1 ? 0 : (i / (n - 1)) * (W - M.left - M.right));
  const y = linearScale(yMax, H - M.bottom, M.top);
  const ticks = [0, yMax / 2, yMax];
  const xTicks = n > 0 ? [0, Math.floor((n - 1) / 2), n - 1] : [];

  const indexAt = (clientX: number, rect: DOMRect) => {
    const px = ((clientX - rect.left) / rect.width) * W;
    const i = Math.round(((px - M.left) / (W - M.left - M.right)) * (n - 1));
    return Math.min(n - 1, Math.max(0, i));
  };
  const onPointerMove = (e: PointerEvent<SVGRectElement>) =>
    setActive(indexAt(e.clientX, e.currentTarget.ownerSVGElement!.getBoundingClientRect()));
  const onKeyDown = (e: KeyboardEvent<SVGSVGElement>) => {
    if (e.key === 'ArrowLeft') setActive((a) => Math.max(0, (a ?? n) - 1));
    else if (e.key === 'ArrowRight') setActive((a) => Math.min(n - 1, (a ?? -1) + 1));
    else if (e.key === 'Escape') setActive(null);
    else return;
    e.preventDefault();
  };

  const last = points[n - 1];
  const activePoint = active != null ? points[active] : undefined;

  return (
    <section className="card wide" aria-labelledby={titleId}>
      <h2 id={titleId}>Events per minute</h2>
      <ul className="legend">
        {SERIES.map((s) => (
          <li key={s.key}>
            <span className="swatch" style={{ background: s.color }} aria-hidden="true" />
            {s.label}
          </li>
        ))}
      </ul>
      <div className="chart-wrap" ref={wrapRef}>
        <svg
          width={W}
          height={H}
          viewBox={`0 0 ${W} ${H}`}
          role="img"
          aria-label={`Events per minute over the last ${n} minutes. Use arrow keys to inspect.`}
          tabIndex={0}
          onKeyDown={onKeyDown}
          onBlur={() => setActive(null)}
        >
          {ticks.map((t) => (
            <g key={t}>
              <line className="gridline" x1={M.left} x2={W - M.right} y1={y(t)} y2={y(t)} />
              <text className="axis" x={M.left - 6} y={y(t)} textAnchor="end" dominantBaseline="middle">
                {formatCount(t)}
              </text>
            </g>
          ))}
          {xTicks.map((i) => (
            <text key={i} className="axis" x={x(i)} y={H - 6} textAnchor={i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle'}>
              {formatClock(points[i]!.minute)}
            </text>
          ))}
          {SERIES.map((s) => (
            <path
              key={s.key}
              data-testid={`line-${s.key}`}
              d={linePath(points.map((p, i) => [x(i), y(p[s.key])] as const))}
              fill="none"
              stroke={s.color}
              strokeWidth={2}
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          ))}
          {last &&
            SERIES.map((s, k) => (
              <text
                key={s.key}
                className="direct-label"
                x={x(n - 1) + 8}
                // Nudge apart when both lines end at nearly the same height.
                y={y(last[s.key]) + (Math.abs(y(last.orders) - y(last.inventory)) < 14 ? (k === 0 ? -7 : 7) : 0)}
                dominantBaseline="middle"
              >
                {s.key === 'orders' ? 'Orders' : 'Inventory'}
              </text>
            ))}
          {activePoint && (
            <g className="crosshair" pointerEvents="none">
              <line x1={x(active!)} x2={x(active!)} y1={M.top} y2={H - M.bottom} />
              {SERIES.map((s) => (
                <circle key={s.key} cx={x(active!)} cy={y(activePoint[s.key])} r={4} fill={s.color} stroke="var(--surface-1)" strokeWidth={2} />
              ))}
            </g>
          )}
          <rect
            className="hit"
            x={M.left}
            y={M.top}
            width={W - M.left - M.right}
            height={H - M.top - M.bottom}
            fill="transparent"
            onPointerMove={onPointerMove}
            onPointerLeave={() => setActive(null)}
          />
        </svg>
        {activePoint && (
          <div
            className="tooltip"
            role="tooltip"
            style={{ left: `${(x(active!) / W) * 100}%`, transform: active! > n / 2 ? 'translateX(calc(-100% - 12px))' : 'translateX(12px)' }}
          >
            <div className="tooltip-title">{formatClock(activePoint.minute)}</div>
            {SERIES.map((s) => (
              <div key={s.key} className="tooltip-row">
                <span className="swatch" style={{ background: s.color }} aria-hidden="true" />
                <span>{s.label}</span>
                <strong>{formatCount(activePoint[s.key])}</strong>
              </div>
            ))}
          </div>
        )}
      </div>
      <details>
        <summary>Show as table</summary>
        <table>
          <thead>
            <tr>
              <th scope="col">Minute</th>
              <th scope="col" className="num">Order events</th>
              <th scope="col" className="num">Inventory events</th>
            </tr>
          </thead>
          <tbody>
            {points
              .filter((p) => p.orders + p.inventory > 0)
              .map((p) => (
                <tr key={p.minute}>
                  <td>{formatClock(p.minute)}</td>
                  <td className="num">{formatCount(p.orders)}</td>
                  <td className="num">{formatCount(p.inventory)}</td>
                </tr>
              ))}
          </tbody>
        </table>
      </details>
    </section>
  );
}
