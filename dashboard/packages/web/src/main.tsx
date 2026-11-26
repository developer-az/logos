import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource/manrope/latin-400.css';
import '@fontsource/manrope/latin-500.css';
import '@fontsource/manrope/latin-600.css';
import '@fontsource/manrope/latin-700.css';
import '@fontsource/ibm-plex-mono/latin-400.css';
import '@fontsource/ibm-plex-mono/latin-500.css';
import { App } from './App';
import { createDemoRuntime } from './demo/demo-stream';
import { createFallbackEventSourceFactory } from './hooks/fallback-source';
import type { EventSourceFactory, EventSourceLike } from './hooks/useLiveSnapshot';
import { LIVE_WRITES_UNAVAILABLE, type CommerceActions } from './lib/commerce';
import './styles.css';

// Public build (npm run build:demo, what Vercel runs). With VITE_API_URL set, the page reads the
// real backend at that address and falls back to the in-browser simulator when it's unreachable;
// without it, the page only simulates. The Docker image serves the app next to its own API and
// sets neither.
const publicBuild = import.meta.env.VITE_DEMO === 'true';
const apiUrl = (import.meta.env.VITE_API_URL ?? '').replace(/\/+$/, '');

let streamUrl: string | undefined;
let createEventSource: EventSourceFactory | undefined;
let mode: ReturnType<typeof createFallbackEventSourceFactory>['mode'] | undefined;
let actions: CommerceActions | undefined;
if (publicBuild && apiUrl) {
  const demo = createDemoRuntime();
  const fallback = createFallbackEventSourceFactory({
    live: (url) => new EventSource(url) as EventSourceLike,
    fallback: demo.factory,
  });
  streamUrl = `${apiUrl}/api/stream`;
  createEventSource = fallback.factory;
  mode = fallback.mode;
  // Writes only flow through the simulator; a live backend has no write API to call.
  const simulated = () => fallback.mode.get() === 'simulated';
  const refused = (): { ok: false; error: string } => ({ ok: false, error: LIVE_WRITES_UNAVAILABLE });
  actions = {
    get unavailableReason() {
      return simulated() ? undefined : LIVE_WRITES_UNAVAILABLE;
    },
    catalog: () => (simulated() ? demo.actions.catalog() : []),
    placeOrder: (lines) => (simulated() ? demo.actions.placeOrder(lines) : refused()),
    placePurchaseOrder: (sku, supplierId, quantity) =>
      simulated() ? demo.actions.placePurchaseOrder(sku, supplierId, quantity) : refused(),
    sendDuplicate: () => (simulated() ? demo.actions.sendDuplicate() : refused()),
    sendMalformed: () => (simulated() ? demo.actions.sendMalformed() : refused()),
    replayDeadLetter: () => (simulated() ? demo.actions.replayDeadLetter() : refused()),
  };
} else if (publicBuild) {
  const demo = createDemoRuntime();
  createEventSource = demo.factory;
  actions = demo.actions;
}

// The storefront is the public landing page; #/ops is the control tower.
if (!window.location.hash) window.history.replaceState(null, '', '#/');

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App
      streamUrl={streamUrl}
      createEventSource={createEventSource}
      demo={publicBuild && !apiUrl}
      mode={mode}
      actions={actions}
    />
  </StrictMode>,
);
