#!/usr/bin/env bash
# Runs the real platform on a free 1 GB VM against Aiven's free Kafka. See README.md first: the
# Kafka certificates have to be in deploy/free/kafka/ before this runs.
#
#   sudo logos/deploy/free/setup.sh <aiven-host:port>
#   sudo logos/deploy/free/setup.sh <aiven-host:port> demo.example.com   # with your own domain
#
# Without a domain the backend is served at https://<public-ip>.sslip.io. Safe to re-run: it
# keeps the existing .env, pulls newer images and restarts whatever changed.
set -euo pipefail

cd "$(dirname "$0")"
[[ $EUID -eq 0 ]] || { echo "run with sudo" >&2; exit 1; }

for f in ca.pem service.cert service.key; do
  [[ -s kafka/$f ]] || { echo "missing deploy/free/kafka/$f (download it from the Aiven console, see README.md)" >&2; exit 1; }
done
# The services run as non-root users in their containers and need to read these. Nothing else
# runs on this VM, and the directory is git-ignored.
chmod 755 kafka && chmod 644 kafka/*

if ! command -v docker >/dev/null 2>&1; then
  echo "installing Docker"
  curl -fsSL https://get.docker.com | sh
fi

# 1 GB of RAM runs the stack, but pulls and restarts spike; swap absorbs that instead of the
# kernel killing a service.
if ! swapon --show | grep -q .; then
  echo "adding a 2 GB swap file"
  fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile >/dev/null && swapon /swapfile
  grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

# Open 80/443 in the host firewall. Oracle Cloud's Ubuntu images ship iptables rules that reject
# everything but SSH; ufw is the usual case elsewhere. (Cloud firewalls are set in the console.)
if command -v ufw >/dev/null 2>&1 && ufw status | grep -q 'Status: active'; then
  ufw allow 80/tcp && ufw allow 443/tcp && ufw allow 443/udp
elif iptables -S INPUT 2>/dev/null | grep -q -- '-j REJECT'; then
  for port in 80 443; do
    iptables -C INPUT -p tcp --dport "$port" -j ACCEPT 2>/dev/null ||
      iptables -I INPUT 5 -p tcp --dport "$port" -m state --state NEW -j ACCEPT
  done
  command -v netfilter-persistent >/dev/null 2>&1 && netfilter-persistent save
fi

if [[ ! -f .env ]]; then
  bootstrap=${1:?usage: setup.sh <aiven-host:port> [domain]}
  site=${2:-}
  if [[ -z $site ]]; then
    ip=$(curl -fsS https://checkip.amazonaws.com | tr -d '[:space:]')
    site="$ip.sslip.io"
  fi
  umask 077
  cat > .env <<ENV
# Written by setup.sh. Not committed (deploy/free/.gitignore).
POSTGRES_PASSWORD=$(openssl rand -hex 24)
SITE_ADDRESS=$site
KAFKA_BOOTSTRAP=$bootstrap
# Browser origins allowed to read the live stream: * or your Vercel URL(s), comma-separated.
CORS_ORIGINS=*
# Seconds between orders. Aiven's free tier allows 250 KiB/s; one order every 5 s is ~1 KiB/s.
LOAD_INTERVAL_SECONDS=5
ENV
fi

docker compose pull --quiet
docker compose up -d
site=$(sed -n 's/^SITE_ADDRESS=//p' .env)
echo
echo "Up. Backend: https://$site (the certificate can take a minute on first start)"
echo "Point the Vercel site at it: Settings > Environment Variables, VITE_API_URL=https://$site, then redeploy."
echo "Logs: cd $(pwd) && docker compose logs -f"
