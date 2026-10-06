# Event contracts

Both services talk only through Kafka. This page is the contract for any other consumer (the live dashboard, analytics).

## Topics

| Topic | Producer | Key | Partitions (default) |
|---|---|---|---|
| `orders.events.v1` | order-service | order id | 3 |
| `inventory.events.v1` | inventory-service | order id, or SKU for `inventory.stock-level-changed` | 3 |
| `<topic>.dlt` | any consumer | original key | 3 |

Keying by order id puts every event of one order on one partition, so consumers see them in the order they were produced. Topics are created at service startup (`Kafka:ProvisionTopics`); broker auto-creation is off in docker-compose.

Kafka headers on every message: `event-id`, `event-type`. Dead-lettered messages also carry `dlt-source-topic`, `dlt-source-partition`, `dlt-source-offset`, `dlt-attempts`, `dlt-error`.

## Envelope

Every message value is UTF-8 JSON (camelCase, enums as camelCase strings):

```json
{
  "eventId": "17f4d206-d3f5-45b6-bf12-cd387e0bd1ed",
  "eventType": "order.placed",
  "schemaVersion": 1,
  "correlationId": "8a95bc1d-459e-4f01-99a9-72ac582549d4",
  "causationId": null,
  "occurredAt": "2026-10-06T05:02:28.1+00:00",
  "payload": { }
}
```

- `eventId` is unique per event; consumers de-duplicate on it (delivery is at-least-once).
- `correlationId` is shared by every event in one order's saga. Clients may set it with the `X-Correlation-Id` header on `POST /orders`.
- `causationId` is the `eventId` of the event that triggered this one (null for events caused by an HTTP request).
- A consumer must ignore `eventType`s it does not know. A breaking payload change gets a new `schemaVersion` (and a `.v2` topic if old consumers cannot cope).

## Events

### orders.events.v1

| eventType | payload |
|---|---|
| `order.placed` | `{ orderId, customerId, lines: [{ sku, quantity, unitPrice }], total }` |
| `order.confirmed` | `{ orderId }` |
| `order.rejected` | `{ orderId, reason }` |
| `order.cancelled` | `{ orderId, reason? }` |

### inventory.events.v1

| eventType | payload |
|---|---|
| `inventory.stock-reserved` | `{ orderId, lines: [{ sku, quantity }] }` |
| `inventory.stock-reservation-failed` | `{ orderId, reason, shortages: [{ sku, requested, available }] }` |
| `inventory.stock-released` | `{ orderId, lines: [{ sku, quantity }] }` |
| `inventory.stock-level-changed` | `{ sku, onHand, reserved, available, version }`: a full snapshot keyed by SKU; `version` rises by 1 on every change to that SKU, so keep the highest you have seen |

## Saga

```
POST /orders ──► order.placed ──► inventory reserves all lines, or none
                                   ├─ inventory.stock-reserved ──────────► order.confirmed
                                   └─ inventory.stock-reservation-failed ► order.rejected
POST /orders/{id}/cancel ──► order.cancelled ──► inventory.stock-released (if stock was held)
```

`inventory.stock-level-changed` follows every reservation, release and manual stock update, so a dashboard can keep a live stock view from that one event type.
