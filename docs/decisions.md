# Decision log

**Accepted** = settled by Anthony or already built. **Proposed** = recommended default, open to change.

| ID | Decision | Status | Rationale / alternatives |
|---|---|---|---|
| D-1 | Domain: real-time order and inventory event platform | Accepted | Anthony approved the plan, 2026-10-06. |
| D-2 | Goal: portfolio piece that works in the real world | Accepted | Anthony, 2026-10-06. Implies a public demo, realistic load, visible CI and observability, not just local compose. |
| D-3 | Repo: `logos` under developer-az | Accepted | Monorepo layout in docs/architecture.md. |
| D-4 | Event contract lives in `services/docs/events.md`; JSON envelope with `eventId`, `correlationId`, `causationId`, `schemaVersion` | Accepted | Built by the services thread. Move to a schema registry (Avro/Protobuf) if a non-.NET producer appears. |
| D-5 | Choreographed saga, transactional outbox + inbox, PostgreSQL per service | Accepted | See services README. Revisit orchestration if payment or shipping joins. |
| D-6 | Upgrade services from .NET 8 to .NET 10 (LTS) | Accepted | Anthony, 2026-10-06; done in the services' .NET 10 PR. | .NET 8 support ends 2026-11-10, about five weeks out. A portfolio repo on an unsupported runtime reads badly, and the upgrade is cheapest before more code lands. |
| D-7 | Kafka on Kubernetes via Strimzi 1.x (`kafka.strimzi.io/v1`), Kafka 4.3.1, KRaft, TLS + SCRAM + ACLs, one user per service | Accepted | Built in `deploy/k8s/kafka/`. Strimzi 1.0 removed the `v1beta2` API and 1.1 dropped Kafka 4.1, so the manifests target 1.2.0 and Kafka 4.3.1. Managed alternatives: Confluent Cloud, Azure Event Hubs (Kafka API), AWS MSK. |
| D-8 | Align Kafka image versions: compose, dashboard CI and the cluster all run Kafka 4.3.1 | Accepted | Test against the same major version you deploy. |
| D-9 | Replace `provectuslabs/kafka-ui` with the maintained fork `kafbat/kafka-ui` | Proposed | The original has had no releases since 2024. |
| D-10 | Jest for TypeScript, xUnit for C# | Accepted | Jest doesn't run .NET; each language keeps its native runner. |
| D-11 | Cluster: kind locally, AKS for the public demo | Accepted | Anthony, 2026-10-06. `infra/aks/main.bicep`: 3 × D2as_v5, Cilium, workload identity. Stop the cluster when idle to control cost. |
| D-12 | Kustomize for our own manifests, Helm only for third-party charts | Proposed | Few services and knobs; overlays are easier to review. |
| D-14 | No secrets in git: `.env`/`webhook.env` files are gitignored, `.example` files show the shape; in-cluster secrets come from Key Vault via External Secrets | Accepted | Follows the 2026-10-06 generic-password alert. Test secrets are generated at runtime. |
| D-15 | One namespace (`logos`) for Kafka, PostgreSQL and the apps; Strimzi operator in `strimzi` watching it | Accepted | Strimzi writes user password and cluster CA Secrets into the Kafka cluster's namespace, so pods mount them directly instead of syncing across namespaces. Isolation comes from default-deny NetworkPolicies and per-app Kafka ACLs. |
| D-16 | Public demo through the Gateway API (Envoy Gateway) with cert-manager | Accepted | ingress-nginx was retired in March 2026. Dashboard public; order API rate limited; inventory API internal. |
| D-17 | CD: GitHub Actions applies `deploy/k8s/overlays/aks` with SHA-tagged GHCR images, smoke-tests and rolls back on failure | Accepted | Simpler than Argo CD for one cluster and one repo. Azure sign-in is OIDC, so no cloud secret is stored. |
| D-13 | Jira flow metrics are an optional add-on, not core | Accepted | Coordinator direction after D-1. Lives in `addons/jira-flow/`, fully tested. |
