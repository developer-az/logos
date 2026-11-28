import { type CSSProperties, useEffect, useMemo, useRef, useState } from 'react';
import { ProductGlyph } from '../components/ProductGlyph';
import { cartCount, type Cart } from '../lib/cart';
import { categoryFor, productName } from '../lib/catalogue';
import type { CatalogItem } from '../lib/commerce';
import { formatMoney } from '../lib/format';

/**
 * The storefront. A catalogue is not a table: the shelf is a grid of products you can look at,
 * with the order draft kept beside it so adding something has a visible consequence.
 */
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
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('all');
  const [added, setAdded] = useState<string | null>(null);
  const addedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (addedTimer.current) clearTimeout(addedTimer.current);
    },
    [],
  );

  const categories = useMemo(() => {
    const counts = new Map<string, { label: string; count: number }>();
    for (const item of catalog) {
      const c = categoryFor(productName(item.sku));
      const seen = counts.get(c.id);
      counts.set(c.id, { label: c.label, count: (seen?.count ?? 0) + 1 });
    }
    return [...counts.entries()].map(([id, value]) => ({ id, ...value }));
  }, [catalog]);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return catalog.filter((item) => {
      const name = productName(item.sku);
      if (category !== 'all' && categoryFor(name).id !== category) return false;
      if (!needle) return true;
      return name.toLowerCase().includes(needle) || item.sku.toLowerCase().includes(needle);
    });
  }, [catalog, category, query]);

  const items = cartCount(cart);
  const lines = catalog
    .filter((item) => (cart[item.sku] ?? 0) > 0)
    .map((item) => ({ ...item, quantity: cart[item.sku] ?? 0 }));
  const subtotal = lines.reduce(
    (total, line) => total + Math.round(line.unitPrice * 100) * line.quantity,
    0,
  );
  const units = catalog.reduce((total, item) => total + item.available, 0);

  const add = (sku: string, quantity: number) => {
    onAdd(sku, quantity);
    setAdded(sku);
    if (addedTimer.current) clearTimeout(addedTimer.current);
    addedTimer.current = setTimeout(() => setAdded(null), 1400);
  };

  return (
    <>
      <header className="masthead">
        <div className="masthead-main">
          <p className="eyebrow">
            <span className="eyebrow-index">01</span>
            Storefront
          </p>
          <h1>Buy from the catalogue.</h1>
          <p className="lede">
            {catalog.length} SKUs, priced by the catalogue service and stocked by the inventory
            read model. Check out and follow the order across Kafka, from placed to decided.
          </p>
        </div>
        <dl className="masthead-meta">
          <div>
            <dt>SKUs</dt>
            <dd>{catalog.length}</dd>
          </div>
          <div>
            <dt>On the shelf</dt>
            <dd>{units}</dd>
          </div>
          <div>
            <dt>Draft</dt>
            <dd>{formatMoney(subtotal, currency)}</dd>
          </div>
        </dl>
      </header>

      {unavailableReason && <p className="notice">{unavailableReason}</p>}

      <div className="store-layout">
        <div className="store-main">
          <div className="shelf-bar">
            <p className="shelf-count">
              {query || category !== 'all'
                ? `${visible.length} of ${catalog.length} SKUs`
                : `${catalog.length} SKUs on the shelf`}
            </p>
            <label className="search">
              <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
                <circle cx="7" cy="7" r="4.5" stroke="currentColor" strokeWidth="1.4" />
                <path d="m10.5 10.5 3 3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
              </svg>
              <input
                type="search"
                value={query}
                placeholder="Search name or SKU"
                aria-label="Search the catalogue"
                onChange={(e) => setQuery(e.target.value)}
              />
            </label>
          </div>
          <div className="chips" role="group" aria-label="Filter by category">
            <button
              type="button"
              className="chip-filter"
              aria-pressed={category === 'all'}
              onClick={() => setCategory('all')}
            >
              All<span>{catalog.length}</span>
            </button>
            {categories.map((c) => (
              <button
                key={c.id}
                type="button"
                className="chip-filter"
                aria-pressed={category === c.id}
                onClick={() => setCategory(c.id)}
              >
                {c.label}
                <span>{c.count}</span>
              </button>
            ))}
          </div>

          {catalog.length === 0 ? (
            <p className="empty">No stock is being reported.</p>
          ) : visible.length === 0 ? (
            <div className="shelf-empty">
              <p>No SKU matches {query ? `“${query}”` : 'this filter'}.</p>
              <button
                type="button"
                className="quiet-button"
                onClick={() => {
                  setQuery('');
                  setCategory('all');
                }}
              >
                Clear the filter
              </button>
            </div>
          ) : (
            <ul className="shelf">
              {visible.map((item, index) => {
                const name = productName(item.sku);
                const quantity = quantities[item.sku] ?? 1;
                const soldOut = item.available <= 0;
                const low = !soldOut && item.available <= 5;
                const state = soldOut ? 'out' : low ? 'low' : 'in';
                return (
                  <li
                    key={item.sku}
                    className={`product is-${state}`}
                    style={{ '--i': index } as CSSProperties}
                  >
                    <div className="product-plate">
                      <span className="product-index mono">
                        {String(index + 1).padStart(2, '0')}
                      </span>
                      <ProductGlyph product={name} className="product-glyph" />
                      <span key={item.available} className={`stock-tag stock-${state}`}>
                        {soldOut ? 'Sold out' : low ? `${item.available} left` : `${item.available} in stock`}
                      </span>
                    </div>

                    <div className="product-body">
                      <h3 className="product-title">{name}</h3>
                      <p className="product-meta mono">
                        {item.sku} · {categoryFor(name).label}
                      </p>

                      <div className="product-buy">
                        <span className="product-price">
                          {formatMoney(Math.round(item.unitPrice * 100), currency)}
                        </span>
                        <div className="stepper">
                          <button
                            type="button"
                            aria-label={`Decrease quantity for ${item.sku}`}
                            onClick={() =>
                              setQuantities((q) => ({
                                ...q,
                                [item.sku]: Math.max(1, quantity - 1),
                              }))
                            }
                            disabled={quantity <= 1}
                          >
                            −
                          </button>
                          <input
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
                          <button
                            type="button"
                            aria-label={`Increase quantity for ${item.sku}`}
                            onClick={() =>
                              setQuantities((q) => ({
                                ...q,
                                [item.sku]: Math.min(10, quantity + 1),
                              }))
                            }
                            disabled={quantity >= 10}
                          >
                            +
                          </button>
                        </div>
                      </div>

                      <button
                        type="button"
                        className={`product-add${added === item.sku ? ' is-added' : ''}`}
                        disabled={soldOut || !!unavailableReason}
                        onClick={() => add(item.sku, quantity)}
                      >
                        {added === item.sku ? (
                          <>
                            <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
                              <path
                                d="m3 8.5 3.5 3.5L13 4.5"
                                stroke="currentColor"
                                strokeWidth="1.6"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                              />
                            </svg>
                            Added
                          </>
                        ) : (
                          <>
                            <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
                              <path
                                d="M8 3v10M3 8h10"
                                stroke="currentColor"
                                strokeWidth="1.5"
                                strokeLinecap="round"
                              />
                            </svg>
                            Add to cart
                          </>
                        )}
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <aside className="draft" aria-labelledby="draft-title">
          <div className="draft-head">
            <h2 id="draft-title">Order draft</h2>
            <span className="draft-count">
              {items} {items === 1 ? 'item' : 'items'}
            </span>
          </div>

          {lines.length === 0 ? (
            <p className="draft-empty">Nothing yet. Add a SKU to start an order.</p>
          ) : (
            <ul className="draft-lines">
              {lines.map((line) => (
                <li key={line.sku} className="draft-line">
                  <div className="draft-line-main">
                    <span className="draft-line-name">{productName(line.sku)}</span>
                    <span className="draft-line-meta mono">
                      {line.quantity} × {formatMoney(Math.round(line.unitPrice * 100), currency)}
                    </span>
                  </div>
                  <span className="draft-line-total">
                    {formatMoney(Math.round(line.unitPrice * 100) * line.quantity, currency)}
                  </span>
                </li>
              ))}
            </ul>
          )}

          <div className="draft-total">
            <span>Subtotal</span>
            <strong key={subtotal}>{formatMoney(subtotal, currency)}</strong>
          </div>

          <a
            className="button draft-cta"
            href="#/cart"
            aria-disabled={lines.length === 0 || undefined}
            onClick={(e) => {
              if (lines.length === 0) e.preventDefault();
            }}
          >
            Review order
          </a>

          <p className="draft-note">
            The order service prices every line from the catalogue; this subtotal is the shelf
            price, not a quote.
          </p>
        </aside>
      </div>

      {lines.length > 0 && (
        <div className="draft-bar">
          <div className="draft-bar-total">
            <span>
              {items} {items === 1 ? 'item' : 'items'}
            </span>
            <strong>{formatMoney(subtotal, currency)}</strong>
          </div>
          <a className="button" href="#/cart">
            Review order
          </a>
        </div>
      )}
    </>
  );
}
