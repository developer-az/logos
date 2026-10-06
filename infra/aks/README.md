# AKS for the logos demo

`main.bicep` creates one AKS cluster sized for the public demo: 3 × Standard_D2as_v5 across zones, Azure CNI overlay with Cilium (network policy enforced), workload identity on, automatic patch upgrades, free control-plane tier.

**Cost:** about three D2as_v5 VMs plus disks, roughly USD 200–250 a month if left running at pay-as-you-go prices. Check current pricing for your region before deploying. `az aks stop` between demos stops node billing, and the free tier has no control-plane charge.

**After the cluster exists:**
1. `az aks get-credentials -g logos-rg -n logos-aks`
2. Install Strimzi (`helm install strimzi oci://quay.io/strimzi-helm/strimzi-kafka-operator -n kafka --create-namespace`)
3. `kubectl apply -k deploy/k8s/kafka`
4. Deploy the apps (plan step 4).

Secrets: use Azure Key Vault + External Secrets Operator through workload identity. Nothing secret goes in git.

Status: written and reviewed, **not yet deployed or validated with `az bicep build`** (no Azure CLI in the build sandbox). The E4 cluster story covers the first real deploy.
