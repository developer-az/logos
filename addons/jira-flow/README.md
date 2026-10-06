# Jira flow add-on (optional)

Optional add-on to **logos**. It is not part of the core order and inventory platform. It ingests Jira webhooks into Kafka and computes lead time, cycle time and P50/P85 flow metrics, so the project can report on its own delivery using its own Jira board.

How it uses the stack:

| Tech | Role here |
|---|---|
| **Jira** | Source of truth for work items (webhooks in) and where this project's own backlog lives (`docs/jira-import.csv`) |
| **Kafka** | Durable event log between services (`jira.issue-events.v1` → `delivery.issue-metrics.v1`) |
| **C# (.NET 10)** | `metrics-service`: consumes issue events, computes lead time, cycle time and project flow percentiles |
| **TypeScript + Jest** | `ingest-gateway`: verifies and normalizes Jira webhooks, publishes to Kafka; Jest unit and HTTP tests |
| **Kubernetes** | Kustomize base + local overlay, Strimzi-managed Kafka (KRaft, SCRAM, ACLs) |


## Layout

```
services/ingest-gateway/   TypeScript, Fastify, Confluent Kafka client, Jest
services/metrics-service/  C# solution: Metrics.Core (pure domain), Metrics.Service (host + consumer), xUnit tests
deploy/                    base/, overlays/local/, kafka/ (topics + users on the shared Strimzi cluster, namespace logos)
docker-compose.yml         Kafka 4.1 (KRaft) + both services for local dev
scripts/smoke.sh           End-to-end check through real Kafka
ARCHITECTURE.md            data flow, delivery guarantees, metric definitions
```

## Quickstart

```bash
make test        # dotnet test + jest (typecheck, coverage thresholds)
make smoke       # docker compose up, then a signed webhook sequence end to end
make manifests   # render the local Kubernetes overlay
make down
```

Requirements: .NET SDK 10, Node 22, Docker. For Kubernetes: kind, kubectl, and the Strimzi operator.

## Verified so far

- `dotnet test`: 15 passing (timeline math, dedupe, out-of-order, reopen, percentiles, contract fixture)
- `npm test`: 26 passing, ~98% line coverage on tested modules
- `scripts/smoke.sh` against compose: webhook → gateway → Kafka → C# → API returns lead 3d / cycle 2d; duplicate delivery ignored; state rebuilt correctly after a service restart
- `kubectl kustomize` renders both `deploy/overlays/local` and `deploy/kafka/`. Not yet applied to a live cluster.

## Deploying next to logos

The add-on runs in namespace `logos` beside the platform from `deploy/k8s`, using the same `logos-kafka` cluster (Strimzi `kafka.strimzi.io/v1`):

```bash
kubectl apply -k addons/jira-flow/deploy/kafka                 # topics + KafkaUsers
cp addons/jira-flow/deploy/overlays/local/webhook.env.example addons/jira-flow/deploy/overlays/local/webhook.env  # set secret
kubectl apply -k addons/jira-flow/deploy/overlays/local
```

The platform namespace denies ingress by default, so exposing `/webhooks/jira` to Jira needs a route on the platform gateway plus a NetworkPolicy allowing that gateway to reach `ingest-gateway:8080`.
