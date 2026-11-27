import { useState } from 'react';
import type { Cart } from '../lib/cart';
import { productName } from '../lib/catalogue';
import type { CatalogItem, CommerceActions } from '../lib/commerce';
import { formatMoney } from '../lib/format';

export function CartPage({
  cart,
  catalog,
  currency,
  actions,
  onChangeQuantity,
  onOrderPlaced,
  onAdd,
}: {
  cart: Cart;
  catalog: CatalogItem[];
  currency: string;
  actions: CommerceActions;
  onChangeQuantity: (sku: string, quantity: number) => void;
  onOrderPlaced: (orderId: string) => void;
  onAdd: (sku: string, quantity: number) => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [placing, setPlacing] = useState(false);
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

  const checkout = async () => {
    setError(null);
    setPlacing(true);
    try {
      const result = await actions.placeOrder(
        lines.map((line) => ({ sku: line.sku, quantity: line.quantity })),
      );
      if (result.ok) onOrderPlaced(result.orderId);
      else setError(result.error);
    } finally {
      setPlacing(false);
    }
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
          <div className="empty-cart">
            <p className="empty">Your cart is empty.</p>
            {catalog.some((item) => item.available > 0) && (
              <p className="card-hint">Start with something in stock:</p>
            )}
            <ul className="quick-add">
              {catalog
                .filter((item) => item.available > 0)
                .slice(0, 3)
                .map((item) => (
                  <li key={item.sku}>
                    <span>
                      <span className="product-name">{productName(item.sku)}</span>
                      <span className="mono product-sku">{item.sku}</span>
                    </span>
                    <span className="quiet-price">
                      {formatMoney(Math.round(item.unitPrice * 100), currency)}
                    </span>
                    <button type="button" className="quiet-button" onClick={() => onAdd(item.sku, 1)}>
                      Add
                    </button>
                  </li>
                ))}
            </ul>
            <a className="button" href="#/">
              Browse the store
            </a>
          </div>
        ) : (
          <>
            <table className="stack-table">
              <thead>
                <tr>
                  <th>Product</th>
                  <th className="num">Unit price</th>
                  <th>Quantity</th>
                  <th className="num">Line total</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {lines.map((line) => (
                  <tr key={line.sku}>
                    <td className="stack-sku">
                      <span className="product-name">{productName(line.sku)}</span>
                      <span className="mono product-sku">{line.sku}</span>
                    </td>
                    <td className="num" data-label="Unit price">
                      {line.item ? formatMoney(Math.round(line.item.unitPrice * 100), currency) : '—'}
                    </td>
                    <td data-label="Quantity">
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
                    <td className="num" data-label="Line total">
                      {line.item
                        ? formatMoney(Math.round(line.item.unitPrice * 100) * line.quantity, currency)
                        : '—'}
                    </td>
                    <td className="stack-action">
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
        {!empty && (
          <div className="cart-actions">
            <button
              type="button"
              className="button"
              disabled={placing || !!actions.unavailableReason}
              onClick={() => void checkout()}
            >
              {placing ? 'Placing…' : 'Checkout'}
            </button>
          </div>
        )}
      </section>

      <p className="consumer">
        Checkout is a demo write path: the order is validated, published through the same contracts
        and folded by the same read model as every simulated order.
      </p>
    </>
  );
}
