# The full platform on one VM

The real stack, public over HTTPS, on one small Linux VM: Kafka, PostgreSQL, the order and
inventory services (.NET), the dashboard, a load generator placing real orders through the order
API, and Caddy in front with a Let's Encrypt certificate. Every event on the dashboard comes out
of the C# saga over Kafka.

```bash
# On a fresh Ubuntu 22.04/24.04 or Debian 12 VM, with ports 80 and 443 open to the internet:
git clone https://github.com/developer-az/logos
sudo logos/deploy/vm/setup.sh                    # https://<public-ip>.sslip.io
sudo logos/deploy/vm/setup.sh demo.example.com   # or your own domain (point its A record first)
```

`setup.sh` installs Docker, adds swap on small machines, opens 80/443 in the host firewall,
writes `.env` with a random database password, then builds and starts everything with
`compose.yaml`. The first build takes a few minutes. To update after a merge:

```bash
cd logos && git pull && cd deploy/vm && sudo docker compose up -d --build
```

## Which host

Measured on this compose file with the load generator running: about 700 MB of RAM in steady
state (Kafka about 350 MB, each .NET service about 120 MB). Building the images needs more, so a
2 GB VM works with the swap `setup.sh` adds, and 4 GB is comfortable. Images are built on the VM,
so x86 and Arm hosts both work.

| Option | Cost | Notes |
|---|---|---|
| **Oracle Cloud Always Free, Ampere A1 (Arm)** | $0 | Recommended to start. The Always Free allowance is 2 OCPU and 12 GB since June 2026, plenty for this. Open 80/443 in the VCN security list as well; `setup.sh` handles the instance's own iptables rules. Free-tier capacity can be scarce in popular regions. |
| Any 2 to 4 GB VM (DigitalOcean, Vultr, Linode, Azure, Hetzner, ...) | a monthly fee, check current pricing | Same steps. Student credits (GitHub Student Developer Pack, Azure for Students) usually cover it for months. Hetzner's cheapest cloud tiers have shown "currently not available" since August 2026. |
| Managed pieces: Render or Railway for three services, Aiven free Kafka, managed Postgres | several paid services | Aiven's free Kafka allows 5 topics with 2 partitions (enough: 2 topics plus 2 dead-letter topics) but powers off when idle, and free web tiers sleep, which stops Kafka consumers. More accounts, more moving parts, and it costs more than one VM. |
| AKS ([deploy/](../README.md#the-aks-demo)) | the most: 3 nodes plus a load balancer | Production shape: 3 Kafka brokers with TLS and SCRAM, 2 replicas each, secrets from Key Vault, automated deploys from CI. Best kept for when that matters; stop the cluster between demos. |

## Step by step on Oracle Cloud (free)

1. Sign up at [cloud.oracle.com](https://cloud.oracle.com/) (a card is asked for verification;
   Always Free resources aren't charged).
2. **Compute > Instances > Create instance.** Image: Canonical Ubuntu 24.04. Shape: Ampere,
   `VM.Standard.A1.Flex`, 2 OCPU and 12 GB. Keep "Assign a public IPv4 address" on, add your SSH
   public key, create. If it says out of capacity, try another availability domain or later.
3. **Open the web ports.** On the instance page, open the subnet, then its security list, and
   add two ingress rules: source `0.0.0.0/0`, TCP, destination port `80`, and the same for `443`.
4. **Install.** `ssh ubuntu@<public-ip>`, then:
   ```bash
   git clone https://github.com/developer-az/logos
   sudo logos/deploy/vm/setup.sh
   ```
   When it finishes it prints `https://<public-ip>.sslip.io`. That's the public link.
5. Optional: with your own domain, add an A record pointing at the IP, set
   `SITE_ADDRESS=your.domain` in `logos/deploy/vm/.env` (keep the password, the database was
   created with it), and run `sudo docker compose up -d` in `logos/deploy/vm`.

## Differences from the Kubernetes deployment

Built for one cheap machine, so some production features are traded away on purpose:

- One Kafka broker on a private Docker network, plaintext with no SASL. Nothing but Caddy
  publishes a port, so Kafka, Postgres and the APIs are not reachable from the internet. AKS runs
  three brokers with TLS, SCRAM users and per-app ACLs.
- One replica of everything and no automatic rollback. Docker restarts crashed containers.
- The services use the Postgres superuser rather than a role each.
- Only the dashboard is public. The order API isn't exposed because Caddy has no built-in rate
  limiting; the AKS gateway exposes it rate-limited at `/order-api`.

## Operating it

```bash
cd logos/deploy/vm
sudo docker compose ps                     # health
sudo docker compose logs -f dashboard      # follow one service
sudo docker compose stop load-generator    # pause traffic (start to resume)
sudo docker compose down                   # stop; data stays in the named volumes
sudo docker compose down -v                # stop and delete all data
```

`load-generator.sh` is a copy of the script in `deploy/k8s/apps/load-generator.yaml`; change
both together.
