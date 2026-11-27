import { liveCatalogue } from '../src/lib/catalogue';
import { createLiveActions } from '../src/lib/live-actions';
import type { InventoryView } from '@orderflow/contracts';

function inventory(sku: string, available: number): InventoryView {
  return { sku, onHand: available, reserved: 0, available, version: 1, updatedAt: '2026-11-26T12:00:00Z', lowStock: false };
}

describe('liveCatalogue', () => {
  it('prices the services’ SKUs and leaves out SKUs this page cannot price', () => {
    const items = [
      inventory('MOUSE-01', 4),
      inventory('MONITOR-27', 0),
      inventory('UNKNOWN-9', 7),
    ];

    expect(liveCatalogue(items)).toEqual([
      { sku: 'MOUSE-01', unitPrice: 29.5, available: 4 },
      { sku: 'MONITOR-27', unitPrice: 299, available: 0 },
    ]);
  });
});

describe('createLiveActions', () => {
  const realFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  const respond = (status: number, body: unknown) =>
    jest.fn().mockResolvedValue({
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
    });

  it('places a priced order and returns its id', async () => {
    const fetchMock = respond(202, { id: 'ORD-1', status: 'placed' });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const result = await createLiveActions('').placeOrder([{ sku: 'MOUSE-01', quantity: 2 }]);

    expect(result).toEqual({ ok: true, orderId: 'ORD-1' });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/orders');
    expect(JSON.parse(String(init.body)).lines).toEqual([
      { sku: 'MOUSE-01', quantity: 2, unitPrice: 29.5 },
    ]);
    expect(init.headers).toMatchObject({ 'idempotency-key': expect.any(String) });
  });

  it('refuses a SKU with no shelf price instead of sending a free line', async () => {
    const fetchMock = respond(202, { id: 'ORD-1' });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const result = await createLiveActions('').placeOrder([{ sku: 'SKU-0001', quantity: 1 }]);

    expect(result).toEqual({ ok: false, error: 'No shelf price is configured for SKU-0001.' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('shows the service’s own message when a write is refused', async () => {
    globalThis.fetch = respond(400, {
      detail: 'Vertex Components has a minimum order of 12.',
    }) as unknown as typeof fetch;

    const result = await createLiveActions('').placePurchaseOrder('MONITOR-27', 'vertex', 2);
    expect(result).toEqual({ ok: false, error: 'Vertex Components has a minimum order of 12.' });
  });

  it('says when the service is unreachable', async () => {
    globalThis.fetch = jest.fn().mockRejectedValue(new Error('offline')) as unknown as typeof fetch;
    const result = await createLiveActions('').placeOrder([{ sku: 'MOUSE-01', quantity: 1 }]);
    expect(result).toEqual({ ok: false, error: 'The order service is unreachable.' });
  });

  it('keeps the incident lab in the demo', () => {
    const actions = createLiveActions('');
    expect(actions.sendDuplicate()).toMatchObject({ ok: false });
    expect(actions.sendMalformed()).toMatchObject({ ok: false });
  });
});

