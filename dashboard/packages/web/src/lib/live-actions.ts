import { priceForSku } from './catalogue';
import type { ActionResult, CatalogItem, CatalogProduct, CommerceActions } from './commerce';

const INCIDENTS_DEMO_ONLY = 'The incident lab runs in the demo simulator.';

/** randomUUID needs a secure context; a prefixed counter keeps the key unique either way. */
function randomId(): string {
  return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

/** Pull a human message out of the services' ProblemDetails or a bare `{ error }`. */
function errorFrom(data: unknown, status: number): string {
  if (data && typeof data === 'object') {
    const d = data as Record<string, unknown>;
    if (typeof d.error === 'string') return d.error;
    if (typeof d.detail === 'string') return d.detail;
    if (typeof d.title === 'string') return d.title;
    if (d.errors && typeof d.errors === 'object') {
      const first = Object.values(d.errors as Record<string, unknown>)[0];
      if (Array.isArray(first) && typeof first[0] === 'string') return first[0];
    }
  }
  return `The service refused the request (${status}).`;
}

/**
 * Writes against the live platform. The page calls the dashboard API, which forwards to the
 * service that owns the write; the resulting event comes back through Kafka like everything else.
 */
export function createLiveActions(baseUrl: string): CommerceActions {
  const post = async (path: string, body: unknown, idempotencyKey?: string) => {
    const res = await fetch(`${baseUrl}/api${path}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(idempotencyKey ? { 'idempotency-key': idempotencyKey } : {}),
      },
      body: JSON.stringify(body),
    });
    const data: unknown = await res.json().catch(() => null);
    return { res, data };
  };

  return {
    // In live mode the store prices the read model's SKUs from the table; see liveCatalogue().
    catalog: (): CatalogItem[] => [],
    fetchCatalog: async (): Promise<CatalogProduct[]> => {
      try {
        const res = await fetch(`${baseUrl}/api/catalog`);
        if (!res.ok) return [];
        const data: unknown = await res.json();
        if (!Array.isArray(data)) return [];
        return data.flatMap((entry) => {
          if (!entry || typeof entry !== 'object') return [];
          const { sku, name, priceCents } = entry as Record<string, unknown>;
          return typeof sku === 'string' && typeof name === 'string' && typeof priceCents === 'number'
            ? [{ sku, name, priceCents }]
            : [];
        });
      } catch {
        return [];
      }
    },
    placeOrder: async (lines) => {
      const missing = lines.find((line) => priceForSku(line.sku) == null);
      if (missing) return { ok: false, error: `No shelf price is configured for ${missing.sku}.` };
      try {
        const { res, data } = await post(
          '/orders',
          {
            customerId: `web-${randomId().slice(0, 8)}`,
            lines: lines.map((line) => ({ ...line, unitPrice: priceForSku(line.sku)! })),
          },
          randomId(),
        );
        const order = data as { id?: unknown } | null;
        if (!res.ok) return { ok: false, error: errorFrom(data, res.status) };
        if (typeof order?.id !== 'string') {
          return { ok: false, error: 'The order service returned no order id.' };
        }
        return { ok: true, orderId: order.id };
      } catch {
        return { ok: false, error: 'The order service is unreachable.' };
      }
    },
    placePurchaseOrder: async (sku, supplierId, quantity) => {
      try {
        const { res, data } = await post('/purchase-orders', { sku, supplierId, quantity });
        if (!res.ok) return { ok: false, error: errorFrom(data, res.status) };
        return { ok: true, message: 'Purchase order placed. Goods are on the way.' };
      } catch {
        return { ok: false, error: 'The procurement service is unreachable.' };
      }
    },
    // The lab publishes into the in-browser pipeline, so it only exists in the demo.
    sendDuplicate: (): ActionResult => ({ ok: false, error: INCIDENTS_DEMO_ONLY }),
    sendMalformed: (): ActionResult => ({ ok: false, error: INCIDENTS_DEMO_ONLY }),
    replayDeadLetter: (): ActionResult => ({ ok: false, error: INCIDENTS_DEMO_ONLY }),
  };
}
