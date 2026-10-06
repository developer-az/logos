/** The subset of the Jira Cloud webhook payload this service reads. */
export interface JiraWebhook {
  webhookEvent: string;
  timestamp: number;
  issue?: {
    id: string;
    key: string;
    fields?: {
      project?: { key?: string };
      status?: { name?: string; statusCategory?: { key?: string } };
    };
  };
  changelog?: {
    id?: string;
    items?: Array<{ field?: string; fromString?: string | null; toString?: string | null }>;
  };
}
