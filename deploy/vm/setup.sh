#!/usr/bin/env bash
# Puts the whole platform on a fresh Ubuntu or Debian VM, public over HTTPS.
#
#   git clone https://github.com/developer-az/logos && sudo logos/deploy/vm/setup.sh
#   sudo logos/deploy/vm/setup.sh demo.example.com   # with your own domain (DNS A record first)
#
# Without a domain the site is served at https://<public-ip>.sslip.io, a free wildcard DNS name
# that resolves to the IP, so Let's Encrypt can issue a certificate with no DNS setup.
# Safe to re-run: it keeps the existing .env and rebuilds whatever changed.
set -euo pipefail

cd "$(dirname "$0")"
[[ $EUID -eq 0 ]] || { echo "run with sudo" >&2; exit 1; }

if ! command -v docker >/dev/null 2>&1; then
  echo "installing Docker"
  curl -fsSL https://get.docker.com | sh
fi

# Building the .NET images needs about 2 GB; give small VMs swap so the build doesn't get killed.
mem_kb=$(awk '/MemTotal/ {print $2}' /proc/meminfo)
if (( mem_kb < 3500000 )) && ! swapon --show | grep -q .; then
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
  site=${1:-}
  if [[ -z $site ]]; then
    ip=$(curl -fsS https://checkip.amazonaws.com | tr -d '[:space:]')
    site="$ip.sslip.io"
  fi
  umask 077
  cat > .env <<EOF
# Written by setup.sh. Not committed (deploy/vm/.gitignore).
POSTGRES_PASSWORD=$(openssl rand -hex 24)
SITE_ADDRESS=$site
# Seconds between orders from the load generator.
LOAD_INTERVAL_SECONDS=2
EOF
fi

docker compose up -d --build
site=$(sed -n 's/^SITE_ADDRESS=//p' .env)
echo
echo "Up. https://$site (the certificate can take a minute on first start)"
echo "Logs: cd $(pwd) && docker compose logs -f"
