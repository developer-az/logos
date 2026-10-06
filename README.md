# Logos

A real-time order and inventory event platform: C# services talking over Kafka, a TypeScript dashboard tested with Jest, deployed to Kubernetes, with work tracked in Jira.

| Path | What |
|---|---|
| [services/](services/README.md) | .NET 10 order and inventory services, Kafka saga, tests |
| [services/docs/events.md](services/docs/events.md) | Event contracts |
| [dashboard/](dashboard/README.md) | TypeScript live dashboard and API over the Kafka events, tested with Jest |
| [deploy/](deploy/README.md) | Kubernetes (Strimzi Kafka, kind and AKS overlays), CI/CD, one-command local cluster |
| [.github/jira/](.github/jira/README.md) | Pull requests linked to Jira issues and moved along the board |
