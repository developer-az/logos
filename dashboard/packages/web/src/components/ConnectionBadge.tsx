import type { ConnectionState } from '../hooks/useLiveSnapshot';

const TEXT: Record<ConnectionState | 'replaying', string> = {
  connecting: 'Connecting',
  live: 'Live',
  reconnecting: 'Reconnecting',
  replaying: 'Catching up',
};

/** Connection state as icon + text (never color alone), announced politely to screen readers. */
export function ConnectionBadge({ connection, caughtUp }: { connection: ConnectionState; caughtUp: boolean | null }) {
  const state = connection === 'live' && caughtUp === false ? 'replaying' : connection;
  return (
    <span className={`badge badge-${state}`} role="status" aria-live="polite">
      <span className="dot" aria-hidden="true" />
      {TEXT[state]}
    </span>
  );
}
