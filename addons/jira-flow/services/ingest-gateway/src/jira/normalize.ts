import { IssueEvent, SCHEMA_VERSION, StatusCategory } from '../events';
import { JiraWebhook } from './webhook';

export class UnsupportedPayloadError extends Error {}

// Jira has three fixed status categories regardless of how a workflow names its statuses.
const CATEGORY_BY_JIRA_KEY: Record<string, StatusCategory> = {
  new: 'todo',
  indeterminate: 'in_progress',
  done: 'done',
};

/**
 * Converts one Jira webhook into zero or more IssueEvents. Updates that do not change status
 * (edits, comments, assignee changes) yield nothing: they do not affect flow metrics.
 */
export function normalize(payload: JiraWebhook): IssueEvent[] {
  const issue = payload.issue;
  if (!issue?.key || !issue.id || typeof payload.timestamp !== 'number') {
    throw new UnsupportedPayloadError('Webhook is missing issue.id, issue.key or timestamp.');
  }

  const projectKey = issue.fields?.project?.key ?? issue.key.split('-')[0] ?? issue.key;
  const categoryKey = issue.fields?.status?.statusCategory?.key;
  const toCategory = categoryKey ? CATEGORY_BY_JIRA_KEY[categoryKey] : undefined;
  if (!toCategory) {
    throw new UnsupportedPayloadError(`Unknown status category "${categoryKey}" on ${issue.key}.`);
  }

  const base = {
    schemaVersion: SCHEMA_VERSION,
    occurredAt: new Date(payload.timestamp).toISOString(),
    issueKey: issue.key,
    projectKey,
    toCategory,
  } as const;
  const id = (kind: string) => `jira:${issue.id}:${payload.timestamp}:${kind}`;

  switch (payload.webhookEvent) {
    case 'jira:issue_created':
      return [{ ...base, id: id('created'), type: 'issue.created', toStatus: issue.fields?.status?.name }];

    case 'jira:issue_deleted':
      return [{ ...base, id: id('deleted'), type: 'issue.deleted' }];

    case 'jira:issue_updated': {
      const change = payload.changelog?.items?.find((i) => i.field === 'status');
      if (!change) return [];
      return [
        {
          ...base,
          id: id('status'),
          type: 'issue.transitioned',
          fromStatus: change.fromString ?? undefined,
          toStatus: change.toString ?? undefined,
        },
      ];
    }

    default:
      return [];
  }
}
