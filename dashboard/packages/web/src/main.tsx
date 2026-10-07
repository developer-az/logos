import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { createDemoEventSourceFactory } from './demo/demo-stream';
import './styles.css';

// Set at build time (npm run build:demo) for the public, backend-free deployment.
const demo = import.meta.env.VITE_DEMO === 'true';
const createEventSource = demo ? createDemoEventSourceFactory() : undefined;

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App demo={demo} createEventSource={createEventSource} />
  </StrictMode>,
);
