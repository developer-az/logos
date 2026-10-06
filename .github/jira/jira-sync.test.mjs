// node --test .github/jira
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { JiraClient, extractIssueKeys, planFor, sync } from './jira-sync.mjs';

const pr = (over = {}) => ({
  number: 7, title: 'LOGOS-12 Add DLT replay', html_url: 'https://github.com/developer-az/logos/pull/7',
  draft: false, merged: false, state: 'open', head: { ref: 'logos-12-dlt-replay' }, ...over,
});
const statuses = { projectKey: 'LOGOS', review: 'In Review', done: 'Done' };

describe('extractIssueKeys', () => {
  it('reads keys from titles and lowercase branch names, de-duplicated', () => {
    assert.deepEqual(extractIssueKeys(['LOGOS-12 Add replay', 'logos-12-replay', 'feature/LOGOS-3'], 'LOGOS'), ['LOGOS-12', 'LOGOS-3']);
  });
  it('limits to the project key when given', () => {
    assert.deepEqual(extractIssueKeys(['ABC-1 and LOGOS-2'], 'LOGOS'), ['LOGOS-2']);
    assert.deepEqual(extractIssueKeys(['ABC-1 and LOGOS-2']), ['ABC-1', 'LOGOS-2']);
  });
  it('ignores look-alikes', () => {
    assert.deepEqual(extractIssueKeys(['UTF-8 xLOGOS-1 LOGOS-12a sha256-ab'], 'LOGOS'), []);
    assert.deepEqual(extractIssueKeys([undefined, ''], 'LOGOS'), []);
  });
});

describe('planFor', () => {
  it('moves an opened PR to review', () => {
    assert.equal(planFor({ action: 'opened', pull_request: pr() }, statuses).moveTo, 'In Review');
  });
  it('only links drafts and pushes', () => {
    assert.equal(planFor({ action: 'opened', pull_request: pr({ draft: true }) }, statuses).moveTo, null);
    assert.equal(planFor({ action: 'synchronize', pull_request: pr() }, statuses).moveTo, null);
  });
  it('moves a merged PR to done and resolves the link', () => {
    const plan = planFor({ action: 'closed', pull_request: pr({ merged: true, state: 'closed' }) }, statuses);
    assert.equal(plan.moveTo, 'Done');
    assert.equal(plan.link.resolved, true);
  });
  it('leaves the issue alone when a PR is closed unmerged', () => {
    const plan = planFor({ action: 'closed', pull_request: pr({ state: 'closed' }) }, statuses);
    assert.equal(plan.moveTo, null);
    assert.equal(plan.link.resolved, true);
  });
});

/** A fake Jira: records calls, serves one issue in `status` with the given transitions. */
function fakeJira(status, transitions, { failWith } = {}) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    const path = new URL(url).pathname.replace('/rest/api/3', '');
    calls.push({ method: init.method, path, body: init.body ? JSON.parse(init.body) : undefined, auth: init.headers.Authorization });
    if (failWith) return new Response('nope', { status: failWith });
    if (path.endsWith('/transitions') && init.method === 'GET') return Response.json({ transitions });
    if (init.method === 'GET') return Response.json({ fields: { status: { name: status } } });
    return new Response(null, { status: 204 });
  };
  return { calls, client: new JiraClient({ baseUrl: 'https://x.atlassian.net/', email: 'a@b.c', token: 't', fetchImpl }) };
}

describe('sync', () => {
  const quiet = () => {};
  it('links the PR and transitions to the status by target name', async () => {
    const { calls, client } = fakeJira('In Progress', [{ id: '21', to: { name: 'In Review' } }, { id: '31', to: { name: 'Done' } }]);
    const r = await sync({ event: { action: 'opened', pull_request: pr() }, env: { JIRA_PROJECT_KEY: 'LOGOS' }, client, log: quiet });
    assert.deepEqual(r.lines, ['LOGOS-12: linked, In Progress -> In Review']);
    assert.equal(calls[0].path, '/issue/LOGOS-12/remotelink');
    assert.equal(calls[0].body.globalId, 'https://github.com/developer-az/logos/pull/7');
    assert.equal(calls[0].auth, `Basic ${Buffer.from('a@b.c:t').toString('base64')}`);
    assert.deepEqual(calls.at(-1), { method: 'POST', path: '/issue/LOGOS-12/transitions', body: { transition: { id: '21' } }, auth: calls[0].auth });
  });
  it('does not transition an issue already in the target status', async () => {
    const { calls, client } = fakeJira('Done', []);
    const event = { action: 'closed', pull_request: pr({ merged: true, state: 'closed' }) };
    const r = await sync({ event, env: { JIRA_PROJECT_KEY: 'LOGOS' }, client, log: quiet });
    assert.deepEqual(r.lines, ['LOGOS-12: linked, already Done']);
    assert.equal(calls.filter((c) => c.path.endsWith('/transitions')).length, 0);
  });
  it('turns Jira errors into warnings, not failures', async () => {
    const { client } = fakeJira('To Do', [], { failWith: 401 });
    const logs = [];
    const r = await sync({ event: { action: 'opened', pull_request: pr() }, env: {}, client, log: (l) => logs.push(l) });
    assert.equal(r.ok, true);
    assert.match(logs[0], /^::warning::Jira LOGOS-12: POST \/issue\/LOGOS-12\/remotelink: HTTP 401/);
  });
  it('reports keys without calling Jira when it is not configured', async () => {
    const r = await sync({ event: { action: 'opened', pull_request: pr() }, env: {}, client: null, log: quiet });
    assert.equal(r.ok, true);
    assert.match(r.lines[0], /LOGOS-12.*not configured/);
  });
  it('fails a PR without a key only when keys are required', async () => {
    const event = { action: 'opened', pull_request: pr({ title: 'Tidy up', head: { ref: 'tidy' } }) };
    assert.equal((await sync({ event, env: {}, client: null, log: quiet })).ok, true);
    assert.equal((await sync({ event, env: { JIRA_KEY_REQUIRED: 'true' }, client: null, log: quiet })).ok, false);
  });
});
