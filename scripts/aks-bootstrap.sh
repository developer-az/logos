#!/usr/bin/env bash
# One-time setup of the AKS demo cluster created from infra/aks/main.bicep, so that
# .github/workflows/deploy.yml can deploy to it on every merge to main. Re-running is safe.
#
#   az login
#   RESOURCE_GROUP=logos-rg CLUSTER=logos-aks KEY_VAULT=<globally unique name> \
#     GITHUB_REPO=developer-az/logos scripts/aks-bootstrap.sh
#
# What it does:
#   1. Key Vault with the three database passwords (generated here, never printed or stored locally)
#   2. A managed identity the External Secrets Operator uses (workload identity) to read them
#   3. A managed identity GitHub Actions signs in as (OIDC; no stored Azure secret in GitHub)
#   4. Cluster add-ons: Strimzi, Envoy Gateway, cert-manager, External Secrets Operator
#   5. The cluster-scoped GatewayClass and Let's Encrypt ClusterIssuer (deploy/k8s/platform/aks)
# It prints the GitHub repository variables to set at the end.
set -euo pipefail

: "${RESOURCE_GROUP:?set RESOURCE_GROUP}" "${CLUSTER:?set CLUSTER}" "${KEY_VAULT:?set KEY_VAULT}"
GITHUB_REPO=${GITHUB_REPO:-developer-az/logos}
GITHUB_ENVIRONMENT=${GITHUB_ENVIRONMENT:-aks-demo}
NAMESPACE=logos
STRIMZI_VERSION=1.2.0
ENVOY_GATEWAY_VERSION=v1.9.2
CERT_MANAGER_VERSION=v1.21.2
EXTERNAL_SECRETS_VERSION=2.12.0
ROOT=$(cd "$(dirname "$0")/.." && pwd)

for tool in az kubectl helm openssl; do
  command -v "$tool" >/dev/null || { echo "aks-bootstrap: '$tool' is required" >&2; exit 1; }
done
step() { printf '\n==> %s\n' "$*"; }

LOCATION=$(az group show -n "$RESOURCE_GROUP" --query location -o tsv)
SUBSCRIPTION_ID=$(az account show --query id -o tsv)
TENANT_ID=$(az account show --query tenantId -o tsv)
OIDC_ISSUER=$(az aks show -g "$RESOURCE_GROUP" -n "$CLUSTER" --query oidcIssuerProfile.issuerUrl -o tsv)
CLUSTER_ID=$(az aks show -g "$RESOURCE_GROUP" -n "$CLUSTER" --query id -o tsv)
ME=$(az ad signed-in-user show --query id -o tsv)

step "Key Vault $KEY_VAULT (RBAC mode)"
if ! az keyvault show -n "$KEY_VAULT" >/dev/null 2>&1; then
  az keyvault create -n "$KEY_VAULT" -g "$RESOURCE_GROUP" -l "$LOCATION" --enable-rbac-authorization true -o none
fi
VAULT_ID=$(az keyvault show -n "$KEY_VAULT" --query id -o tsv)
VAULT_URL=$(az keyvault show -n "$KEY_VAULT" --query properties.vaultUri -o tsv)
az role assignment create --assignee-object-id "$ME" --assignee-principal-type User \
  --role "Key Vault Secrets Officer" --scope "$VAULT_ID" -o none 2>/dev/null || true
for name in logos-postgres-password logos-orders-db-password logos-inventory-db-password; do
  if ! az keyvault secret show --vault-name "$KEY_VAULT" -n "$name" >/dev/null 2>&1; then
    # Role assignments can take a minute to apply; retry the first write.
    for attempt in 1 2 3 4 5 6; do
      az keyvault secret set --vault-name "$KEY_VAULT" -n "$name" --value "$(openssl rand -hex 24)" -o none && break
      sleep $((attempt * 10))
    done
  fi
done

