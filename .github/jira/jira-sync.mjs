// Keeps Jira in step with pull requests, run by .github/workflows/jira.yml (backlog E5-S2).
//
//   PR opened, reopened or marked ready  -> issue linked to the PR, moved to the review status
//   PR merged                            -> issue moved to the done status, link marked resolved
//   any other PR event                   -> link refreshed (title changes, new keys)
//
// Issue keys are read from the PR title and branch name (e.g. "LOGOS-12 Add DLT replay" or
// "logos-12-dlt-replay"). Without Jira credentials it only reports the keys it found, so the
// workflow is useful before Jira is connected and never blocks a merge because Jira is down.
// No dependencies: Node 22's fetch and node:test.
import { appendFileSync, readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

/** Issue keys in `texts`, uppercased and de-duplicated, limited to `projectKey` when given. */
export function extractIssueKeys(texts, projectKey) {
  const project = projectKey ? projectKey.toUpperCase() : '[A-Z][A-Z0-9]+';
  const pattern = new RegExp(`(?<![A-Za-z0-9])(${project})-(\\d+)(?![A-Za-z0-9])`, 'gi');
  const keys = new Set();
  for (const text of texts) {
    for (const m of (text ?? '').matchAll(pattern)) keys.add(`${m[1].toUpperCase()}-${m[2]}`);
  }
  return [...keys];
}

/** What to do in Jira for a pull_request event: always link, sometimes move the issue. */
export function planFor(event, statuses) {
  const pr = event.pull_request;
  const merged = event.action === 'closed' && pr.merged === true;
  let moveTo = null;
  if (merged) moveTo = statuses.done;
  else if (['opened', 'reopened', 'ready_for_review'].includes(event.action) && !pr.draft) moveTo = statuses.review;
  return {
    keys: extractIssueKeys([pr.title, pr.head?.ref], statuses.projectKey),
    link: { url: pr.html_url, title: `PR #${pr.number}: ${pr.title}`, resolved: merged || pr.state === 'closed' },
    moveTo,
  };
}

export class JiraClient {
  constructor({ baseUrl, email, token, fetchImpl = fetch }) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.auth = `Basic ${Buffer.from(`${email}:${token}`).toString('base64')}`;
    this.fetch = fetchImpl;
  }

  async request(method, path, body) {
    const res = await this.fetch(`${this.baseUrl}/rest/api/3${path}`, {
      method,
      headers: { Authorization: this.auth, Accept: 'application/json', 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`${method} ${path}: HTTP ${res.status} ${await res.text()}`);
    return res.status === 204 ? null : res.json();
  }

  /** Remote links are keyed by globalId, so re-running updates the same link. */
  linkPullRequest(key, link) {
    return this.request('POST', `/issue/${key}/remotelink`, {
      globalId: link.url,
      object: { url: link.url, title: link.title, status: { resolved: link.resolved } },
    });
  }

  /** Moves the issue to `statusName` through whichever transition leads there. */
  async moveTo(key, statusName) {
    const issue = await this.request('GET', `/issue/${key}?fields=status`);
    const current = issue.fields.status.name;
    if (current.toLowerCase() === statusName.toLowerCase()) return `already ${current}`;
    const { transitions } = await this.request('GET', `/issue/${key}/transitions`);
    const t = transitions.find((x) => x.to?.name?.toLowerCase() === statusName.toLowerCase());
    if (!t) return `no transition from ${current} to ${statusName}`;
    await this.request('POST', `/issue/${key}/transitions`, { transition: { id: t.id } });
    return `${current} -> ${t.to.name}`;
  }
}

/** Runs the plan; Jira errors become warnings so a Jira outage never fails CI. */
export async function sync({ event, env, client, log = console.log }) {
  const statuses = {
    projectKey: env.JIRA_PROJECT_KEY || undefined,
    review: env.JIRA_REVIEW_STATUS || 'In Review',
    done: env.JIRA_DONE_STATUS || 'Done',
  };
  const plan = planFor(event, statuses);
  const lines = [];
  if (plan.keys.length === 0) {
    const msg = `No Jira issue key in the PR title or branch name${statuses.projectKey ? ` (expected ${statuses.projectKey}-<number>)` : ''}.`;
    log(`${env.JIRA_KEY_REQUIRED === 'true' ? '::error::' : '::warning::'}${msg}`);
    return { ok: env.JIRA_KEY_REQUIRED !== 'true', lines: [msg] };
  }
  if (!client) {
    lines.push(`Issue keys: ${plan.keys.join(', ')}. Jira is not configured, so nothing was synced.`);
    log(`::notice::${lines[0]}`);
    return { ok: true, lines };
  }
  for (const key of plan.keys) {
    try {
      await client.linkPullRequest(key, plan.link);
      const moved = plan.moveTo ? await client.moveTo(key, plan.moveTo) : 'status unchanged';
      lines.push(`${key}: linked, ${moved}`);
    } catch (err) {
      lines.push(`${key}: ${err.message}`);
      log(`::warning::Jira ${key}: ${err.message}`);
    }
  }
  lines.forEach((l) => log(l));
  return { ok: true, lines };
}

async function main() {
  const env = process.env;
  const event = JSON.parse(readFileSync(env.GITHUB_EVENT_PATH, 'utf8'));
  const configured = env.JIRA_BASE_URL && env.JIRA_USER_EMAIL && env.JIRA_API_TOKEN;
  const client = configured
    ? new JiraClient({ baseUrl: env.JIRA_BASE_URL, email: env.JIRA_USER_EMAIL, token: env.JIRA_API_TOKEN })
    : null;
  const result = await sync({ event, env, client });
  if (env.GITHUB_STEP_SUMMARY) {
    appendFileSync(env.GITHUB_STEP_SUMMARY, `### Jira\n\n${result.lines.map((l) => `- ${l}`).join('\n')}\n`);
  }
  process.exitCode = result.ok ? 0 : 1;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) await main();
