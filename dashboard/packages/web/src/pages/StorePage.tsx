import { useState } from 'react';
import { cartCount, type Cart } from '../lib/cart';
import { productName } from '../lib/catalogue';
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
          <h1>Orderflow</h1>
          <p className="sub">
            Place an order and trace it across Kafka, restock the SKU it could not fill, and
            reconcile the money. Every step is an event.
          </p>
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
                <th>Product</th>
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
                    <td className="stack-sku">
                      <span className="product-name">{productName(item.sku)}</span>
                      <span className="mono product-sku">{item.sku}</span>
                    </td>
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
