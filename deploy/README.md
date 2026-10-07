# Deploying logos

Everything runs in one namespace, `logos`: Kafka (Strimzi), PostgreSQL, the two .NET services,
the dashboard and a load generator. The same manifests run on a laptop (kind), in CI, and on the
AKS demo cluster; only the overlay differs.

```
deploy/k8s/
  namespace/        the logos namespace (Pod Security: baseline enforced, restricted warned)
  kafka/            Strimzi Kafka 4.3.1 (KRaft, TLS + SCRAM-SHA-512), topics and one KafkaUser per app
  apps/             postgres, order-service, inventory-service, dashboard, load-generator, network policies
  overlays/local/   kind: 1 broker, 1 replica each, images built locally
  overlays/aks/     AKS: 3 brokers, 2 replicas each, HTTPS via Envoy Gateway, passwords from Key Vault
  platform/aks/     cluster-scoped GatewayClass and Let's Encrypt ClusterIssuer (applied once)
```

No Kubernetes needed for a public demo: [vm/](vm/README.md) runs the same stack on one VM with
Docker Compose and HTTPS.

## Run it locally

Needs Docker, kind, kubectl, helm, jq and openssl.

```bash
scripts/kind-up.sh      # cluster, images, Strimzi, secrets, apply, wait, smoke test
kubectl -n logos port-forward svc/dashboard 8080:80          # http://localhost:8080
kubectl -n logos port-forward svc/order-service 5001:80      # http://localhost:5001/swagger
scripts/kind-down.sh
```

`scripts/smoke.sh` is the end-to-end check: it creates a SKU with 10 units, places an order for 4
(confirmed through Kafka), one for 7 (rejected), cancels the first (stock released), and checks
the dashboard shows both. It also runs against docker compose:
`ORDER_URL=http://localhost:5001 INVENTORY_URL=http://localhost:5002 WITH_DASHBOARD=false scripts/smoke.sh`.

## How the pieces connect

| From | To | How |
|---|---|---|
| order-service, inventory-service | Kafka | `logos-kafka-kafka-bootstrap:9093`, TLS (Strimzi cluster CA mounted at `/etc/kafka-ca`), SCRAM user named after the app; `Kafka__ProvisionTopics=false` because Strimzi owns the topics |
| dashboard | Kafka | same listener, user `dashboard`; one consumer group per replica (`dashboard-*`, prefixed ACL); `NODE_EXTRA_CA_CERTS` trusts the cluster CA |
| services | PostgreSQL | own database and role each (`orders`, `inventory`); passwords from Secret `postgres-credentials` |
| load generator | order and inventory APIs | places orders (about 10% cancelled), restocks SKUs that run low; scale to 0 to pause |

Because Strimzi writes each KafkaUser's password Secret and the cluster CA Secret into the same
namespace, pods mount them directly with no cross-namespace copying. Ingress is denied by default;
`apps/network-policies.yaml` opens only the paths in the table, and the Kafka listener admits only
the three apps.

Kafka ACLs are least privilege per app: each writes its own topic, reads the other's, writes
dead letters for the topic it consumes, and reads only its own consumer group.

## CI/CD

| Workflow | When | What |
|---|---|---|
| `services` | PRs touching `services/` | build, unit and integration tests (Testcontainers), image build |
| `dashboard` | PRs touching `dashboard/` | typecheck, Jest with coverage, Jest integration tests against Kafka, image build |
| `deploy-lint` | PRs touching `deploy/`, `scripts/`, `.github/` | render every overlay, validate against Kubernetes and CRD schemas, shellcheck, actionlint |
| `e2e` | PRs touching any of the above, and main | `scripts/kind-up.sh` on a fresh kind cluster, so the smoke test runs against the real manifests |
| `jira` | every PR | links the PR to its Jira issue and moves it on the board ([.github/jira](../.github/jira/README.md)) |
| `images` | merge to main | pushes all three images to GHCR tagged with the commit SHA and `latest` |
| `deploy` | after `images` succeeds | applies `overlays/aks` with that SHA, waits, runs the smoke test, rolls back on failure |

## The AKS demo

1. Create the cluster: `infra/aks/main.bicep` (3 nodes; stop it between demos to save cost).
2. `RESOURCE_GROUP=logos-rg CLUSTER=logos-aks KEY_VAULT=<unique name> scripts/aks-bootstrap.sh`
   creates the Key Vault and database passwords, the workload identity External Secrets uses,
   the OIDC identity GitHub Actions deploys as, and installs Strimzi, Envoy Gateway,
   cert-manager and the External Secrets Operator. It prints the repository variables to set.
3. Set those variables, including `AKS_DEPLOY_ENABLED=true`. The next merge to main deploys.
   Optionally add required reviewers to the `aks-demo` environment to approve each deploy.
4. Point `DEMO_HOST` at the gateway's address
   (`kubectl -n logos get gateway logos -o jsonpath='{.status.addresses[0].value}'`); cert-manager
   then issues the certificate. The dashboard is at `https://<DEMO_HOST>/` and the rate-limited
   order API at `https://<DEMO_HOST>/order-api/orders`. The inventory API is not exposed.

Rollback: a failed rollout or smoke test rolls the apps back automatically. To go back to any
earlier commit, run the `deploy` workflow by hand with that commit's SHA.

## Known limits

- PostgreSQL is a single StatefulSet pod. For anything beyond a demo, use Azure Database for
  PostgreSQL or the CloudNativePG operator.
- The order API's rate limit is per gateway proxy (local), not per client; per-client limits
  need Envoy Gateway's global rate limiting and Redis.
- Egress is not restricted.
