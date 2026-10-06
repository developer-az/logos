# AKS for the logos demo

`main.bicep` creates one AKS cluster sized for the public demo: 3 × Standard_D2as_v5 across zones, Azure CNI overlay with Cilium (network policy enforced), workload identity on, automatic patch upgrades, free control-plane tier.

**Cost:** about three D2as_v5 VMs plus disks, roughly USD 200–250 a month if left running at pay-as-you-go prices. Check current pricing for your region before deploying. `az aks stop` between demos stops node billing, and the free tier has no control-plane charge.

**After the cluster exists:**
1. Run `scripts/aks-bootstrap.sh`: Key Vault, identities, Strimzi, Envoy Gateway, cert-manager, External Secrets
2. Set the GitHub variables it prints; `.github/workflows/deploy.yml` then deploys every merge (see `deploy/README.md`)

Secrets: use Azure Key Vault + External Secrets Operator through workload identity. Nothing secret goes in git.

Status: written and reviewed, **not yet deployed or validated with `az bicep build`** (no Azure CLI in the build sandbox). The E4 cluster story covers the first real deploy.
