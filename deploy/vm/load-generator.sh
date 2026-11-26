#!/bin/sh
# Copy of the script in deploy/k8s/apps/load-generator.yaml (change both together).
set -u
ORDER_API=${ORDER_API:-http://order-service}
INVENTORY_API=${INVENTORY_API:-http://inventory-service}
# Empty when the deployment has no procurement service (the 1 GB free tier runs two topics).
PROCUREMENT_API=${PROCUREMENT_API:-}
INTERVAL=${INTERVAL_SECONDS:-1}
CANCEL_PERCENT=${CANCEL_PERCENT:-10}
RESTOCK_BELOW=${RESTOCK_BELOW:-10}
# sku:price; WEBCAM-HD is never restocked so some orders are rejected for lack of stock.
CATALOG="KEYBOARD-01:89.00 MOUSE-01:29.50 MONITOR-27:299.00 USB-C-HUB:45.00 WEBCAM-HD:59.00"

rnd() { echo $(( $(od -An -N2 -tu2 /dev/urandom) % $1 )); }
# shellcheck disable=SC2086 # split the catalog into positional parameters
pick() { set -- $CATALOG; shift "$(rnd $#)"; echo "$1"; }
field() { sed -n "s/.*\"$1\":\([0-9-]*\).*/\1/p"; }

restock() {
  for entry in $CATALOG; do
    sku=${entry%%:*}
    [ "$sku" = WEBCAM-HD ] && continue
    available=$(curl -sf "$INVENTORY_API/inventory/$sku" | field available) || available=0
    if [ -z "$available" ]; then available=0; fi
    if [ "$available" -lt "$RESTOCK_BELOW" ]; then
      if [ -n "$PROCUREMENT_API" ]; then
        # Kilo Parts: lowest minimum, shortest lead time in the demo.
        curl -sf -o /dev/null -X POST "$PROCUREMENT_API/procurement/purchase-orders" \
          -H 'Content-Type: application/json' \
          -d "{\"sku\":\"$sku\",\"supplierId\":\"kiloparts\",\"quantity\":50}" \
          && echo "ordered $sku from kiloparts"
      else
        # No procurement service here: write the level directly, as a manual stock count.
        on_hand=$(curl -sf "$INVENTORY_API/inventory/$sku" | field onHand)
        if [ -z "$on_hand" ]; then on_hand=0; fi
        curl -sf -o /dev/null -X PUT "$INVENTORY_API/inventory/$sku" -H 'Content-Type: application/json' \
          -d "{\"onHand\":$((on_hand + 50))}" && echo "restocked $sku"
      fi
    fi
  done
}

until curl -sf -o /dev/null "$ORDER_API/health/ready" \
  && curl -sf -o /dev/null "$INVENTORY_API/health/ready" \
  && { [ -z "$PROCUREMENT_API" ] || curl -sf -o /dev/null "$PROCUREMENT_API/health/ready"; }; do
  echo "waiting for the APIs"; sleep 2
done
# Create WEBCAM-HD at zero stock once, so its orders are rejected rather than unknown.
curl -sf -o /dev/null "$INVENTORY_API/inventory/WEBCAM-HD" || curl -sf -o /dev/null -X PUT \
  "$INVENTORY_API/inventory/WEBCAM-HD" -H 'Content-Type: application/json' -d '{"onHand":0}'

n=0
while true; do
  [ $((n % 20)) -eq 0 ] && restock
  n=$((n + 1))
  lines=""
  for _ in $(seq $((1 + $(rnd 2)))); do
    item=$(pick)
    lines="$lines{\"sku\":\"${item%%:*}\",\"quantity\":$((1 + $(rnd 3))),\"unitPrice\":${item#*:}},"
  done
  response=$(curl -sf -X POST "$ORDER_API/orders" -H 'Content-Type: application/json' \
    -H "Idempotency-Key: loadgen-$(hostname)-$n-$(date +%s)" \
    -d "{\"customerId\":\"c-$(rnd 500)\",\"lines\":[${lines%,}]}") || { echo "place failed"; sleep "$INTERVAL"; continue; }
  id=$(echo "$response" | sed -n 's/.*"id":"\([0-9a-f-]*\)".*/\1/p')
  if [ -n "$id" ] && [ "$(rnd 100)" -lt "$CANCEL_PERCENT" ]; then
    sleep 1
    curl -sf -o /dev/null -X POST "$ORDER_API/orders/$id/cancel" -H 'Content-Type: application/json' \
      -d '{"reason":"customer changed their mind"}'
  fi
  sleep "$INTERVAL"
done
