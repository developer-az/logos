#!/usr/bin/env bash
# Brings logos up on a local kind cluster in one command (backlog E4-S5), then runs the
# end-to-end smoke test. Re-running is safe: every step is create-or-update.
#
#   scripts/kind-up.sh             # cluster "logos"; needs docker, kind, kubectl, helm, jq, openssl
#   scripts/kind-down.sh           # delete the cluster
#
# Open the apps afterwards:
#   kubectl -n logos port-forward svc/dashboard 8080:80        # http://localhost:8080
#   kubectl -n logos port-forward svc/order-service 5001:80     # POST /orders
set -euo pipefail

ROOT=$(cd "$(dirname "$0")/.." && pwd)
CLUSTER=${CLUSTER:-logos}
NAMESPACE=logos
STRIMZI_VERSION=${STRIMZI_VERSION:-1.2.0} # kafka.strimzi.io/v1, Kafka 4.3.1 (deploy/k8s/kafka)
REGISTRY=ghcr.io/developer-az
TAG=dev

for tool in docker kind kubectl helm jq openssl; do
  command -v "$tool" >/dev/null || { echo "kind-up: '$tool' is required" >&2; exit 1; }
done
step() { printf '\n==> %s\n' "$*"; }

step "kind cluster '$CLUSTER'"
if ! kind get clusters | grep -qx "$CLUSTER"; then
  kind create cluster --name "$CLUSTER" --wait 120s
fi
kubectl config use-context "kind-$CLUSTER" >/dev/null

step "Building images"
docker build -t "$REGISTRY/logos-order-service:$TAG" --build-arg SERVICE=Order.Service "$ROOT/services"
docker build -t "$REGISTRY/logos-inventory-service:$TAG" --build-arg SERVICE=Inventory.Service "$ROOT/services"
docker build -t "$REGISTRY/logos-dashboard:$TAG" "$ROOT/dashboard"
kind load docker-image --name "$CLUSTER" \
  "$REGISTRY/logos-order-service:$TAG" "$REGISTRY/logos-inventory-service:$TAG" "$REGISTRY/logos-dashboard:$TAG"

step "Namespace and Strimzi $STRIMZI_VERSION"
kubectl apply -k "$ROOT/deploy/k8s/namespace"
helm upgrade --install strimzi oci://quay.io/strimzi-helm/strimzi-kafka-operator \
  --version "$STRIMZI_VERSION" --namespace strimzi --create-namespace \
  --set "watchNamespaces={$NAMESPACE}" --wait --timeout 5m

step "Database passwords (generated once, kept across re-runs)"
if ! kubectl -n "$NAMESPACE" get secret postgres-credentials >/dev/null 2>&1; then
  kubectl -n "$NAMESPACE" create secret generic postgres-credentials \
    --from-literal=postgres-password="$(openssl rand -hex 16)" \
    --from-literal=orders-password="$(openssl rand -hex 16)" \
    --from-literal=inventory-password="$(openssl rand -hex 16)"
fi

step "Applying deploy/k8s/overlays/local"
kubectl apply -k "$ROOT/deploy/k8s/overlays/local"

step "Waiting for Kafka, users and PostgreSQL"
kubectl -n "$NAMESPACE" wait kafka/logos-kafka --for=condition=Ready --timeout=10m
kubectl -n "$NAMESPACE" wait kafkatopic --all --for=condition=Ready --timeout=5m
kubectl -n "$NAMESPACE" wait kafkauser --all --for=condition=Ready --timeout=5m
kubectl -n "$NAMESPACE" rollout status statefulset/postgres --timeout=5m

step "Waiting for the apps"
for app in order-service inventory-service dashboard load-generator; do
  kubectl -n "$NAMESPACE" rollout status "deploy/$app" --timeout=10m
done

step "Smoke test"
"$ROOT/scripts/smoke.sh"
