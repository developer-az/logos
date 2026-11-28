/**
 * Human names and shelf prices for the catalogue the C# services seed. Presentation only: the
 * demo simulator owns its own prices, and a real catalogue service would replace this table.
 */
const NAMES: Record<string, string> = {
  'SKU-0001': 'Aurora 75% Keyboard',
  'SKU-0002': 'Nimbus Wireless Mouse',
  'SKU-0003': 'Vertex 27-inch Monitor',
  'SKU-0004': 'USB-C Dock 8-in-1',
  'SKU-0005': 'Clearline Webcam',
  'SKU-0006': 'Pulse Headset',
  'SKU-0007': 'Lumen Desk Lamp',
  'SKU-0008': 'Orbit Trackpad',
  'SKU-0009': 'Ridge Switch Set',
  'SKU-0010': 'Halo Ring Light',
  'SKU-0011': 'Tempo USB Microphone',
  'SKU-0012': 'Cobalt 65 W Charger',
  'KEYBOARD-01': 'Aurora 75% Keyboard',
  'MOUSE-01': 'Nimbus Wireless Mouse',
  'MONITOR-27': 'Vertex 27-inch Monitor',
  'USB-C-HUB': 'USB-C Dock 8-in-1',
  'WEBCAM-HD': 'Clearline Webcam',
};

/** Shelf prices for the SKUs the services seed, matching the load generator's catalogue. */
const PRICES: Record<string, number> = {
  'KEYBOARD-01': 89,
  'MOUSE-01': 29.5,
  'MONITOR-27': 299,
  'USB-C-HUB': 45,
  'WEBCAM-HD': 59,
};

import type { InventoryView } from '@orderflow/contracts';
import type { CatalogItem } from './commerce';

/** The live storefront: prices from the catalogue service, availability from the read model. */
export function liveCatalogue(
  items: readonly InventoryView[],
  prices: Record<string, number> = {},
): CatalogItem[] {
  return items.flatMap((item) => {
    const price = prices[item.sku] ?? priceForSku(item.sku);
    return price == null ? [] : [{ sku: item.sku, unitPrice: price, available: item.available }];
  });
}

export function productName(sku: string): string {
  return NAMES[sku] ?? sku;
}

/**
 * Presentation grouping for the shelf. The catalogue feed carries no category, so this is
 * derived from the product name; an unknown product falls back to "Other" rather than
 * disappearing from the store.
 */
const CATEGORIES: Array<{ id: string; label: string; pattern: RegExp }> = [
  { id: 'keyboards', label: 'Keyboards', pattern: /keyboard/i },
  { id: 'displays', label: 'Displays', pattern: /monitor|display/i },
  { id: 'input', label: 'Pointing', pattern: /mouse|trackpad|switch/i },
  { id: 'audio', label: 'Audio', pattern: /headset|microphone|\bmic\b/i },
  { id: 'video', label: 'Vision', pattern: /webcam|ring light|camera/i },
  { id: 'power', label: 'Power & docks', pattern: /charger|dock|hub/i },
  { id: 'desk', label: 'Desk', pattern: /lamp|stand|mat/i },
];

export interface Category {
  id: string;
  label: string;
}

export function categoryFor(product: string): Category {
  const match = CATEGORIES.find((c) => c.pattern.test(product));
  return match ? { id: match.id, label: match.label } : { id: 'other', label: 'Other' };
}

/** Shelf price, or null when this page has no price for the SKU (the store then leaves it out). */
export function priceForSku(sku: string): number | null {
  return PRICES[sku] ?? null;
}
