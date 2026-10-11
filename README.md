# Logos

A real-time order and inventory event platform: C# services talking over Kafka, a TypeScript dashboard tested with Jest, deployed to Kubernetes, with work tracked in Jira.

| Path | What |
|---|---|
| [services/](services/README.md) | .NET 10 order and inventory services, Kafka saga, tests |
| [services/docs/events.md](services/docs/events.md) | Event contracts |
| [dashboard/](dashboard/README.md) | TypeScript live dashboard and API over the Kafka events, tested with Jest |
| [deploy/](deploy/README.md) | Kubernetes (Strimzi Kafka, kind and AKS overlays), CI/CD, one-command local cluster |
| [.github/jira/](.github/jira/README.md) | Pull requests linked to Jira issues and moved along the board |

![The dashboard reading the real C# services through Kafka, with one order's saga traced](dashboard/docs/dashboard-desktop.png)

## Live demo

The dashboard on Vercel shows the platform working: KPIs, the architecture with live per-topic
rates, every order's saga traced across both Kafka topics, and the raw event stream.

- **Live mode.** With a backend configured, every number comes from the C# services through
  Kafka. [deploy/free](deploy/free/README.md) runs that backend for $0: an Oracle Always Free
  micro VM for the services and Postgres, and Aiven's free managed Kafka.
- **Fallback.** If the backend can't be reached, the page switches to the project's own
  simulator in the browser within seconds (same contract validation and read model) and says so,
  so the link always works.

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/import?s=https%3A%2F%2Fgithub.com%2Fdeveloper-az%2Flogos)

Importing the repo on Vercel needs no settings: [vercel.json](vercel.json) builds `dashboard/`
with `npm run build:demo`. Add the environment variable `VITE_API_URL` (the backend's HTTPS
address) and redeploy to go live.

## What it demonstrates

| Problem | How logos handles it | Where it's proven |
|---|---|---|
| Lost or phantom events when a DB write and a Kafka publish disagree | Transactional outbox, published in order by a dispatcher (`FOR UPDATE SKIP LOCKED`) | `OrderPlatform.Messaging.Tests` |
| Duplicates from at-least-once delivery | Inbox table per service, `eventId` dedupe in the read model | unit tests, integration test redelivers |
| Overselling under concurrency | Optimistic concurrency on stock rows plus a check constraint | 25 concurrent orders for 10 units against real Kafka and Postgres |
| Poison messages blocking a partition | Retries with backoff, then `<topic>.dlt` with origin and error headers | Messaging tests, dashboard integration test |
| Out-of-order and replayed events | Saga transitions only move forward; stock keeps the highest per-SKU version | property-style projection tests |
| Seeing what happened to one order | Saga trace across both topics, with the time each step took | the dashboard, live |

## Run the real stack publicly

- [deploy/free](deploy/free/README.md): $0, for the Vercel page to read from (1 GB VM plus
  managed Kafka).
- [deploy/vm](deploy/vm/README.md): everything, Kafka included, on one 2 to 4 GB VM with HTTPS,
  set up by one script.
- [deploy/railway](deploy/railway/README.md): no server to manage (paid, roughly $10 to $15 a
  month).
- [deploy/](deploy/README.md): Kubernetes, kind locally and AKS in production shape.
