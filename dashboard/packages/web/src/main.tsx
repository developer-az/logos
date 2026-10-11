import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { createDemoEventSourceFactory } from './demo/demo-stream';
import { createFallbackEventSourceFactory } from './hooks/fallback-source';
import type { EventSourceFactory, EventSourceLike } from './hooks/useLiveSnapshot';
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
if (publicBuild && apiUrl) {
  const fallback = createFallbackEventSourceFactory({
    live: (url) => new EventSource(url) as EventSourceLike,
    fallback: createDemoEventSourceFactory(),
  });
  streamUrl = `${apiUrl}/api/stream`;
  createEventSource = fallback.factory;
  mode = fallback.mode;
} else if (publicBuild) {
  createEventSource = createDemoEventSourceFactory();
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App
      streamUrl={streamUrl}
      createEventSource={createEventSource}
      demo={publicBuild && !apiUrl}
      mode={mode}
    />
  </StrictMode>,
);
