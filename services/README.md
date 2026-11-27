# Order, Inventory, Procurement, Finance & Catalog services

Five .NET 10 services run the platform:

- **Order service** accepts orders over HTTP, prices every line from the catalogue, and confirms or rejects them based on inventory's answer.
- **Inventory service** reserves stock all-or-nothing, releases it on cancellation, publishes live stock levels, and receives goods from procurement.
- **Procurement service** quotes every SKU from three suppliers, raises purchase orders, and publishes the goods receipt when the lead time elapses.
- **Finance service** records each order's amount and standard cost, captures on confirmation, and refunds on a later cancellation.
- **Catalog service** owns shelf prices (and names); the order service charges from it and the dashboard displays it.

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
| Procurement API (Swagger) | http://localhost:5003/swagger |
| Finance API (Swagger) | http://localhost:5004/swagger |
| Catalog API (Swagger) | http://localhost:5005/swagger |
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

# Restock WEBCAM-HD from a supplier, then order it again
curl -s localhost:5003/procurement/suppliers | jq '.[] | select(.sku=="WEBCAM-HD")'
curl -s -X POST localhost:5003/procurement/purchase-orders -H 'Content-Type: application/json' \
  -d '{"sku":"WEBCAM-HD","supplierId":"kiloparts","quantity":12}'
# Compose sets Procurement__DaySeconds=5, so the receipt lands in about 5 seconds.
curl -s localhost:5003/procurement/purchase-orders | jq '.[0] | {status, expectedAt, receivedAt}'
curl -s localhost:5002/inventory/WEBCAM-HD   # onHand rose by 12

# Money: a confirmed order is captured with its standard cost
curl -s localhost:5004/finance/summary
curl -s localhost:5004/finance/settlements/<orderId>

# Prices are the catalogue's, not the client's: the order service charges this
curl -s localhost:5005/catalog
curl -s -X PUT localhost:5005/catalog/MOUSE-01 -H 'Content-Type: application/json' -d '{"priceCents":3100}'
```

## Test it

```bash
dotnet test
```

| Project | What it covers | Needs |
|---|---|---|
| `OrderPlatform.Messaging.Tests` | envelope format, outbox ordering and failure handling, retry and dead-lettering | nothing |
| `Order.Service.Tests` | order rules, saga handler, HTTP API (idempotency, cancel, validation) | nothing (SQLite in memory) |
| `Inventory.Service.Tests` | stock invariants, all-or-nothing reservation, release, out-of-order cancel, goods receipt, idempotent redelivery, optimistic concurrency, HTTP API | nothing |
| `Procurement.Service.Tests` | purchase-order rules, supplier minimums, due receipts published once, quote/order API | nothing (SQLite in memory) |
| `Finance.Service.Tests` | settlement transitions, capture/refund/cancel, duplicate confirmation, summary arithmetic, HTTP API | nothing |
| `Catalog.Service.Tests` | price invariants, seeded catalogue, price changes, validation, unknown SKU | nothing |
| `Order.Service.Tests` (catalogue) | the catalogue price replaces the client's, unknown SKUs are refused, an unreachable catalogue refuses the order | nothing |
| `OrderPlatform.IntegrationTests` | full sagas over real Kafka and PostgreSQL: ordering, overselling, procurement restock through a goods receipt, finance capture and refund, event chain and correlation | Docker (skipped without it) |

## Design

```
src/
  OrderPlatform.Contracts   event records, envelope, topic names (the only shared dependency)
  OrderPlatform.Messaging   outbox, inbox, Kafka producer/consumer, retries, dead-letter topics
  Order.Service             orders API + saga handler, own PostgreSQL database
  Inventory.Service         stock API + reservation and goods-receipt handlers, own PostgreSQL database
  Procurement.Service       supplier quotes + purchase orders + goods receipts, own PostgreSQL database
  Finance.Service           order settlements, captures and refunds, own PostgreSQL database
  Catalog.Service           shelf prices and names, own PostgreSQL database (reference data over HTTP)
```

Decisions and why:

- **Transactional outbox.** A state change and the event describing it are written in one database transaction; a background dispatcher publishes the outbox to Kafka in insertion order. There is no window where the database commits but the event is lost, or the event goes out for a change that rolled back. On PostgreSQL rows are claimed with `FOR UPDATE SKIP LOCKED`, so several replicas can dispatch.
- **At-least-once delivery, idempotent handlers.** Consumers store an offset only after handling, and record each `eventId` in an inbox table in the same transaction as their changes, so a redelivered event is a no-op. The producer is idempotent with `acks=all`.
- **Per-order ordering.** Every saga event is keyed by order id. Inventory also leaves a marker if a cancellation ever arrives before its order, so a late `order.placed` cannot reserve stock for a cancelled order.
- **No overselling.** Stock rows carry an optimistic concurrency token; two reservations racing on the same SKU cannot both commit, and the loser is retried against fresh stock. A database check constraint backs the `0 ≤ reserved ≤ onHand` invariant.
- **Poison messages don't block a partition.** Handlers are retried with exponential backoff (`Kafka:MaxHandlerAttempts`), then the message goes to `<topic>.dlt` with its origin and error in headers.
- **One owner per fact.** Procurement raises a purchase order, but it never writes stock: the goods receipt is an event, and the inventory service applies it to on-hand stock. The receipt's status change and its outbox event commit in one transaction, and the purchase order carries a concurrency token, so two replicas polling at once cannot receive the same order twice. Finance follows the same rule: it reads order outcomes and writes money, never order state.
- **Standard cost, not negotiated cost.** Finance values goods at a standard cost per SKU, so a capture carries its own margin. Procurement's negotiated prices are a purchasing variance, reconciled separately; coupling them would make the ledger depend on which supplier happened to deliver.
- **The catalogue owns prices.** Clients send SKUs and quantities; the order service reads the price from the catalogue and ignores whatever price the client supplied. If the catalogue cannot answer, the order is refused (503) rather than priced from an untrusted number. This is the one synchronous call in the write path, and it buys the only thing that matters there: the price cannot be forged.
- **Choreography, not orchestration.** Each service reacts to the others' topics and publishes its own outcome. With five services this is still simpler than a central orchestrator; that is worth revisiting if shipping joins.

Known simplifications: the catalogue is a plain HTTP service seeded from a demo list, supplier quotes are seeded from a static catalogue rather than integrated with suppliers, standard costs are a fixed table, confirmed reservations are not yet turned into shipments, and there is no authentication.

## Configuration

| Key | Default | Notes |
|---|---|---|
| `ConnectionStrings:Orders` / `ConnectionStrings:Inventory` / `ConnectionStrings:Procurement` / `ConnectionStrings:Finance` / `ConnectionStrings:Catalog` | localhost PostgreSQL, no password | Supply the password outside source control: environment variables (`ConnectionStrings__Orders`), `dotnet user-secrets`, or a Kubernetes Secret |
| `Catalog:BaseUrl` (order service) | empty | set to the catalogue service; when set, client prices are ignored and a failure refuses the order |
| `Kafka:BootstrapServers` | `localhost:9092` | |
| `Kafka:GroupId` | `order-service` / `inventory-service` / `procurement-service` / `finance-service` | |
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
| `Procurement:SeedDemoData` | false (true in compose) | publishes the demo catalogue's quotes on startup |
| `Procurement:DaySeconds` | 86400 | one supplier day; compose sets 5 so a receipt can be watched |
| `Catalog:SeedDemoData` | false (true in compose) | publishes the demo products on first start |

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

Schema changes: `dotnet tool restore && dotnet ef migrations add <Name> -p src/<Service> -o Data/Migrations`.
