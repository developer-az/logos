import { act, fireEvent, render, screen } from '@testing-library/react';
import { DemoPipeline } from '../src/demo/demo-stream';
import { parseHash } from '../src/hooks/useHashRoute';
import { FinancePage } from '../src/pages/FinancePage';
import { IncidentsPage } from '../src/pages/IncidentsPage';
import { SourcingPage } from '../src/pages/SourcingPage';
import { unavailableActions, type CommerceActions } from '../src/lib/commerce';
import { snapshot } from './fixtures';

const T0 = Date.parse('2026-10-08T12:00:00Z');
const options = {
  seed: 9,
  now: () => T0,
  backfillMinutes: 0,
  rate: 0,
  duplicateRate: 0,
  invalidRate: 0,
};
const orderById = (p: DemoPipeline, id: string) =>
  p.snapshot().orders.recent.find((o) => o.orderId === id);

describe('the procurement saga', () => {
  it('restocks through a purchase order, then confirms the order it could not fill', () => {
    const p = new DemoPipeline({ ...options, initialStock: 0 });
    const sku = p.catalog()[0]!.sku;

    const rejectedId = p.placeOrder([{ sku, quantity: 5 }], T0);
    p.advanceTo(T0 + 1_000);
    expect(orderById(p, rejectedId)).toMatchObject({ status: 'rejected' });

    // Kilo Parts: one supplier day of lead time, MOQ 3.
    p.placePurchaseOrder(sku, 'kiloparts', 50, T0 + 2_000);
    expect(p.snapshot().procurement.purchaseOrders[0]).toMatchObject({
      sku,
      status: 'in-transit',
      quantity: 50,
    });

    p.advanceTo(T0 + 2_000 + 4_000 + 100);
    expect(p.snapshot().procurement.purchaseOrders[0]).toMatchObject({ status: 'received' });
    expect(p.catalog().find((c) => c.sku === sku)!.available).toBeGreaterThanOrEqual(50);

    const confirmedId = p.placeOrder([{ sku, quantity: 5 }], T0 + 7_000);
    p.advanceTo(T0 + 8_000);
    expect(orderById(p, confirmedId)).toMatchObject({ status: 'confirmed' });
  });

  it('refuses an order below the supplier minimum', () => {
    const p = new DemoPipeline(options);
    const sku = p.catalog()[0]!.sku;
    expect(() => p.placePurchaseOrder(sku, 'vertex', 2, T0)).toThrow(/minimum order of 12/);
  });
});

describe('the incidents lab', () => {
  it('swallows a duplicate, dead-letters a malformed body, and keeps the replay poison', () => {
    const p = new DemoPipeline(options);
    p.advanceTo(T0 + 1);

    const before = p.snapshot().consumer;
    expect(p.sendDuplicate()).toMatchObject({ ok: true });
    expect(p.snapshot().consumer.duplicates).toBe(before.duplicates + 1);

    expect(p.sendMalformed()).toMatchObject({ ok: true });
    const afterMalformed = p.snapshot();
    expect(afterMalformed.consumer.invalid).toBe(before.invalid + 1);
    expect(afterMalformed.deadLetters).toHaveLength(1);
    expect(afterMalformed.deadLetters[0]!.eventType).toBe('order.placed');

    p.replayDeadLetter();
    expect(p.snapshot().consumer.invalid).toBe(before.invalid + 2);
    expect(p.snapshot().deadLetters).toHaveLength(2);
  });
});

describe('new routes', () => {
  it('parses sourcing, finance, incidents and about', () => {
    expect(parseHash('#/sourcing')).toEqual({ name: 'sourcing' });
    expect(parseHash('#/finance')).toEqual({ name: 'finance' });
    expect(parseHash('#/incidents')).toEqual({ name: 'incidents' });
    expect(parseHash('#/about')).toEqual({ name: 'about' });
  });
});

describe('SourcingPage', () => {
  const actions: CommerceActions = {
    ...unavailableActions,
    unavailableReason: undefined,
    catalog: () => [],
    placePurchaseOrder: jest.fn(() => ({ ok: true, message: 'Purchase order placed.' })),
  };

  it('compares suppliers and shows the trade-off tags', () => {
    render(
      <SourcingPage
        snapshot={snapshot()}
        catalog={[{ sku: 'SKU-0003', unitPrice: 12, available: 0 }]}
        now={new Date('2026-10-06T10:05:00Z')}
        currency="USD"
        actions={actions}
      />,
    );

    expect(screen.getByText('Vertex Components')).toBeInTheDocument();
    expect(screen.getByText('Northwind Supply')).toBeInTheDocument();
    expect(screen.getByText('Kilo Parts')).toBeInTheDocument();
    expect(screen.getByText('Cheapest')).toBeInTheDocument();
    expect(screen.getByText('Fastest')).toBeInTheDocument();
  });

  it('raises the purchase order with the chosen supplier and quantity', () => {
    render(
      <SourcingPage
        snapshot={snapshot()}
        catalog={[{ sku: 'SKU-0003', unitPrice: 12, available: 0 }]}
        now={new Date('2026-10-06T10:05:00Z')}
        currency="USD"
        actions={actions}
      />,
    );

    fireEvent.click(screen.getAllByRole('button', { name: 'Order' })[0]!);
    // Cheapest first: Vertex, whose minimum is 12.
    expect(actions.placePurchaseOrder).toHaveBeenCalledWith('SKU-0003', 'vertex', 12);
  });
});

describe('FinancePage', () => {
  it('shows net revenue, margin and the reconciliation verdict', () => {
    render(<FinancePage snapshot={snapshot()} now={new Date()} currency="USD" />);
    expect(screen.getAllByText('$12,345.67').length).toBeGreaterThan(0);
    expect(screen.getByText('$4,345.67')).toBeInTheDocument();
    expect(screen.getByText(/ledger and the order totals agree/i)).toBeInTheDocument();
  });
});

describe('IncidentsPage', () => {
  it('shows the consumer counters and runs an action', async () => {
    const sendMalformed = jest.fn(() => ({
      ok: true as const,
      message: 'Published a truncated message.',
    }));
    render(
      <IncidentsPage
        snapshot={snapshot()}
        actions={{ ...unavailableActions, unavailableReason: undefined, sendMalformed }}
        now={new Date()}
      />,
    );

    expect(screen.getByText('Duplicates ignored')).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Send a malformed event' }));
    });
    expect(sendMalformed).toHaveBeenCalled();
    expect(screen.getByLabelText('Lab results')).toHaveTextContent(/truncated message/i);
  });
});
