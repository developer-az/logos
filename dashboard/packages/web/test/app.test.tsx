import { act, render, screen } from '@testing-library/react';
import { App } from '../src/App';
import { FakeEventSource, snapshot } from './fixtures';

beforeEach(() => (FakeEventSource.instances = []));

it('waits for data, then renders the live dashboard', () => {
  render(<App createEventSource={FakeEventSource.factory} />);
  expect(screen.getByText('Waiting for the first update…')).toBeInTheDocument();

  const es = FakeEventSource.latest();
  act(() => {
    es.open();
    es.emit('snapshot', snapshot());
  });

  expect(screen.getByRole('heading', { name: 'Events per minute' })).toBeInTheDocument();
  expect(screen.getByRole('heading', { name: 'Low stock' })).toBeInTheDocument();
  expect(screen.getByText('0b5a3c1e')).toBeInTheDocument();
  expect(screen.getByLabelText('Consumer health')).toHaveTextContent('12 duplicates ignored');
  expect(screen.queryByText(/Replaying event history/)).toBeNull();
});

it('warns while the API is still replaying history', () => {
  render(<App createEventSource={FakeEventSource.factory} />);
  act(() => {
    FakeEventSource.latest().open();
    FakeEventSource.latest().emit('snapshot', snapshot({ caughtUp: false }));
  });
  expect(screen.getByText(/Replaying event history/)).toBeInTheDocument();
  expect(screen.getByText('Catching up')).toBeInTheDocument();
});

it('updates in place as new snapshots arrive', () => {
  render(<App createEventSource={FakeEventSource.factory} />);
  const es = FakeEventSource.latest();
  act(() => es.emit('snapshot', snapshot()));
  const base = snapshot();
  act(() => es.emit('snapshot', { ...base, orders: { ...base.orders, total: 121 } }));
  expect(screen.getByText('Orders', { selector: '.tile-label' }).parentElement).toHaveTextContent('121');
});
