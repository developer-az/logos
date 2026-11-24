import { useState } from 'react';
import type { Cart } from '../lib/cart';
import type { CatalogItem, CommerceActions } from '../lib/commerce';
import { formatMoney } from '../lib/format';

export function CartPage({
  cart,
  catalog,
  currency,
  actions,
  onChangeQuantity,
  onOrderPlaced,
}: {
  cart: Cart;
  catalog: CatalogItem[];
  currency: string;
  actions: CommerceActions;
  onChangeQuantity: (sku: string, quantity: number) => void;
  onOrderPlaced: (orderId: string) => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const prices = new Map(catalog.map((item) => [item.sku, item]));
  const lines = Object.entries(cart).map(([sku, quantity]) => ({
    sku,
    quantity,
    item: prices.get(sku),
  }));
  const subtotal = lines.reduce(
    (total, line) => total + (line.item?.unitPrice ?? 0) * 100 * line.quantity,
    0,
  );
  const empty = lines.length === 0;

  const checkout = () => {
    setError(null);
    const result = actions.placeOrder(
      lines.map((line) => ({ sku: line.sku, quantity: line.quantity })),
    );
    if (result.ok) onOrderPlaced(result.orderId);
    else setError(result.error);
  };

  return (
    <>
      <div className="title-row">
        <div>
          <h1>Cart</h1>
          <p className="sub">Checkout places a real order through the simulator's saga.</p>
        </div>
        <a className="quiet-button" href="#/">
          Back to store
        </a>
      </div>

      {actions.unavailableReason && <p className="notice">{actions.unavailableReason}</p>}
      {error && (
        <p className="notice" role="alert">
          {error}
        </p>
      )}

      <section className="card" aria-labelledby="cart-title">
        <h2 id="cart-title">Items</h2>
        {empty ? (
          <p className="empty">Your cart is empty.</p>
        ) : (
          <>
            <table>
              <thead>
                <tr>
                  <th>SKU</th>
                  <th className="num">Unit price</th>
                  <th>Quantity</th>
                  <th className="num">Line total</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {lines.map((line) => (
                  <tr key={line.sku}>
                    <td className="mono">{line.sku}</td>
                    <td className="num">
                      {line.item ? formatMoney(Math.round(line.item.unitPrice * 100), currency) : '—'}
                    </td>
                    <td>
                      <input
                        className="qty-input"
                        type="number"
                        min={1}
                        max={10}
                        value={line.quantity}
                        aria-label={`Quantity for ${line.sku}`}
                        onChange={(e) =>
                          onChangeQuantity(
                            line.sku,
                            Math.min(10, Math.max(1, Number(e.target.value) || 1)),
                          )
                        }
                      />
                    </td>
                    <td className="num">
                      {line.item
                        ? formatMoney(Math.round(line.item.unitPrice * 100) * line.quantity, currency)
                        : '—'}
                    </td>
                    <td className="num">
                      <button
                        type="button"
                        className="quiet-button"
                        onClick={() => onChangeQuantity(line.sku, 0)}
                      >
                        Remove
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="cart-summary">
              <span>Subtotal</span>
              <strong>{formatMoney(subtotal, currency)}</strong>
            </div>
          </>
        )}
        <div className="cart-actions">
          <button
            type="button"
            className="button"
            disabled={empty || !!actions.unavailableReason}
            onClick={checkout}
          >
            Checkout
          </button>
        </div>
      </section>

      <p className="consumer">
        Checkout is a demo write path: the order is validated, published through the same contracts
        and folded by the same read model as every simulated order.
      </p>
    </>
  );
}
