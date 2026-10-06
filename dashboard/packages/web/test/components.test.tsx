import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ConnectionBadge } from '../src/components/ConnectionBadge';
import { KpiTiles } from '../src/components/KpiTiles';
import { LowStockTable } from '../src/components/LowStockTable';
import { RecentOrders } from '../src/components/RecentOrders';
import { StatusBars } from '../src/components/StatusBars';
import { ThroughputChart } from '../src/components/ThroughputChart';
import { snapshot, throughput } from './fixtures';

describe('KpiTiles', () => {
  it('shows headline numbers', () => {
    render(<KpiTiles snapshot={snapshot()} />);
    const tile = (label: string) => screen.getByText(label).parentElement!;
    expect(tile('Orders')).toHaveTextContent('120');
    expect(tile('Orders')).toHaveTextContent('4 awaiting decision');
    expect(tile('Acceptance rate')).toHaveTextContent('90.9%');
    expect(tile('Revenue')).toHaveTextContent('$12,345.67');
    expect(tile('Decision time p95')).toHaveTextContent('1.3 s');
    expect(tile('Decision time p95')).toHaveTextContent('p50 140 ms · 110 orders');
  });

  it('uses the last complete minute for the event rate', () => {
    render(<KpiTiles snapshot={snapshot()} />);
    // Buckets are [.., [30, 41], [5, 6]]; the last one is still filling.
    expect(screen.getByText('Events last minute').parentElement).toHaveTextContent('71');
  });

  it('shows dashes before there is data', () => {
    const empty = snapshot({
      orders: { total: 0, byStatus: { placed: 0, confirmed: 0, rejected: 0, cancelled: 0 }, acceptanceRate: null, revenueCents: 0, recent: [] },
      decisionLatency: { samples: 0, p50Ms: null, p95Ms: null, maxMs: null },
      throughput: [],
    });
    render(<KpiTiles snapshot={empty} />);
    expect(screen.getByText('Acceptance rate').parentElement).toHaveTextContent('—');
    expect(screen.getByText('no decisions yet')).toBeInTheDocument();
  });
});

describe('StatusBars', () => {
  it('scales bars to the largest status and labels every value', () => {
    render(<StatusBars byStatus={snapshot().orders.byStatus} />);
    expect(screen.getByTestId('bar-confirmed')).toHaveStyle({ width: '100%' });
    expect(screen.getByTestId('bar-rejected').style.width).toBe('10%');
    expect(screen.getByText('Rejected').parentElement).toHaveTextContent('10');
  });

  it('renders all-zero counts without dividing by zero', () => {
    render(<StatusBars byStatus={{ placed: 0, confirmed: 0, rejected: 0, cancelled: 0 }} />);
    expect(screen.getByTestId('bar-placed')).toHaveStyle({ width: '0%' });
  });
});

describe('LowStockTable', () => {
  it('labels state with text, not just color', () => {
    const s = snapshot();
    render(<LowStockTable items={s.inventory.lowStock} threshold={5} skus={12} />);
    const rows = screen.getAllByRole('row').slice(1);
    expect(within(rows[0]!).getByText('Out of stock')).toBeInTheDocument();
    expect(within(rows[1]!).getByText('Low')).toBeInTheDocument();
    expect(screen.getByText('2 of 12 SKUs at or below 5 available')).toBeInTheDocument();
  });

  it('says so when nothing is low', () => {
    render(<LowStockTable items={[]} threshold={5} skus={12} />);
    expect(screen.getByText('Every SKU is above the threshold.')).toBeInTheDocument();
    expect(screen.queryByRole('table')).toBeNull();
  });
});

describe('RecentOrders', () => {
  it('shows status, reason, total and age', () => {
    render(<RecentOrders orders={snapshot().orders.recent} now={new Date('2026-10-06T10:05:41Z')} currency="USD" />);
    const row = screen.getAllByRole('row')[1]!;
    expect(within(row).getByTitle('0b5a3c1e-7f00-4d1a-9a55-2a7bdf1f0c11')).toHaveTextContent(/^0b5a3c1e$/);
    expect(row).toHaveTextContent('Rejected');
    expect(row).toHaveTextContent('Insufficient stock');
    expect(row).toHaveTextContent('$45.99');
    expect(row).toHaveTextContent('42 s ago');
  });

  it('handles orders seen before their order.placed event', () => {
    const partial = { ...snapshot().orders.recent[0]!, orderId: 'legacy-7', totalCents: null, itemCount: null, reason: null };
    render(<RecentOrders orders={[partial]} now={new Date()} currency="EUR" />);
    expect(screen.getByText('legacy-7')).toBeInTheDocument();
    expect(screen.getAllByRole('row')[1]).toHaveTextContent('—');
  });
});

describe('ConnectionBadge', () => {
  it.each([
    ['connecting', true, 'Connecting'],
    ['live', true, 'Live'],
    ['live', false, 'Catching up'],
    ['reconnecting', true, 'Reconnecting'],
  ] as const)('%s / caughtUp=%p reads "%s"', (connection, caughtUp, text) => {
    render(<ConnectionBadge connection={connection} caughtUp={caughtUp} />);
    expect(screen.getByRole('status')).toHaveTextContent(text);
  });
});

describe('ThroughputChart', () => {
  it('draws one line per series with a legend and direct labels', () => {
    render(<ThroughputChart points={throughput([[1, 2], [3, 4], [5, 6]])} />);
    expect(screen.getByTestId('line-orders').getAttribute('d')).toMatch(/^M[\d.]+,[\d.]+(L[\d.]+,[\d.]+){2}$/);
    expect(screen.getByTestId('line-inventory')).toBeInTheDocument();
    const legend = screen.getAllByRole('list')[0]!;
    expect(legend).toHaveTextContent('Order events');
    expect(legend).toHaveTextContent('Inventory events');
    expect(screen.getByText('Orders', { selector: 'text' })).toBeInTheDocument();
    expect(screen.getByText('Inventory', { selector: 'text' })).toBeInTheDocument();
  });

  it('shows a tooltip for the point under keyboard focus', async () => {
    const user = userEvent.setup();
    render(<ThroughputChart points={throughput([[1, 2], [3, 4], [5, 6]])} />);
    expect(screen.queryByRole('tooltip')).toBeNull();
    await user.tab();
    await user.keyboard('{ArrowRight}{ArrowRight}');
    const tip = screen.getByRole('tooltip');
    expect(tip).toHaveTextContent('Order events3');
    expect(tip).toHaveTextContent('Inventory events4');
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  it('shows a tooltip on pointer hover', () => {
    const { container } = render(<ThroughputChart points={throughput([[1, 2], [3, 4], [5, 6]])} />);
    const svg = container.querySelector('svg')!;
    svg.getBoundingClientRect = () => ({ left: 0, width: 640, top: 0, height: 220, right: 640, bottom: 220, x: 0, y: 0, toJSON: () => ({}) });
    // x = 556 is the right edge of the plot area, i.e. the last point.
    fireEvent.pointerMove(container.querySelector('rect.hit')!, { clientX: 556 });
    expect(screen.getByRole('tooltip')).toHaveTextContent('Order events5');
    fireEvent.pointerLeave(container.querySelector('rect.hit')!);
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  it('offers a table of the non-empty minutes', () => {
    render(<ThroughputChart points={throughput([[0, 0], [3, 4]])} />);
    const table = screen.getByRole('table', { hidden: true });
    expect(within(table).getAllByRole('row', { hidden: true })).toHaveLength(2);
  });
});
