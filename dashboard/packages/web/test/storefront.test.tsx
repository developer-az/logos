import { act, fireEvent, render, screen } from '@testing-library/react';
import { DemoPipeline, createDemoRuntime } from '../src/demo/demo-stream';
import { parseHash } from '../src/hooks/useHashRoute';
import { App } from '../src/App';
import { OrderPage } from '../src/pages/OrderPage';
import { FakeEventSource, snapshot } from './fixtures';

const T0 = Date.parse('2026-10-07T12:00:00Z');

describe('DemoPipeline.placeOrder', () => {
  const pipeline = () =>
    new DemoPipeline({ seed: 7, now: () => T0, backfillMinutes: 0, rate: 0 });

  it('places an order through the projection and settles through the saga', () => {
    const p = pipeline();
    const [item] = p.catalog();
    const orderId = p.placeOrder([{ sku: item!.sku, quantity: 2 }], T0);

    const placed = p.snapshot().orders.recent.find((o) => o.orderId === orderId);
    expect(placed).toBeDefined();
    expect(placed!.status).toBe('placed');
    expect(placed!.timeline?.map((s) => s.eventType)).toContain('order.placed');

    p.advanceTo(T0 + 500);
    const decided = p.snapshot().orders.recent.find((o) => o.orderId === orderId);
    expect(decided).toBeDefined();
    expect(['confirmed', 'rejected']).toContain(decided!.status);
    expect(decided!.timeline?.map((s) => s.eventType)).toEqual(
      expect.arrayContaining(['order.placed', 'inventory.stock-reserved', 'order.confirmed']),
    );
  });

  it('rejects unknown SKUs and non-positive quantities', () => {
    const p = pipeline();
    const sku = p.catalog()[0]!.sku;

    expect(() => p.placeOrder([{ sku: 'SKU-9999', quantity: 1 }], T0)).toThrow(/Unknown SKU/);
    expect(() => p.placeOrder([{ sku, quantity: 0 }], T0)).toThrow(/positive integer/);
    expect(() => p.placeOrder([{ sku, quantity: 1.5 }], T0)).toThrow(/positive integer/);
  });
});

describe('hash router', () => {
  it('parses the storefront routes', () => {
    expect(parseHash('#/')).toEqual({ name: 'store' });
    expect(parseHash('#/cart')).toEqual({ name: 'cart' });
    expect(parseHash('#/ops')).toEqual({ name: 'ops' });
    expect(parseHash('#/orders/abc')).toEqual({ name: 'order', orderId: 'abc' });
    expect(parseHash('#/orders/0b5a3c1e-7f00-4d1a-9a55-2a7bdf1f0c11')).toEqual({
      name: 'order',
      orderId: '0b5a3c1e-7f00-4d1a-9a55-2a7bdf1f0c11',
    });
    expect(parseHash('#/unknown')).toEqual({ name: 'store' });
  });
});

describe('storefront', () => {
  beforeEach(() => {
    jest.useFakeTimers({ now: T0 });
    window.location.hash = '#/';
    sessionStorage.clear();
  });

  afterEach(() => {
    jest.useRealTimers();
    window.location.hash = '';
    sessionStorage.clear();
  });

  it('adds an item to the cart and checks out to the order route', async () => {
    const runtime = createDemoRuntime({ seed: 5, backfillMinutes: 0, rate: 0, now: () => T0 });
    render(<App demo createEventSource={runtime.factory} actions={runtime.actions} />);

    fireEvent.click(screen.getAllByRole('button', { name: 'Add to cart' })[0]!);
    expect(screen.getByRole('link', { name: /Cart \(1\)/ })).toBeInTheDocument();

    act(() => {
      window.location.hash = '#/cart';
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Checkout' }));
    });

    expect(window.location.hash).toMatch(/^#\/orders\/[0-9a-f-]+$/i);

    act(() => window.dispatchEvent(new HashChangeEvent('hashchange')));
    expect(screen.getByRole('heading', { name: 'Order' })).toBeInTheDocument();
  });

  it('keeps a traced order after it leaves the live window', () => {
    const base = snapshot();
    const order = {
      ...base.orders.recent[0]!,
      timeline: [
        { eventType: 'order.placed', occurredAt: '2026-10-06T10:04:58.000Z' },
        { eventType: 'order.confirmed', occurredAt: '2026-10-06T10:04:58.090Z' },
      ],
    };
    const withOrder = { ...base, orders: { ...base.orders, recent: [order] } };
    const withoutOrder = { ...base, orders: { ...base.orders, recent: [] } };

    const { rerender } = render(
      <OrderPage orderId={order.orderId} snapshot={withOrder} now={new Date()} currency="USD" />,
    );
    rerender(
      <OrderPage orderId={order.orderId} snapshot={withoutOrder} now={new Date()} currency="USD" />,
    );

    expect(screen.getByLabelText('Saga trace')).toBeInTheDocument();
    expect(screen.getByText(/left the live window/i)).toBeInTheDocument();
  });

  it('says checkout is not available when there is no action backend', () => {
    render(<App createEventSource={FakeEventSource.factory} />);
    act(() => {
      FakeEventSource.latest().open();
      FakeEventSource.latest().emit('snapshot', snapshot());
    });

    expect(screen.getByText(/no write path configured/i)).toBeInTheDocument();
  });
});
