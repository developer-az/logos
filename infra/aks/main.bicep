// AKS cluster for the logos public demo (decision D-11).
// Deploy:  az group create -n logos-rg -l eastus2
//          az deployment group create -g logos-rg -f infra/aks/main.bicep
// Save money when idle: az aks stop -g logos-rg -n logos-aks  (start again with az aks start)

@description('Azure region; defaults to the resource group location.')
param location string = resourceGroup().location

param clusterName string = 'logos-aks'

@description('Three nodes so Strimzi can spread 3 Kafka brokers across nodes (min.insync.replicas=2).')
@minValue(3)
param nodeCount int = 3

@description('2 vCPU / 8 GiB AMD nodes: enough for Kafka, Postgres and the services at demo load.')
param nodeVmSize string = 'Standard_D2as_v5'

resource aks 'Microsoft.ContainerService/managedClusters@2024-02-01' = {
  name: clusterName
  location: location
  identity: { type: 'SystemAssigned' }
  sku: { name: 'Base', tier: 'Free' }
  properties: {
    dnsPrefix: clusterName
    enableRBAC: true
    disableLocalAccounts: false
    agentPoolProfiles: [
      {
        name: 'system'
        mode: 'System'
        count: nodeCount
        vmSize: nodeVmSize
        osType: 'Linux'
        osSKU: 'AzureLinux'
        type: 'VirtualMachineScaleSets'
        availabilityZones: [ '1', '2', '3' ]
      }
    ]
    networkProfile: {
      networkPlugin: 'azure'
      networkPluginMode: 'overlay'
      networkDataplane: 'cilium'
      networkPolicy: 'cilium' // enforces the NetworkPolicies in the backlog (E4)
    }
    // Workload identity lets pods reach Azure (e.g. Key Vault for secrets) without stored keys.
    oidcIssuerProfile: { enabled: true }
    securityProfile: { workloadIdentity: { enabled: true } }
    autoUpgradeProfile: { upgradeChannel: 'patch', nodeOSUpgradeChannel: 'NodeImage' }
  }
}

output clusterName string = aks.name
output oidcIssuerUrl string = aks.properties.oidcIssuerProfile.issuerURL
