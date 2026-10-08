# The full platform on Railway

The real stack on [Railway](https://railway.com), built from this repository: Kafka, PostgreSQL,
the order and inventory services (.NET), the dashboard and the load generator. They talk over
Railway's private network, and only the dashboard gets a public URL. Every push to `main`
redeploys.

Cost: Railway bills by usage (about $10 per GB of RAM and $20 per vCPU per month, see
[railway.com/pricing](https://railway.com/pricing)). This stack sits around 1 GB of RAM at low
CPU, so expect roughly $10 to $15 a month on the Hobby plan ($5, which includes $5 of usage).

## Services

Create them in this order. Each name matters, because the others reach it at
`<name>.railway.internal`.

| Service | Source | Settings | Variables |
|---|---|---|---|
| `kafka` | GitHub repo | Volume mounted at `/var/lib/kafka/data` | `RAILWAY_DOCKERFILE_PATH=deploy/railway/kafka.Dockerfile` |
| `Postgres` | Database → PostgreSQL | none | (Railway sets them) |
| `order-service` | GitHub repo | Root directory `services` | see below |
| `inventory-service` | GitHub repo | Root directory `services` | see below |
| `dashboard` | GitHub repo | Root directory `dashboard`, public domain on port 8080 | see below |
| `load-generator` | GitHub repo | none | see below |

**order-service**
```
SERVICE=Order.Service
ConnectionStrings__Orders=Host=${{Postgres.PGHOST}};Port=${{Postgres.PGPORT}};Username=${{Postgres.PGUSER}};Password=${{Postgres.PGPASSWORD}};Database=orders
Kafka__BootstrapServers=kafka.railway.internal:9092
```

**inventory-service**
```
SERVICE=Inventory.Service
ConnectionStrings__Inventory=Host=${{Postgres.PGHOST}};Port=${{Postgres.PGPORT}};Username=${{Postgres.PGUSER}};Password=${{Postgres.PGPASSWORD}};Database=inventory
Kafka__BootstrapServers=kafka.railway.internal:9092
```

**dashboard**
```
KAFKA_BROKERS=kafka.railway.internal:9092
PORT=8080
LOW_STOCK_THRESHOLD=5
```

**load-generator**
```
RAILWAY_DOCKERFILE_PATH=deploy/railway/load-generator.Dockerfile
ORDER_API=http://order-service.railway.internal:8080
INVENTORY_API=http://inventory-service.railway.internal:8080
INTERVAL_SECONDS=2
```

## Step by step

1. Sign in at [railway.com](https://railway.com) with GitHub. **New Project → Deploy from GitHub
   repo → developer-az/logos**. Allow Railway access to the repo if it asks.
2. That creates one service. Open it, rename it `kafka` (Settings → Service name), add the
   `kafka` variable from the table, and add a volume (right-click the service, or ⌘K →
   "Volume") mounted at `/var/lib/kafka/data`.
3. **+ Create → Database → PostgreSQL.** Leave its name as `Postgres`.
4. **+ Create → GitHub Repo → developer-az/logos** four more times, for `order-service`,
   `inventory-service`, `dashboard` and `load-generator`. For each, set the name, the root
   directory where the table lists one, and paste its variables (Variables → Raw editor).
5. Dashboard → Settings → Networking → **Generate Domain**, target port `8080`. That URL is the
   public site.
6. Click **Deploy** (Railway stages changes until you do). The first build takes a few minutes.
   The dashboard shows "Catching up" until the services have created the topics, then orders
   start arriving.

## Notes

- `SERVICE` is passed to `services/Dockerfile` as a build argument, which is how one Dockerfile
  builds either .NET service.
- The services create their `orders` and `inventory` databases on first start (EF Core
  migrations), so the one Postgres needs no setup. A single "database does not exist" log line
  on first start is expected.
- Kafka is a single plaintext broker reachable only on the private network, as in
  [deploy/vm](../vm/README.md). Its listeners bind the wildcard address, which covers Railway's
  IPv6 private network.
- Tested with Docker using the same service names, variables and start order, including the
  dashboard starting before Kafka has topics. Not yet run on Railway itself.
