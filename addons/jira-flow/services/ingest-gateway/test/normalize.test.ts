import { normalize, UnsupportedPayloadError } from '../src/jira/normalize';
import { JiraWebhook } from '../src/jira/webhook';
import statusUpdate from './fixtures/jira-issue-updated-status.json';
import contract from './fixtures/normalized-transition.json';

const clone = (): JiraWebhook => structuredClone(statusUpdate) as JiraWebhook;

describe('normalize', () => {
  it('maps a status change to the IssueEvent v1 contract shared with the C# consumer', () => {
    expect(normalize(clone())).toEqual([contract]);
  });

  it('ignores updates that do not change status', () => {
    const payload = clone();
    payload.changelog!.items = [{ field: 'summary', fromString: 'a', toString: 'b' }];
    expect(normalize(payload)).toEqual([]);
  });

  it.each([
    ['new', 'todo'],
    ['indeterminate', 'in_progress'],
    ['done', 'done'],
  ])('maps Jira status category %s to %s', (jiraKey, expected) => {
    const payload = clone();
    payload.issue!.fields!.status!.statusCategory!.key = jiraKey;
    expect(normalize(payload)[0]?.toCategory).toBe(expected);
  });

  it('emits created and deleted events', () => {
    const created = { ...clone(), webhookEvent: 'jira:issue_created', changelog: undefined };
    const deleted = { ...clone(), webhookEvent: 'jira:issue_deleted' };
    expect(normalize(created)[0]).toMatchObject({ type: 'issue.created', id: 'jira:10001:1790845200000:created' });
    expect(normalize(deleted)[0]).toMatchObject({ type: 'issue.deleted' });
  });

  it('produces the same id when Jira retries the same webhook', () => {
    expect(normalize(clone())[0]?.id).toBe(normalize(clone())[0]?.id);
  });

  it('falls back to the issue key prefix when the project is absent', () => {
    const payload = clone();
    delete payload.issue!.fields!.project;
    expect(normalize(payload)[0]?.projectKey).toBe('ABC');
  });

  it('ignores unrelated webhook events', () => {
    expect(normalize({ ...clone(), webhookEvent: 'comment_created' })).toEqual([]);
  });

  it.each([
    ['missing issue', (p: JiraWebhook) => delete p.issue],
    ['unknown status category', (p: JiraWebhook) => (p.issue!.fields!.status!.statusCategory!.key = 'weird')],
  ])('rejects payloads with %s', (_name, mutate) => {
    const payload = clone();
    mutate(payload);
    expect(() => normalize(payload)).toThrow(UnsupportedPayloadError);
  });
});
