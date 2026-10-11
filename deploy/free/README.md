# The real platform for $0

The public site stays on Vercel. Behind it, the real pipeline runs on two free tiers:

```
Vercel (static page) ──HTTPS, live stream──▶ Oracle Always Free micro VM (1 GB)
                                               Caddy ─ dashboard read model (Node)
                                               order-service, inventory-service (.NET 10)
                                               PostgreSQL, load generator
                                                      │ TLS, client certificate
                                                      ▼
                                             Aiven free Kafka (managed)
                                               orders.events.v1, inventory.events.v1, + .dlt
```

Every number on the page then comes from the C# saga over Kafka. When the backend can't be
reached (maintenance, quota, a reboot), the page switches to the in-browser simulator within a
few seconds and says so, so the link never shows a broken page.

Measured with this compose file against a TLS Kafka with client certificates, one order a second:
about 320 MB of RAM for everything on the VM (each .NET service ~115 MB, Postgres ~45 MB, the
dashboard ~35 MB, Caddy ~15 MB).

## Why these two

Checked against each provider's published free-tier terms in October 2026.

| Need | Picked | Why not the others |
|---|---|---|
| Kafka | **Aiven free Kafka**: no card, 5 topics of 2 partitions, 250 KiB/s | The platform needs 4 topics (2 plus 2 dead-letter) and about 1 KiB/s. Aiven powers a free service off after 24 hours without traffic; the load generator keeps it busy. Self-hosting Kafka needs ~350 MB more RAM than the micro VM has spare. |
| Services, Postgres | **Oracle Always Free `VM.Standard.E2.1.Micro`**: 1 GB RAM, 1/8 OCPU, 10 TB egress a month | The two AMD micro VMs are a separate allowance from the Ampere A1 one the Minecraft server uses. GCP's free e2-micro allows only 1 GB of internet egress a month, and the produce traffic to Kafka alone is around 1.5 GB (an estimate). Render's free tier sleeps, which stops Kafka consumers. Neon's free Postgres has 100 compute-hours a month, and the outbox polls every 250 ms so the database never idles: 0.25 CU × 730 h = 182. Railway and Fly have no free tier. |
| Public page | **Vercel** (already deployed) | |

Known limits, so nothing surprises you later:

- **No SLA on either.** Aiven says it may change free-tier regions or configuration. If either
  goes away, the page falls back to simulation by itself.
- **Oracle reclaims idle Always Free VMs**: one whose CPU, network and memory all stay under 20%
  (95th percentile) for 7 days. The steady order traffic keeps this one working; check the
  instance's CPU graph after the first week.
- **1/8 of a CPU** makes the first start slow (a minute or two for the .NET services). After that
  the load is light.

## Step by step

### 1. Kafka on Aiven

1. Sign up at [console.aiven.io](https://console.aiven.io/signup). No card is needed.
2. **Create service** → **Apache Kafka** → plan **Free** → pick the region closest to your Oracle
   home region (US East for Ashburn) → name it `logos-kafka` → **Create service**.
3. Wait until the status is **Running**. On the service's **Overview** page, under connection
   information (or **Quick connect**), note the **Service URI**, which looks like
   `logos-kafka-yourname.a.aivencloud.com:12345`, and download the three files:
   **Access key** (`service.key`), **Access certificate** (`service.cert`) and **CA certificate**
   (`ca.pem`).
4. Open **Topics** → **Create topic** four times, with **2 partitions** each:
   `orders.events.v1`, `inventory.events.v1`, `orders.events.v1.dlt`, `inventory.events.v1.dlt`.

### 2. The VM on Oracle Cloud

1. In the Oracle console: **Compute** → **Instances** → **Create instance**.
2. **Image**: Canonical Ubuntu 24.04 (the x86 one, not "aarch64").
   **Shape**: **Change shape** → **Specialty and previous generation** → `VM.Standard.E2.1.Micro`
   (marked "Always Free-eligible"). It has to be in your home region.
3. Keep **Assign a public IPv4 address** on, add your SSH public key, **Create**.
4. **Open the web ports.** On the instance page open the subnet, then its security list, and add
   two ingress rules: source `0.0.0.0/0`, TCP, destination port `80`, and the same for `443`.
5. From your computer, in the folder with the three Aiven files:
   ```bash
   ssh ubuntu@<public-ip> 'git clone https://github.com/developer-az/logos && mkdir logos/deploy/free/kafka'
   scp ca.pem service.cert service.key ubuntu@<public-ip>:logos/deploy/free/kafka/
   ssh ubuntu@<public-ip> 'sudo logos/deploy/free/setup.sh logos-kafka-yourname.a.aivencloud.com:12345'
   ```
   It prints the backend's address, `https://<public-ip>.sslip.io`. Opening it shows the live
   dashboard straight from the VM.

### 3. Point Vercel at it

In the Vercel project: **Settings** → **Environment Variables** → add `VITE_API_URL` with the
value `https://<public-ip>.sslip.io` → **Save**. Then **Deployments** → the latest one → **⋯** →
**Redeploy**. The page now says "Live" and shows real orders. Without the variable it simulates,
exactly as before.

To allow only your site to read the stream, set `CORS_ORIGINS=https://your-site.vercel.app` in
`deploy/free/.env` on the VM and run `sudo docker compose up -d` there. The default `*` is fine
for a read-only public dashboard.

## Operating it

```bash
cd logos/deploy/free
sudo docker compose ps                          # health
sudo docker compose logs -f order-service       # follow one service
sudo docker compose pull && sudo docker compose up -d   # update to the images from main
sudo docker compose stop load-generator         # pause traffic (Aiven powers off after 24 h idle)
```

Images come from GHCR, built by `.github/workflows/images.yml` on every merge to main, so the VM
never compiles anything. `IMAGE_TAG=<commit sha>` in `.env` pins a version.

If the dashboard ever runs out of memory after weeks of uptime (its read model keeps every order
it has seen), Docker restarts it and it rebuilds from what Kafka still retains.

Have a bigger free VM, such as the Ampere A1 one? [deploy/vm](../vm/README.md) runs everything,
Kafka included, on one machine.
