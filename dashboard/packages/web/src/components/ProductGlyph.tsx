/**
 * Product line drawings for the storefront. The catalogue feed has no imagery, so each SKU gets
 * a geometric technical drawing instead of a stock photo: one stroke weight, no fills, drawn on
 * the same 48-unit grid. An unknown product falls back to a crate, never to a broken image.
 */

const GLYPHS = {
  keyboard: (
    <>
      <rect x="4.5" y="15.5" width="39" height="19" rx="3.5" />
      <path d="M9 21h3M14 21h3M19 21h3M24 21h3M29 21h3M34 21h5M9 26h7M18 26h6M26 26h13M13 31h22" />
    </>
  ),
  mouse: (
    <>
      <path d="M24 7.5c-6 0-9.5 5-9.5 12.5v8c0 7 3.5 12.5 9.5 12.5s9.5-5.5 9.5-12.5v-8C33.5 12.5 30 7.5 24 7.5Z" />
      <path d="M24 7.5v13" />
      <path d="M24 15.5v5" />
    </>
  ),
  monitor: (
    <>
      <rect x="4.5" y="9.5" width="39" height="23" rx="2.5" />
      <path d="M20 32.5v6M28 32.5v6M15 38.5h18" />
      <path d="M10 16h11" />
    </>
  ),
  dock: (
    <>
      <rect x="5.5" y="20.5" width="37" height="9" rx="3" />
      <path d="M11 25h4M18 25h2M23 25h2M28 25h4" />
      <path d="M24 29.5v6c0 2 1 3 3 3h7" />
    </>
  ),
  webcam: (
    <>
      <rect x="10.5" y="13.5" width="27" height="18" rx="9" />
      <circle cx="24" cy="22.5" r="5" />
      <circle cx="24" cy="22.5" r="1.6" />
      <path d="M18 31.5l-2 6h16l-2-6" />
    </>
  ),
  headset: (
    <>
      <path d="M10 28v-4a14 14 0 0 1 28 0v4" />
      <rect x="6.5" y="27.5" width="7" height="12" rx="3.5" />
      <rect x="34.5" y="27.5" width="7" height="12" rx="3.5" />
      <path d="M38 34c0 5-3.5 8-8 8h-3" />
    </>
  ),
  lamp: (
    <>
      <path d="M24 6v8" />
      <path d="M14 27l4-13h12l4 13z" />
      <path d="M11 27h26" />
      <path d="M19 31h10" />
    </>
  ),
  trackpad: (
    <>
      <rect x="8.5" y="12.5" width="31" height="23" rx="4" />
      <path d="M8.5 27.5h31" />
      <circle cx="24" cy="20" r="3.5" />
    </>
  ),
  switches: (
    <>
      <rect x="6.5" y="17.5" width="9" height="9" rx="1.5" />
      <rect x="19.5" y="17.5" width="9" height="9" rx="1.5" />
      <rect x="32.5" y="17.5" width="9" height="9" rx="1.5" />
      <path d="M11 26.5v6M24 26.5v6M37 26.5v6M9 35h4M22 35h4M35 35h4" />
    </>
  ),
  ringlight: (
    <>
      <circle cx="24" cy="20" r="12" />
      <circle cx="24" cy="20" r="7.5" strokeDasharray="2 3.5" />
      <path d="M24 32v8M17 40h14" />
    </>
  ),
  microphone: (
    <>
      <rect x="18.5" y="6.5" width="11" height="20" rx="5.5" />
      <path d="M13 23.5a11 11 0 0 0 22 0" />
      <path d="M24 34.5v7M18 41.5h12" />
      <path d="M21 12h6M21 16h6" />
    </>
  ),
  charger: (
    <>
      <rect x="11.5" y="12.5" width="25" height="25" rx="5" />
      <path d="M19 12.5V7M29 12.5V7" />
      <path d="M18.5 27h11" />
      <path d="M21.5 23.5h5" />
    </>
  ),
  crate: (
    <>
      <path d="M24 6.5 39 15v18l-15 9-15-9V15z" />
      <path d="M9 15l15 9 15-9M24 24v18" />
    </>
  ),
} as const;

export type GlyphName = keyof typeof GLYPHS;

export function glyphFor(product: string): GlyphName {
  const name = product.toLowerCase();
  if (/keyboard/.test(name)) return 'keyboard';
  if (/mouse/.test(name)) return 'mouse';
  if (/monitor|display/.test(name)) return 'monitor';
  if (/dock|hub/.test(name)) return 'dock';
  if (/webcam|camera/.test(name)) return 'webcam';
  if (/headset/.test(name)) return 'headset';
  if (/lamp|light/.test(name)) return /ring/.test(name) ? 'ringlight' : 'lamp';
  if (/trackpad/.test(name)) return 'trackpad';
  if (/switch/.test(name)) return 'switches';
  if (/microphone|\bmic\b/.test(name)) return 'microphone';
  if (/charger|adapter/.test(name)) return 'charger';
  return 'crate';
}

export function ProductGlyph({ product, className }: { product: string; className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 48 48"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.35"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {GLYPHS[glyphFor(product)]}
    </svg>
  );
}
