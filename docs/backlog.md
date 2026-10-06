# logos backlog

Generated from the same data as `jira-import.csv`. Points are relative (Fibonacci). E2-S1 is already built by the services thread.

## E1 · Foundation and repo

logos repo, conventions and the dev loop.

| ID | Story | Acceptance criteria | Pts | Priority |
|---|---|---|---|---|
| E1-S1 | Create logos repo and push foundation and services | Repo developer-az/logos exists with services/, foundation docs and addons/; main protected, CI required. | 1 | Highest |
| E1-S2 | Root README and contributor guide | Root README explains the system in one diagram and how to run it in one command; CONTRIBUTING covers branch naming with Jira keys. | 2 | High |
| E1-S3 | Upgrade services to .NET 10 LTS | All projects target net10.0; tests and integration tests green; Dockerfile uses 10.0 images (D-6). | 2 | High |
| E1-S4 | Align local tooling versions | Compose uses the same Kafka major version as the cluster; kafka-ui swapped to kafbat/kafka-ui (D-8, D-9). | 1 | Medium |

## E2 · Order and inventory services

C# saga over Kafka (services thread).

| ID | Story | Acceptance criteria | Pts | Priority |
|---|---|---|---|---|
| E2-S1 | Order and inventory saga with outbox and inbox | Built: place, confirm, reject, cancel; no overselling under concurrency; integration tests over real Kafka and PostgreSQL. | 8 | Highest |
| E2-S2 | Kafka SASL/TLS configuration | Services accept SCRAM username, password and CA path from config; connect to Strimzi TLS listener in a kind test. | 3 | High |
| E2-S3 | Product catalog owns prices | Order service looks up unit prices instead of trusting the client; price change event published. | 5 | Medium |
| E2-S4 | Shipment step after confirmation | Confirmed orders produce shipment.requested; documented in events.md. | 5 | Low |
| E2-S5 | DLT inspection and replay | Endpoint or CLI lists dead letters with error headers and re-publishes selected ones. | 3 | Medium |

## E3 · Live dashboard

TypeScript API and UI over the event streams, tested with Jest.

| ID | Story | Acceptance criteria | Pts | Priority |
|---|---|---|---|---|
| E3-S1 | Dashboard API consumes both topics | Node service consumes orders and inventory events, dedupes on eventId, ignores unknown eventTypes, keeps highest version per SKU. | 5 | Highest |
| E3-S2 | Projection logic unit tests in Jest | Jest covers out-of-order versions, duplicate events, unknown types, saga state per correlationId; coverage gate in CI. | 3 | Highest |
| E3-S3 | Live push to the browser | SSE or WebSocket stream of order status and stock levels; Jest tests for the HTTP and stream layer. | 3 | High |
| E3-S4 | Live UI | Page shows stock per SKU, order funnel (placed, confirmed, rejected, cancelled) and a per-order saga timeline by correlationId. | 5 | High |
| E3-S5 | Contract tests against events.md | Fixture events shared with the C# tests; both sides fail if the envelope or payloads drift. | 2 | High |

## E4 · Ship it: Kubernetes and CI/CD

Run logos on a real cluster with automated delivery.

| ID | Story | Acceptance criteria | Pts | Priority |
|---|---|---|---|---|
| E4-S1 | CI per component | GitHub Actions: dotnet test (with integration tests via Docker), Jest with coverage, kustomize render; required on PRs. | 3 | Highest |
| E4-S2 | Images to GHCR tagged by SHA | Main builds and pushes order, inventory and dashboard images. | 2 | High |
| E4-S3 | Kubernetes app manifests | Deployments, Services, probes, PDBs, resources for order, inventory, dashboard; PostgreSQL via operator or managed DB; ProvisionTopics off. | 5 | Highest |
| E4-S4 | Strimzi Kafka on the cluster | deploy/k8s/kafka applied; topics and SCRAM users match events.md; secrets synced to the app namespace. | 3 | High |
| E4-S5 | Local kind bring-up in one command | Script creates kind, installs Strimzi, deploys everything, runs an end-to-end order smoke test. | 3 | High |
| E4-S6 | Public demo with TLS | Ingress + cert-manager on the chosen cluster; dashboard public, write APIs rate-limited or behind a key. | 3 | High |
| E4-S7 | Load generator | Deployment that places and cancels realistic orders continuously so the demo is always live. | 3 | Medium |
| E4-S8 | Observability | OpenTelemetry traces across HTTP and Kafka using correlationId; Grafana panels for consumer lag, DLT rate, saga latency. | 5 | Medium |
| E4-S9 | CD to the cluster | Merges to main deploy automatically (Argo CD or Actions); rollback documented. | 3 | Medium |

## E5 · Jira in the workflow

Make Jira part of how logos is built, not just where tasks sit.

| ID | Story | Acceptance criteria | Pts | Priority |
|---|---|---|---|---|
| E5-S1 | Import this backlog into Jira | Epics and stories created in the logos Jira project with parents and points. | 1 | Highest |
| E5-S2 | Link commits and PRs to Jira | Branch names and PR titles carry issue keys; GitHub for Jira app shows dev status on issues. | 1 | High |
| E5-S3 | Jira flow add-on (optional) | addons/jira-flow deployed against the logos board; lead and cycle time P50/P85 shown on the dashboard. | 3 | Low |

## Importing into Jira

Jira Cloud: *Settings → System → External system import → CSV*. Map `Issue ID` and `Parent` so stories nest under epics, `Story Points` to your site's points field (team-managed projects call it *Story point estimate*), and both `Labels` columns to Labels (Jira takes one label per column).
