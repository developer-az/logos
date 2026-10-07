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

The dashboard has a public, backend-free build that anyone can open in a browser. It runs the
project's own event simulator, contract validation and read model client-side, so the numbers
move like the real thing without Kafka, .NET or Kubernetes. The full pipeline (C# services
publishing to Kafka, the dashboard consuming it, all on AKS) is the [deploy/](deploy/README.md)
path; the demo shows simulated events only.

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/import?s=https%3A%2F%2Fgithub.com%2Fdeveloper-az%2Flogos)

Importing the repo on Vercel needs no settings: [vercel.json](vercel.json) builds
`dashboard/` with `npm run build:demo` and serves it as a static site. Any static host works the
same way (`cd dashboard && npm ci && npm run build:demo`, then publish `packages/web/dist`).
