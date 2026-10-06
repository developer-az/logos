# Order & Inventory event services

Two .NET 10 services that run an order saga over Kafka:

- **Order service** accepts orders over HTTP and confirms or rejects them based on inventory's answer.
- **Inventory service** reserves stock all-or-nothing, releases it on cancellation, and publishes live stock levels.

Event contracts for other consumers: [docs/events.md](docs/events.md).

## Run it

```bash
cp .env.example .env    # set POSTGRES_PASSWORD to any local-only value
docker compose up --build
```

| | URL |
|---|---|
| Order API (Swagger) | http://localhost:5001/swagger |
| Inventory API (Swagger) | http://localhost:5002/swagger |
| Kafka UI | http://localhost:8085 |
| Kafka from the host | `localhost:9094` |

Inventory is seeded with demo SKUs (`KEYBOARD-01`, `MOUSE-01`, `MONITOR-27`, `USB-C-HUB`, and `WEBCAM-HD` at zero stock).

```bash
# Confirmed: stock is available
curl -s -X POST localhost:5001/orders -H 'Content-Type: application/json' -H 'Idempotency-Key: demo-1' \
  -d '{"customerId":"c-1","lines":[{"sku":"MONITOR-27","quantity":2,"unitPrice":299.00}]}'

# Rejected: WEBCAM-HD has no stock
curl -s -X POST localhost:5001/orders -H 'Content-Type: application/json' \
  -d '{"customerId":"c-1","lines":[{"sku":"WEBCAM-HD","quantity":1,"unitPrice":59}]}'

curl -s localhost:5001/orders/<id>          # Pending, then Confirmed or Rejected
curl -s -X POST localhost:5001/orders/<id>/cancel -H 'Content-Type: application/json' -d '{}'
curl -s -X PUT localhost:5002/inventory/MOUSE-01 -H 'Content-Type: application/json' -d '{"onHand":200}'
```

## Test it

```bash
dotnet test
```

| Project | What it covers | Needs |
|---|---|---|
| `OrderPlatform.Messaging.Tests` | envelope format, outbox ordering and failure handling, retry and dead-lettering | nothing |
| `Order.Service.Tests` | order rules, saga handler, HTTP API (idempotency, cancel, validation) | nothing (SQLite in memory) |
| `Inventory.Service.Tests` | stock invariants, all-or-nothing reservation, release, out-of-order cancel, optimistic concurrency, HTTP API | nothing |
| `OrderPlatform.IntegrationTests` | full saga over real Kafka and PostgreSQL, event chain and correlation, 25 concurrent orders for 10 units | Docker (skipped without it) |

## Design

```
src/
  OrderPlatform.Contracts   event records, envelope, topic names (the only shared dependency)
  OrderPlatform.Messaging   outbox, inbox, Kafka producer/consumer, retries, dead-letter topics
  Order.Service             orders API + saga handler, own PostgreSQL database
  Inventory.Service         stock API + reservation handler, own PostgreSQL database
```

Decisions and why:

- **Transactional outbox.** A state change and the event describing it are written in one database transaction; a background dispatcher publishes the outbox to Kafka in insertion order. There is no window where the database commits but the event is lost, or the event goes out for a change that rolled back. On PostgreSQL rows are claimed with `FOR UPDATE SKIP LOCKED`, so several replicas can dispatch.
- **At-least-once delivery, idempotent handlers.** Consumers store an offset only after handling, and record each `eventId` in an inbox table in the same transaction as their changes, so a redelivered event is a no-op. The producer is idempotent with `acks=all`.
- **Per-order ordering.** Every saga event is keyed by order id. Inventory also leaves a marker if a cancellation ever arrives before its order, so a late `order.placed` cannot reserve stock for a cancelled order.
- **No overselling.** Stock rows carry an optimistic concurrency token; two reservations racing on the same SKU cannot both commit, and the loser is retried against fresh stock. A database check constraint backs the `0 ≤ reserved ≤ onHand` invariant.
- **Poison messages don't block a partition.** Handlers are retried with exponential backoff (`Kafka:MaxHandlerAttempts`), then the message goes to `<topic>.dlt` with its origin and error in headers.
- **Choreography, not orchestration.** With two participants, each service reacting to the other's events is simpler than a central orchestrator; that choice is worth revisiting if payment or shipping joins the saga.

Known simplifications: the client supplies unit prices (a catalog service would own them), confirmed reservations are not yet turned into shipments, and there is no authentication.

## Configuration

| Key | Default | Notes |
|---|---|---|
| `ConnectionStrings:Orders` / `ConnectionStrings:Inventory` | localhost PostgreSQL, no password | Supply the password outside source control: environment variables (`ConnectionStrings__Orders`), `dotnet user-secrets`, or a Kubernetes Secret |
| `Kafka:BootstrapServers` | `localhost:9092` | |
| `Kafka:GroupId` | `order-service` / `inventory-service` | |
| `Kafka:SecurityProtocol` | `Plaintext` | `SaslSsl` in Kubernetes (Strimzi TLS listener) |
| `Kafka:SaslMechanism` | `ScramSha512` | |
| `Kafka:SaslUsername`, `Kafka:SaslPassword` | none | the service's KafkaUser and its Secret; never commit the password |
| `Kafka:SslCaLocation` | none | PEM of the cluster CA (Strimzi `<cluster>-cluster-ca-cert`, key `ca.crt`) |
| `Kafka:ProvisionTopics` | true | set `false` where Strimzi KafkaTopic resources own the topics |
| `Kafka:TopicPartitions`, `Kafka:ReplicationFactor` | 3, 1 | used only when provisioning topics |
| `Kafka:MaxHandlerAttempts`, `Kafka:InitialRetryDelay` | 5, 200 ms | |
| `Kafka:OutboxPollInterval`, `Kafka:OutboxBatchSize` | 250 ms, 100 | |
| `Database:MigrateOnStartup` | true | applies EF Core migrations |
| `Inventory:SeedDemoData` | false (true in compose) | |

In-cluster example (environment variables on the Deployment, password from a Secret):

```yaml
- { name: Kafka__BootstrapServers, value: logos-kafka-kafka-bootstrap.kafka:9093 }
- { name: Kafka__SecurityProtocol, value: SaslSsl }
- { name: Kafka__SaslUsername, value: order-service }
- name: Kafka__SaslPassword
  valueFrom: { secretKeyRef: { name: order-service, key: password } }
- { name: Kafka__SslCaLocation, value: /etc/kafka-ca/ca.crt }
- { name: Kafka__ProvisionTopics, value: "false" }
```

Health probes for Kubernetes: `/health/live` and `/health/ready` (checks the database).

Schema changes: `dotnet tool restore && dotnet ef migrations add <Name> -p src/Order.Service -o Data/Migrations`.
