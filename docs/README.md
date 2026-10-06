# logos: architecture and planning

**logos** is a real-time order and inventory event platform: a portfolio piece that runs end to end the way a production system would. This folder holds the architecture, platform decisions and Jira backlog; the table shows where each part of the plan lives in the repo.

| Plan step | What | Where | Status |
|---|---|---|---|
| 1. Foundation | Architecture, decisions, Jira epics, Strimzi Kafka, AKS | `docs/`, `infra/aks/` | Done (not yet deployed) |
| 2. C# event services | Order + inventory services, saga over Kafka, outbox/inbox, PostgreSQL | `services/` | Built; .NET 10 + Kafka TLS/SCRAM in progress |
| 3. Live dashboard | TypeScript API + UI consuming the events, Jest tests | `dashboard/` | Not started |
| 4. Ship it | Kubernetes manifests, CI/CD, Jira wired into the workflow | `deploy/k8s/`, `.github/`, `scripts/` | Built; AKS deploy waits on the cluster ([deploy/README.md](../deploy/README.md)) |
| Optional | Jira flow add-on: lead/cycle time from the project's own Jira board | `addons/jira-flow/` | Working, tested |

The event contract in **`services/docs/events.md`** is the source of truth. Anything here that disagrees with it is a bug in this folder.

- [architecture.md](architecture.md): system view, repo layout, how each technology is used
- [decisions.md](decisions.md): decision log
- [backlog.md](backlog.md) and [jira-import.csv](jira-import.csv): epics and stories
- [../infra/aks/](../infra/aks/README.md): AKS cluster for the public demo
- [open-questions.md](open-questions.md): what still needs Anthony
