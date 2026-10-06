const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
const int = new Intl.NumberFormat('en-US');

export function formatMoney(cents: number | null, currency = 'USD'): string {
  if (cents == null) return '—';
  return currency === 'USD'
    ? usd.format(cents / 100)
    : new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(cents / 100);
}

export function formatCount(n: number): string {
  return int.format(n);
}

export function formatPercent(ratio: number | null): string {
  if (ratio == null) return '—';
  return `${(ratio * 100).toFixed(ratio === 1 || ratio === 0 ? 0 : 1)}%`;
}

/** Milliseconds as "850 ms", "1.2 s", "2.5 min". */
export function formatDuration(ms: number | null): string {
  if (ms == null) return '—';
  if (ms < 1000) return `${Math.round(ms)} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`;
  return `${(ms / 60_000).toFixed(1)} min`;
}

/** "just now", "42 s ago", "5 min ago", "3 h ago" relative to `now`. */
export function formatAgo(iso: string | null, now: Date): string {
  if (!iso) return '—';
  const s = Math.max(0, Math.round((now.getTime() - Date.parse(iso)) / 1000));
  if (s < 5) return 'just now';
  if (s < 60) return `${s} s ago`;
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  return `${Math.floor(s / 3600)} h ago`;
}

export function formatClock(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
}