step "Workload identity for the External Secrets Operator"
az identity create -n logos-key-vault-reader -g "$RESOURCE_GROUP" -l "$LOCATION" -o none
KV_CLIENT_ID=$(az identity show -n logos-key-vault-reader -g "$RESOURCE_GROUP" --query clientId -o tsv)
KV_PRINCIPAL_ID=$(az identity show -n logos-key-vault-reader -g "$RESOURCE_GROUP" --query principalId -o tsv)
az role assignment create --assignee-object-id "$KV_PRINCIPAL_ID" --assignee-principal-type ServicePrincipal \
  --role "Key Vault Secrets User" --scope "$VAULT_ID" -o none 2>/dev/null || true
az identity federated-credential create --identity-name logos-key-vault-reader -g "$RESOURCE_GROUP" \
  -n logos-key-vault-reader --issuer "$OIDC_ISSUER" --audiences api://AzureADTokenExchange \
  --subject "system:serviceaccount:$NAMESPACE:key-vault-reader" -o none 2>/dev/null || true

step "Identity for GitHub Actions ($GITHUB_REPO, environment $GITHUB_ENVIRONMENT)"
az identity create -n logos-github-deploy -g "$RESOURCE_GROUP" -l "$LOCATION" -o none
GH_CLIENT_ID=$(az identity show -n logos-github-deploy -g "$RESOURCE_GROUP" --query clientId -o tsv)
GH_PRINCIPAL_ID=$(az identity show -n logos-github-deploy -g "$RESOURCE_GROUP" --query principalId -o tsv)
# Cluster User returns the kubeconfig; the cluster has Kubernetes RBAC with local accounts
# (infra/aks/main.bicep), so that kubeconfig can apply the manifests.
az role assignment create --assignee-object-id "$GH_PRINCIPAL_ID" --assignee-principal-type ServicePrincipal \
  --role "Azure Kubernetes Service Cluster User Role" --scope "$CLUSTER_ID" -o none 2>/dev/null || true
az identity federated-credential create --identity-name logos-github-deploy -g "$RESOURCE_GROUP" \
  -n github-environment --issuer https://token.actions.githubusercontent.com --audiences api://AzureADTokenExchange \
  --subject "repo:$GITHUB_REPO:environment:$GITHUB_ENVIRONMENT" -o none 2>/dev/null || true

step "Cluster add-ons"
az aks get-credentials -g "$RESOURCE_GROUP" -n "$CLUSTER" --overwrite-existing
kubectl apply -k "$ROOT/deploy/k8s/namespace"
helm upgrade --install strimzi oci://quay.io/strimzi-helm/strimzi-kafka-operator --version "$STRIMZI_VERSION" \
  -n strimzi --create-namespace --set "watchNamespaces={$NAMESPACE}" --wait
helm upgrade --install eg oci://docker.io/envoyproxy/gateway-helm --version "$ENVOY_GATEWAY_VERSION" \
  -n envoy-gateway-system --create-namespace --wait
helm upgrade --install cert-manager oci://quay.io/jetstack/charts/cert-manager --version "$CERT_MANAGER_VERSION" \
  -n cert-manager --create-namespace --set crds.enabled=true \
  --set config.apiVersion=controller.config.cert-manager.io/v1alpha1 \
  --set config.kind=ControllerConfiguration --set config.enableGatewayAPI=true --wait
helm upgrade --install external-secrets oci://ghcr.io/external-secrets/charts/external-secrets \
  --version "$EXTERNAL_SECRETS_VERSION" -n external-secrets --create-namespace --wait
kubectl apply -k "$ROOT/deploy/k8s/platform/aks"

cat <<VARS

Done. Set these GitHub repository variables (Settings > Secrets and variables > Actions > Variables).
None of them is secret.
  AZURE_CLIENT_ID=$GH_CLIENT_ID
  AZURE_TENANT_ID=$TENANT_ID
  AZURE_SUBSCRIPTION_ID=$SUBSCRIPTION_ID
  AKS_RESOURCE_GROUP=$RESOURCE_GROUP
  AKS_CLUSTER=$CLUSTER
  KEY_VAULT_URL=$VAULT_URL
  KEY_VAULT_CLIENT_ID=$KV_CLIENT_ID
  DEMO_HOST=<a DNS name you point at the gateway's public IP>
  AKS_DEPLOY_ENABLED=true

The gateway's public IP appears once the first deploy creates the Gateway:
  kubectl -n $NAMESPACE get gateway logos -o jsonpath='{.status.addresses[0].value}'
VARS
