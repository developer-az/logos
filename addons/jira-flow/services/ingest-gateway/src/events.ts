/**
 * IssueEvent v1, published to `jira.issue-events.v1` keyed by issueKey.
 * Mirrored in services/metrics-service/src/Metrics.Core/Events/IssueEvent.cs; the
 * contract fixture in test/fixtures/normalized-transition.json is asserted on both sides.
 */
export const SCHEMA_VERSION = 1;

export type IssueEventType = 'issue.created' | 'issue.transitioned' | 'issue.deleted';
export type StatusCategory = 'todo' | 'in_progress' | 'done';

export interface IssueEvent {
  schemaVersion: typeof SCHEMA_VERSION;
  /** Deterministic, so a webhook Jira retries produces the same id and is deduped downstream. */
  id: string;
  type: IssueEventType;
  occurredAt: string;
  issueKey: string;
  projectKey: string;
  toCategory: StatusCategory;
  fromStatus?: string;
  toStatus?: string;
}
