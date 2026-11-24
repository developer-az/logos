/**
 * Human names for the simulator's SKUs. Presentation only: the events, prices and stock all come
 * from the simulator and the read model. An unknown SKU falls back to its code.
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
};

export function productName(sku: string): string {
  return NAMES[sku] ?? sku;
}
