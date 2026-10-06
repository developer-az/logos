import { randomBytes } from 'node:crypto';
import { buildApp } from '../src/app';
import { IssueEvent } from '../src/events';
import { sign } from '../src/jira/signature';
import { EventPublisher } from '../src/publisher';
import statusUpdate from './fixtures/jira-issue-updated-status.json';

// Generated per run so no credential-like literal lives in source.
const SECRET = randomBytes(32).toString('hex');

function setup(publish: EventPublisher['publish'] = async () => {}) {
  const publisher = { publish: jest.fn(publish), close: jest.fn(async () => {}) };
  const app = buildApp({ publisher, webhookSecret: SECRET });
  const post = (body: string, signature = sign(body, SECRET)) =>
    app.inject({
      method: 'POST',
      url: '/webhooks/jira',
      headers: { 'content-type': 'application/json', 'x-hub-signature': signature },
      payload: body,
    });
  return { app, publisher, post };
}

describe('POST /webhooks/jira', () => {
  const body = JSON.stringify(statusUpdate);

  it('publishes normalized events and returns 202', async () => {
    const { publisher, post } = setup();
    const res = await post(body);
    expect(res.statusCode).toBe(202);
    expect(res.json()).toEqual({ accepted: 1 });
    const [events] = publisher.publish.mock.calls[0] as [IssueEvent[]];
    expect(events[0]).toMatchObject({ issueKey: 'ABC-1', type: 'issue.transitioned' });
  });

  it('rejects a bad signature without publishing', async () => {
    const { publisher, post } = setup();
    const res = await post(body, sign(body, randomBytes(32).toString('hex')));
    expect(res.statusCode).toBe(401);
    expect(publisher.publish).not.toHaveBeenCalled();
  });

  it('returns 422 for a payload it cannot normalize', async () => {
    const bad = JSON.stringify({ webhookEvent: 'jira:issue_updated', timestamp: 1 });
    const res = await setup().post(bad);
    expect(res.statusCode).toBe(422);
  });

  it('returns 400 for malformed JSON', async () => {
    const res = await setup().post('{not json');
    expect(res.statusCode).toBe(400);
  });

  it('returns 5xx when Kafka is unavailable so Jira retries', async () => {
    const { post } = setup(async () => {
      throw new Error('broker down');
    });
    const res = await post(body);
    expect(res.statusCode).toBe(500);
  });
});

describe('GET /healthz', () => {
  it('reports ok', async () => {
    const res = await setup().app.inject({ method: 'GET', url: '/healthz' });
    expect(res.json()).toEqual({ status: 'ok' });
  });
});
