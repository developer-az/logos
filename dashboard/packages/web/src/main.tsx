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
import { LIVE_ORDERING_UNAVAILABLE, type CommerceActions } from './lib/commerce';
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
  // Orders only flow through the simulator; on a live backend there is no write API to call.
  actions = {
    get unavailableReason() {
      return fallback.mode.get() === 'simulated' ? undefined : LIVE_ORDERING_UNAVAILABLE;
    },
    catalog: () => (fallback.mode.get() === 'simulated' ? demo.actions.catalog() : []),
    placeOrder: (lines) =>
      fallback.mode.get() === 'simulated'
        ? demo.actions.placeOrder(lines)
        : { ok: false, error: LIVE_ORDERING_UNAVAILABLE },
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
