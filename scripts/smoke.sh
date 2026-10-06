#!/usr/bin/env bash
# End-to-end check against a running cluster: drives the order saga through the real APIs and
# Kafka, then checks the dashboard saw it. Uses its own SKU, so the load generator can keep running.
#
#   scripts/smoke.sh                       # current kubectl context, namespace "logos"
#   WITH_DASHBOARD=false scripts/smoke.sh  # services only
#   ORDER_URL=http://localhost:5001 INVENTORY_URL=http://localhost:5002 \
#     WITH_DASHBOARD=false scripts/smoke.sh  # against docker compose, no port-forwarding
set -euo pipefail

NAMESPACE=${NAMESPACE:-logos}
WITH_DASHBOARD=${WITH_DASHBOARD:-true}
TIMEOUT=${SMOKE_TIMEOUT_SECONDS:-120}

pids=()
cleanup() { for p in "${pids[@]}"; do kill "$p" 2>/dev/null || true; done; }
trap cleanup EXIT
# endpoint <variable> <service> <local port> <url override>: sets the variable to the service's
# base URL, port-forwarding to it unless an override is given.
endpoint() {
  local url=$4
  if [[ -z $url ]]; then
    kubectl -n "$NAMESPACE" port-forward "svc/$2" "$3:80" >/dev/null 2>&1 &
    pids+=($!)
    url=http://127.0.0.1:$3
  fi
  printf -v "$1" '%s' "$url"
}
endpoint ORDER order-service 18081 "${ORDER_URL:-}"
endpoint INVENTORY inventory-service 18082 "${INVENTORY_URL:-}"
[[ $WITH_DASHBOARD == true ]] && endpoint DASHBOARD dashboard 18080 "${DASHBOARD_URL:-}"

fail() { echo "FAIL: $*" >&2; exit 1; }
pass() { echo "ok   $*"; }
# eventually <description> <command...>: retries until the command succeeds or TIMEOUT passes.
eventually() {
  local what=$1; shift
  local deadline=$((SECONDS + TIMEOUT))
  until "$@" >/dev/null 2>&1; do
    ((SECONDS < deadline)) || fail "$what (waited ${TIMEOUT}s)"
    sleep 1
  done
  pass "$what"
}
status_is() { [[ $(curl -sf "$ORDER/orders/$1" | jq -r .status) == "$2" ]]; }
dashboard_status_is() { [[ $(curl -sf "$DASHBOARD/api/orders/$1" | jq -r .status) == "$2" ]]; }
reserved_is() { [[ $(curl -sf "$INVENTORY/inventory/$1" | jq -r .reserved) == "$2" ]]; }
place() {
  curl -sf -X POST "$ORDER/orders" -H 'Content-Type: application/json' -H "Idempotency-Key: smoke-$1" \
    -d "{\"customerId\":\"smoke\",\"lines\":[{\"sku\":\"$SKU\",\"quantity\":$2,\"unitPrice\":10.00}]}" | jq -r .id
}

eventually "order API is ready" curl -sf "$ORDER/health/ready"
eventually "inventory API is ready" curl -sf "$INVENTORY/health/ready"

SKU="SMOKE-$(date +%s)-$RANDOM"
curl -sf -o /dev/null -X PUT "$INVENTORY/inventory/$SKU" -H 'Content-Type: application/json' -d '{"onHand":10}' \
  || fail "could not create $SKU"
pass "created $SKU with 10 on hand"

confirmed=$(place "$SKU-a" 4)
[[ $confirmed =~ ^[0-9a-f-]{36}$ ]] || fail "order was not accepted"
eventually "order for 4 is confirmed (saga over Kafka)" status_is "$confirmed" Confirmed
eventually "4 units reserved" reserved_is "$SKU" 4

rejected=$(place "$SKU-b" 7)
eventually "order for 7 more is rejected (only 6 left)" status_is "$rejected" Rejected

curl -sf -o /dev/null -X POST "$ORDER/orders/$confirmed/cancel" -H 'Content-Type: application/json' \
  -d '{"reason":"smoke test"}' || fail "cancel was refused"
eventually "cancelled order is Cancelled" status_is "$confirmed" Cancelled
eventually "reservation released" reserved_is "$SKU" 0

if [[ $WITH_DASHBOARD == true ]]; then
  eventually "dashboard is ready (replay caught up)" curl -sf "$DASHBOARD/readyz"
  eventually "dashboard shows the cancelled order" dashboard_status_is "$confirmed" cancelled
  eventually "dashboard shows the rejected order" dashboard_status_is "$rejected" rejected
fi

echo "Smoke test passed."
