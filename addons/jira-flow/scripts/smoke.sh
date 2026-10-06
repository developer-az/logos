#!/usr/bin/env bash
# End-to-end check against the compose stack: send a signed Jira-style webhook sequence through
# the gateway and assert the C# service computed lead and cycle time from the Kafka events.
set -euo pipefail
GATEWAY=${GATEWAY:-http://localhost:8080}
METRICS=${METRICS:-http://localhost:8081}
# Same value the gateway got from .env; nothing secret lives in this script.
if [[ -z "${JIRA_WEBHOOK_SECRET:-}" && -f "$(dirname "$0")/../.env" ]]; then
  set -a; . "$(dirname "$0")/../.env"; set +a
fi
SECRET=${JIRA_WEBHOOK_SECRET:?set JIRA_WEBHOOK_SECRET or create .env}
KEY="SMK-$RANDOM"

wait_for() { for _ in $(seq 1 60); do curl -fs "$1" >/dev/null && return 0; sleep 1; done; echo "$1 not up" >&2; exit 1; }
wait_for "$GATEWAY/healthz"
wait_for "$METRICS/healthz/ready"
T0=$(( $(date +%s) * 1000 ))

send() { # event categoryKey statusName offsetHours
  local ts=$(( T0 + $4 * 3600000 ))
  local body
  body=$(printf '{"webhookEvent":"%s","timestamp":%d,"issue":{"id":"%s","key":"%s","fields":{"project":{"key":"SMK"},"status":{"name":"%s","statusCategory":{"key":"%s"}}}},"changelog":{"items":[{"field":"status","fromString":null,"toString":"%s"}]}}' \
    "$1" "$ts" "${KEY#SMK-}" "$KEY" "$3" "$2" "$3")
  local sig="sha256=$(printf '%s' "$body" | openssl dgst -sha256 -hmac "$SECRET" -hex | awk '{print $NF}')"
  curl -fsS -X POST "$GATEWAY/webhooks/jira" -H 'content-type: application/json' -H "x-hub-signature: $sig" -d "$body" >/dev/null
}

send jira:issue_created new "To Do" 0
send jira:issue_updated indeterminate "In Progress" 24
send jira:issue_updated done "Done" 72
send jira:issue_updated done "Done" 72   # duplicate delivery, must be ignored

for _ in $(seq 1 30); do
  if out=$(curl -fsS "$METRICS/api/issues/$KEY/metrics" 2>/dev/null) && grep -q '"completedAt":"' <<<"$out"; then
    echo "$out"
    grep -q '"leadTime":"3.00:00:00"' <<<"$out" && grep -q '"cycleTime":"2.00:00:00"' <<<"$out" \
      && { echo "SMOKE OK ($KEY)"; exit 0; }
    echo "unexpected metrics" >&2; exit 1
  fi
  sleep 1
done
echo "metrics for $KEY never appeared" >&2
exit 1
