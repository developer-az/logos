# Jira in the workflow

Work for logos is tracked in a Jira project (key `LOGOS` by default). Three things connect it to
this repository; the first works today, the other two need a Jira site.

## 1. Issue keys on every pull request

Put the issue key in the PR title (`LOGOS-12 Add DLT replay`) or the branch name
(`logos-12-dlt-replay`). The [jira workflow](../workflows/jira.yml) reads it on every PR event:

| PR event | In Jira |
|---|---|
| opened, reopened, marked ready for review | PR linked on the issue; issue moved to **In Review** |
| merged | issue moved to **Done**; link marked resolved |
| new commits, title edits, drafts | link refreshed only |

It moves an issue by the *target status name*, so it works with any workflow that has those
statuses, and it skips issues already there. Jira errors show as warnings and never fail a PR.
Before Jira is configured the job only reports the keys it found.

## 2. Turning on the sync

1. In Jira Cloud, create the project (key `LOGOS`) and import the backlog from
   `docs/jira-import.csv` (instructions in `docs/backlog.md`), or have
   Claude create it through the Atlassian connector.
2. Create an API token for the account that will act for CI: https://id.atlassian.com/manage-profile/security/api-tokens
3. In GitHub, *Settings > Secrets and variables > Actions*:
   - Secrets: `JIRA_USER_EMAIL`, `JIRA_API_TOKEN`
   - Variables: `JIRA_BASE_URL` (e.g. `https://your-site.atlassian.net`)
   - Optional variables: `JIRA_PROJECT_KEY` (default `LOGOS`), `JIRA_REVIEW_STATUS`
     (default `In Review`), `JIRA_DONE_STATUS` (default `Done`), and `JIRA_KEY_REQUIRED=true`
     to fail PRs that carry no key.

## 3. Development and deployment panel on each issue

Install the **GitHub for Jira** app (Atlassian Marketplace) on the Jira site and connect the
`developer-az` organization. Jira then shows branches, commits, PRs, builds, and deployments to
the `aks-demo` environment (from [deploy.yml](../workflows/deploy.yml)) on every issue whose
key appears in them, and smart commits (`LOGOS-12 #comment ...`) work.

The sync script has no dependencies; its tests run with `node --test .github/jira`.
