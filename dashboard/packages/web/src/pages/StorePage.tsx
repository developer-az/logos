import { useState } from 'react';
import { cartCount, type Cart } from '../lib/cart';
import type { CatalogItem } from '../lib/commerce';
import { formatMoney } from '../lib/format';

export function StorePage({
  catalog,
  currency,
  cart,
  unavailableReason,
  onAdd,
}: {
  catalog: CatalogItem[];
  currency: string;
  cart: Cart;
  unavailableReason?: string;
  onAdd: (sku: string, quantity: number) => void;
}) {
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const items = cartCount(cart);

  return (
    <>
      <div className="title-row">
        <div>
          <h1>Store</h1>
          <p className="sub">Order from the same catalogue the control tower watches.</p>
        </div>
        <a className="quiet-button cart-link" href="#/cart">
          Cart · {items} {items === 1 ? 'item' : 'items'}
        </a>
      </div>

      {unavailableReason && <p className="notice">{unavailableReason}</p>}

      <section className="card" aria-labelledby="catalogue-title">
        <h2 id="catalogue-title">Catalogue</h2>
        <p className="card-hint">
          {catalog.length} SKUs, prices from the order simulator and stock from the read model.
        </p>
        {catalog.length === 0 ? (
          <p className="empty">No stock is being reported.</p>
        ) : (
          <table className="stack-table">
            <thead>
              <tr>
                <th>SKU</th>
                <th className="num">Unit price</th>
                <th className="num">Available</th>
                <th>Quantity</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {catalog.map((item) => {
                const quantity = quantities[item.sku] ?? 1;
                return (
                  <tr key={item.sku}>
                    <td className="mono stack-sku">{item.sku}</td>
                    <td className="num" data-label="Unit price">
                      {formatMoney(Math.round(item.unitPrice * 100), currency)}
                    </td>
                    <td className="num" data-label="Available">
                      {item.available}
                    </td>
                    <td data-label="Quantity">
                      <input
                        className="qty-input"
                        type="number"
                        min={1}
                        max={10}
                        value={quantity}
                        aria-label={`Quantity for ${item.sku}`}
                        onChange={(e) =>
                          setQuantities((q) => ({
                            ...q,
                            [item.sku]: Math.min(10, Math.max(1, Number(e.target.value) || 1)),
                          }))
                        }
                      />
                    </td>
                    <td className="stack-action">
                      <button
                        type="button"
                        className="quiet-button"
                        disabled={item.available <= 0 || !!unavailableReason}
                        onClick={() => onAdd(item.sku, quantity)}
                      >
                        Add to cart
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>
    </>
  );
}
