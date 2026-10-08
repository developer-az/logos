# Logos

A real-time order and inventory event platform: C# services talking over Kafka, a TypeScript dashboard tested with Jest, deployed to Kubernetes, with work tracked in Jira.

| Path | What |
|---|---|
| [services/](services/README.md) | .NET 10 order and inventory services, Kafka saga, tests |
| [services/docs/events.md](services/docs/events.md) | Event contracts |
| [dashboard/](dashboard/README.md) | TypeScript live dashboard and API over the Kafka events, tested with Jest |
| [deploy/](deploy/README.md) | Kubernetes (Strimzi Kafka, kind and AKS overlays), CI/CD, one-command local cluster |
| [.github/jira/](.github/jira/README.md) | Pull requests linked to Jira issues and moved along the board |

## Live demo

The dashboard has a free, backend-free build that anyone can open in a browser. It runs the
project's own event simulator, contract validation and read model client-side, so the numbers
move like the real thing without Kafka, .NET or Kubernetes. The events are simulated; the full
pipeline is described below.

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/import?s=https%3A%2F%2Fgithub.com%2Fdeveloper-az%2Flogos)

Importing the repo on Vercel needs no settings: [vercel.json](vercel.json) builds `dashboard/`
with `npm run build:demo` and serves it as a static site. Any static host works the same way
(`cd dashboard && npm ci && npm run build:demo`, then publish `packages/web/dist`).

## Run the real stack publicly

[deploy/vm](deploy/vm/README.md) hosts the whole platform (Kafka, the C# services, PostgreSQL,
the dashboard and a load generator placing real orders) on one small Linux VM with HTTPS, set up
by one script. It fits in Oracle Cloud's free tier. [deploy/railway](deploy/railway/README.md) runs the same
stack on Railway with no server to manage (paid, roughly $10 to $15 a month). [deploy/](deploy/README.md) is the
Kubernetes and AKS path.
