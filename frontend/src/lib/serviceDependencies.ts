// Azure Service Dependencies Configuration
// Defines relationships between Azure services for validation

export type DependencyType = 'required' | 'recommended' | 'optional';
export type IssueSeverity = 'error' | 'warning' | 'info';

export interface ServiceDependency {
  // The service that is required/recommended
  targetServiceId: string;
  // Type of dependency
  type: DependencyType;
  // Human-readable reason
  reason: string;
  // The Bicep property that references this dependency
  bicepProperty?: string;
  // Condition when this dependency applies (e.g., specific SKU)
  condition?: {
    property: string;
    values: string[];
    operator: 'in' | 'notIn' | 'equals' | 'notEquals';
  };
}

export interface ServiceValidationRule {
  serviceId: string;
  resourceType: string;
  dependencies: ServiceDependency[];
  // Container requirements (must be inside specific group types)
  containerRequirements?: {
    required: ('resourceGroup' | 'subscription' | 'region')[];
    recommended: ('virtualNetwork' | 'subnet')[];
  };
  // Properties that must be set
  requiredProperties?: string[];
}

// Comprehensive Azure Service Dependencies
export const serviceDependencies: ServiceValidationRule[] = [
  // ============ COMPUTE ============
  {
    serviceId: 'app-service',
    resourceType: 'Microsoft.Web/sites',
    dependencies: [
      {
        targetServiceId: 'app-service-plan',
        type: 'required',
        reason: 'App Service requires an App Service Plan (serverFarmId) to define the compute resources',
        bicepProperty: 'properties.serverFarmId',
      },
      {
        targetServiceId: 'application-insights',
        type: 'recommended',
        reason: 'Application Insights provides monitoring and diagnostics for your App Service',
      },
      {
        targetServiceId: 'key-vault',
        type: 'recommended',
        reason: 'Key Vault is recommended for storing connection strings and secrets securely',
      },
    ],
    containerRequirements: {
      required: ['resourceGroup'],
      recommended: [],
    },
    requiredProperties: ['name', 'location'],
  },
  {
    serviceId: 'app-service-plan',
    resourceType: 'Microsoft.Web/serverfarms',
    dependencies: [
      {
        targetServiceId: 'app-service-environment',
        type: 'required',
        reason: 'Isolated SKU requires an App Service Environment',
        condition: {
          property: 'sku',
          values: ['I1', 'I2', 'I3', 'I1v2', 'I2v2', 'I3v2', 'I4v2', 'I5v2', 'I6v2'],
          operator: 'in',
        },
      },
    ],
    containerRequirements: {
      required: ['resourceGroup'],
      recommended: [],
    },
  },
  {
    serviceId: 'function-app',
    resourceType: 'Microsoft.Web/sites',
    dependencies: [
      {
        targetServiceId: 'app-service-plan',
        type: 'required',
        reason: 'Function App requires an App Service Plan (or Consumption plan) for compute resources',
        bicepProperty: 'properties.serverFarmId',
        condition: {
          property: 'kind',
          values: ['functionapp,linux', 'functionapp'],
          operator: 'in',
        },
      },
      {
        targetServiceId: 'storage-account',
        type: 'required',
        reason: 'Function App requires a Storage Account for triggers, bindings, and function code storage',
        bicepProperty: 'properties.siteConfig.appSettings.AzureWebJobsStorage',
      },
      {
        targetServiceId: 'application-insights',
        type: 'recommended',
        reason: 'Application Insights provides monitoring and diagnostics for your Function App',
      },
    ],
    containerRequirements: {
      required: ['resourceGroup'],
      recommended: [],
    },
  },
  {
    serviceId: 'virtual-machine',
    resourceType: 'Microsoft.Compute/virtualMachines',
    dependencies: [
      {
        targetServiceId: 'network-interface',
        type: 'required',
        reason: 'Virtual Machine requires at least one Network Interface for network connectivity',
        bicepProperty: 'properties.networkProfile.networkInterfaces',
      },
      {
        targetServiceId: 'disk',
        type: 'recommended',
        reason: 'Additional managed disks are recommended for data storage separate from OS disk',
      },
      {
        targetServiceId: 'availability-set',
        type: 'recommended',
        reason: 'Availability Set provides high availability for VMs in the same application tier',
      },
    ],
    containerRequirements: {
      required: ['resourceGroup'],
      recommended: [],
    },
  },
  {
    serviceId: 'vm-scale-set',
    resourceType: 'Microsoft.Compute/virtualMachineScaleSets',
    dependencies: [
      {
        targetServiceId: 'virtual-network',
        type: 'required',
        reason: 'VM Scale Set requires a Virtual Network for network connectivity',
      },
      {
        targetServiceId: 'load-balancer',
        type: 'recommended',
        reason: 'Load Balancer distributes traffic across VM Scale Set instances',
      },
      {
        targetServiceId: 'application-insights',
        type: 'recommended',
        reason: 'Application Insights provides monitoring for scale set instances',
      },
    ],
    containerRequirements: {
      required: ['resourceGroup'],
      recommended: ['virtualNetwork'],
    },
  },

  // ============ CONTAINERS ============
  {
    serviceId: 'kubernetes-service',
    resourceType: 'Microsoft.ContainerService/managedClusters',
    dependencies: [
      {
        targetServiceId: 'virtual-network',
        type: 'recommended',
        reason: 'Custom VNet provides network isolation and integration with other Azure resources',
      },
      {
        targetServiceId: 'container-registry',
        type: 'recommended',
        reason: 'Azure Container Registry provides private container image storage with integrated authentication',
      },
      {
        targetServiceId: 'log-analytics',
        type: 'recommended',
        reason: 'Log Analytics Workspace enables Container Insights for AKS monitoring',
      },
      {
        targetServiceId: 'key-vault',
        type: 'recommended',
        reason: 'Key Vault integration (via CSI driver) provides secure secret management for pods',
      },
    ],
    containerRequirements: {
      required: ['resourceGroup'],
      recommended: ['virtualNetwork'],
    },
  },
  {
    serviceId: 'container-app',
    resourceType: 'Microsoft.App/containerApps',
    dependencies: [
      {
        targetServiceId: 'container-app-environment',
        type: 'required',
        reason: 'Container App requires a Container Apps Environment (managedEnvironmentId)',
        bicepProperty: 'properties.managedEnvironmentId',
      },
      {
        targetServiceId: 'container-registry',
        type: 'recommended',
        reason: 'Azure Container Registry provides private container image storage',
      },
    ],
    containerRequirements: {
      required: ['resourceGroup'],
      recommended: [],
    },
  },
  {
    serviceId: 'container-instance',
    resourceType: 'Microsoft.ContainerInstance/containerGroups',
    dependencies: [
      {
        targetServiceId: 'virtual-network',
        type: 'optional',
        reason: 'VNet integration provides network isolation for container instances',
      },
      {
        targetServiceId: 'storage-account',
        type: 'optional',
        reason: 'Azure Files can be mounted as volumes in container instances',
      },
    ],
    containerRequirements: {
      required: ['resourceGroup'],
      recommended: [],
    },
  },
  {
    serviceId: 'container-registry',
    resourceType: 'Microsoft.ContainerRegistry/registries',
    dependencies: [
      {
        targetServiceId: 'private-endpoint',
        type: 'recommended',
        reason: 'Private Endpoint provides secure access to Container Registry from VNet',
        condition: {
          property: 'sku',
          values: ['Premium'],
          operator: 'in',
        },
      },
    ],
    containerRequirements: {
      required: ['resourceGroup'],
      recommended: [],
    },
  },

  // ============ DATABASES ============
  {
    serviceId: 'sql-database',
    resourceType: 'Microsoft.Sql/servers/databases',
    dependencies: [
      {
        targetServiceId: 'sql-server',
        type: 'required',
        reason: 'SQL Database must be created within a SQL Server instance',
        bicepProperty: 'parent',
      },
    ],
    containerRequirements: {
      required: ['resourceGroup'],
      recommended: [],
    },
  },
  {
    serviceId: 'sql-server',
    resourceType: 'Microsoft.Sql/servers',
    dependencies: [
      {
        targetServiceId: 'private-endpoint',
        type: 'recommended',
        reason: 'Private Endpoint provides secure connectivity from VNet without public exposure',
      },
      {
        targetServiceId: 'key-vault',
        type: 'recommended',
        reason: 'Key Vault can store SQL Server admin credentials securely',
      },
    ],
    containerRequirements: {
      required: ['resourceGroup'],
      recommended: [],
    },
  },
  {
    serviceId: 'cosmos-db',
    resourceType: 'Microsoft.DocumentDB/databaseAccounts',
    dependencies: [
      {
        targetServiceId: 'private-endpoint',
        type: 'recommended',
        reason: 'Private Endpoint provides secure access to Cosmos DB from VNet',
      },
    ],
    containerRequirements: {
      required: ['resourceGroup'],
      recommended: [],
    },
  },
  {
    serviceId: 'redis-cache',
    resourceType: 'Microsoft.Cache/redis',
    dependencies: [
      {
        targetServiceId: 'virtual-network',
        type: 'recommended',
        reason: 'VNet injection provides network isolation (Premium tier)',
        condition: {
          property: 'sku',
          values: ['Premium'],
          operator: 'in',
        },
      },
      {
        targetServiceId: 'private-endpoint',
        type: 'recommended',
        reason: 'Private Endpoint provides secure access from VNet',
      },
    ],
    containerRequirements: {
      required: ['resourceGroup'],
      recommended: [],
    },
  },
  {
    serviceId: 'mysql',
    resourceType: 'Microsoft.DBforMySQL/flexibleServers',
    dependencies: [
      {
        targetServiceId: 'virtual-network',
        type: 'recommended',
        reason: 'VNet integration provides network isolation for MySQL Flexible Server',
      },
      {
        targetServiceId: 'private-dns-zone',
        type: 'recommended',
        reason: 'Private DNS Zone is required for VNet-integrated MySQL Flexible Server',
      },
    ],
    containerRequirements: {
      required: ['resourceGroup'],
      recommended: ['virtualNetwork'],
    },
  },
  {
    serviceId: 'postgresql',
    resourceType: 'Microsoft.DBforPostgreSQL/flexibleServers',
    dependencies: [
      {
        targetServiceId: 'virtual-network',
        type: 'recommended',
        reason: 'VNet integration provides network isolation for PostgreSQL Flexible Server',
      },
      {
        targetServiceId: 'private-dns-zone',
        type: 'recommended',
        reason: 'Private DNS Zone is required for VNet-integrated PostgreSQL Flexible Server',
      },
    ],
    containerRequirements: {
      required: ['resourceGroup'],
      recommended: ['virtualNetwork'],
    },
  },

  // ============ NETWORKING ============
  {
    serviceId: 'network-interface',
    resourceType: 'Microsoft.Network/networkInterfaces',
    dependencies: [
      {
        targetServiceId: 'virtual-network',
        type: 'required',
        reason: 'Network Interface must be associated with a VNet subnet',
      },
      {
        targetServiceId: 'network-security-group',
        type: 'recommended',
        reason: 'NSG provides network-level security rules for the NIC',
      },
      {
        targetServiceId: 'public-ip',
        type: 'optional',
        reason: 'Public IP enables direct internet connectivity',
      },
    ],
    containerRequirements: {
      required: ['resourceGroup'],
      recommended: ['virtualNetwork'],
    },
  },
  {
    serviceId: 'virtual-network',
    resourceType: 'Microsoft.Network/virtualNetworks',
    dependencies: [
      {
        targetServiceId: 'network-security-group',
        type: 'recommended',
        reason: 'NSG provides subnet-level security rules',
      },
    ],
    containerRequirements: {
      required: ['resourceGroup'],
      recommended: [],
    },
  },
  {
    serviceId: 'application-gateway',
    resourceType: 'Microsoft.Network/applicationGateways',
    dependencies: [
      {
        targetServiceId: 'virtual-network',
        type: 'required',
        reason: 'Application Gateway requires a dedicated subnet in a VNet',
      },
      {
        targetServiceId: 'public-ip',
        type: 'required',
        reason: 'Application Gateway requires a Public IP for frontend',
        condition: {
          property: 'sku',
          values: ['Standard_v2', 'WAF_v2'],
          operator: 'in',
        },
      },
    ],
    containerRequirements: {
      required: ['resourceGroup'],
      recommended: ['virtualNetwork'],
    },
  },
  {
    serviceId: 'load-balancer',
    resourceType: 'Microsoft.Network/loadBalancers',
    dependencies: [
      {
        targetServiceId: 'public-ip',
        type: 'optional',
        reason: 'Public IP required for public-facing load balancer',
      },
      {
        targetServiceId: 'virtual-network',
        type: 'optional',
        reason: 'VNet required for internal load balancer',
      },
    ],
    containerRequirements: {
      required: ['resourceGroup'],
      recommended: [],
    },
  },
  {
    serviceId: 'vpn-gateway',
    resourceType: 'Microsoft.Network/virtualNetworkGateways',
    dependencies: [
      {
        targetServiceId: 'virtual-network',
        type: 'required',
        reason: 'VPN Gateway requires a GatewaySubnet in a VNet',
      },
      {
        targetServiceId: 'public-ip',
        type: 'required',
        reason: 'VPN Gateway requires a Public IP for connectivity',
      },
    ],
    containerRequirements: {
      required: ['resourceGroup'],
      recommended: ['virtualNetwork'],
    },
  },
  {
    serviceId: 'firewall',
    resourceType: 'Microsoft.Network/azureFirewalls',
    dependencies: [
      {
        targetServiceId: 'virtual-network',
        type: 'required',
        reason: 'Azure Firewall requires an AzureFirewallSubnet in a VNet',
      },
      {
        targetServiceId: 'public-ip',
        type: 'required',
        reason: 'Azure Firewall requires at least one Public IP',
      },
      {
        targetServiceId: 'firewall-policy',
        type: 'recommended',
        reason: 'Firewall Policy provides centralized rule management',
      },
    ],
    containerRequirements: {
      required: ['resourceGroup'],
      recommended: ['virtualNetwork'],
    },
  },
  {
    serviceId: 'bastion',
    resourceType: 'Microsoft.Network/bastionHosts',
    dependencies: [
      {
        targetServiceId: 'virtual-network',
        type: 'required',
        reason: 'Azure Bastion requires an AzureBastionSubnet in a VNet',
      },
      {
        targetServiceId: 'public-ip',
        type: 'required',
        reason: 'Azure Bastion requires a Standard SKU Public IP',
      },
    ],
    containerRequirements: {
      required: ['resourceGroup'],
      recommended: ['virtualNetwork'],
    },
  },
  {
    serviceId: 'front-door',
    resourceType: 'Microsoft.Cdn/profiles',
    dependencies: [
      {
        targetServiceId: 'waf-policy',
        type: 'recommended',
        reason: 'WAF Policy provides application-level security for Front Door',
      },
    ],
    containerRequirements: {
      required: ['resourceGroup'],
      recommended: [],
    },
  },
  {
    serviceId: 'private-endpoint',
    resourceType: 'Microsoft.Network/privateEndpoints',
    dependencies: [
      {
        targetServiceId: 'virtual-network',
        type: 'required',
        reason: 'Private Endpoint requires a subnet in a VNet',
      },
      {
        targetServiceId: 'private-dns-zone',
        type: 'recommended',
        reason: 'Private DNS Zone enables DNS resolution for private endpoints',
      },
    ],
    containerRequirements: {
      required: ['resourceGroup'],
      recommended: ['virtualNetwork'],
    },
  },

  // ============ STORAGE ============
  {
    serviceId: 'storage-account',
    resourceType: 'Microsoft.Storage/storageAccounts',
    dependencies: [
      {
        targetServiceId: 'private-endpoint',
        type: 'recommended',
        reason: 'Private Endpoint provides secure access from VNet',
      },
    ],
    containerRequirements: {
      required: ['resourceGroup'],
      recommended: [],
    },
  },

  // ============ SECURITY ============
  {
    serviceId: 'key-vault',
    resourceType: 'Microsoft.KeyVault/vaults',
    dependencies: [
      {
        targetServiceId: 'private-endpoint',
        type: 'recommended',
        reason: 'Private Endpoint provides secure access from VNet',
      },
      {
        targetServiceId: 'managed-identity',
        type: 'recommended',
        reason: 'Managed Identity enables secure, passwordless access to Key Vault',
      },
    ],
    containerRequirements: {
      required: ['resourceGroup'],
      recommended: [],
    },
  },

  // ============ INTEGRATION ============
  {
    serviceId: 'event-hub',
    resourceType: 'Microsoft.EventHub/namespaces',
    dependencies: [
      {
        targetServiceId: 'storage-account',
        type: 'recommended',
        reason: 'Storage Account is required for Event Hub Capture feature',
      },
      {
        targetServiceId: 'private-endpoint',
        type: 'recommended',
        reason: 'Private Endpoint provides secure access from VNet',
      },
    ],
    containerRequirements: {
      required: ['resourceGroup'],
      recommended: [],
    },
  },
  {
    serviceId: 'service-bus',
    resourceType: 'Microsoft.ServiceBus/namespaces',
    dependencies: [
      {
        targetServiceId: 'private-endpoint',
        type: 'recommended',
        reason: 'Private Endpoint provides secure access from VNet',
      },
    ],
    containerRequirements: {
      required: ['resourceGroup'],
      recommended: [],
    },
  },
  {
    serviceId: 'logic-app',
    resourceType: 'Microsoft.Logic/workflows',
    dependencies: [
      {
        targetServiceId: 'storage-account',
        type: 'required',
        reason: 'Logic App Standard requires a Storage Account',
        condition: {
          property: 'kind',
          values: ['functionapp,workflowapp'],
          operator: 'in',
        },
      },
      {
        targetServiceId: 'app-service-plan',
        type: 'required',
        reason: 'Logic App Standard requires an App Service Plan',
        condition: {
          property: 'kind',
          values: ['functionapp,workflowapp'],
          operator: 'in',
        },
      },
    ],
    containerRequirements: {
      required: ['resourceGroup'],
      recommended: [],
    },
  },
  {
    serviceId: 'api-management',
    resourceType: 'Microsoft.ApiManagement/service',
    dependencies: [
      {
        targetServiceId: 'virtual-network',
        type: 'recommended',
        reason: 'VNet integration provides network isolation (Developer/Premium tier)',
      },
      {
        targetServiceId: 'application-insights',
        type: 'recommended',
        reason: 'Application Insights provides API analytics and monitoring',
      },
      {
        targetServiceId: 'key-vault',
        type: 'recommended',
        reason: 'Key Vault can store certificates and secrets for APIM',
      },
    ],
    containerRequirements: {
      required: ['resourceGroup'],
      recommended: [],
    },
  },

  // ============ ANALYTICS ============
  {
    serviceId: 'data-factory',
    resourceType: 'Microsoft.DataFactory/factories',
    dependencies: [
      {
        targetServiceId: 'storage-account',
        type: 'recommended',
        reason: 'Storage Account is commonly used as source/sink in data pipelines',
      },
      {
        targetServiceId: 'key-vault',
        type: 'recommended',
        reason: 'Key Vault stores connection strings and credentials securely',
      },
      {
        targetServiceId: 'virtual-network',
        type: 'recommended',
        reason: 'Self-hosted IR in VNet provides access to on-premises resources',
      },
    ],
    containerRequirements: {
      required: ['resourceGroup'],
      recommended: [],
    },
  },
  {
    serviceId: 'synapse',
    resourceType: 'Microsoft.Synapse/workspaces',
    dependencies: [
      {
        targetServiceId: 'storage-account',
        type: 'required',
        reason: 'Synapse requires a Data Lake Storage Gen2 account',
        bicepProperty: 'properties.defaultDataLakeStorage',
      },
      {
        targetServiceId: 'private-endpoint',
        type: 'recommended',
        reason: 'Private Endpoints provide secure access to Synapse',
      },
    ],
    containerRequirements: {
      required: ['resourceGroup'],
      recommended: [],
    },
  },

  // ============ AI/ML ============
  {
    serviceId: 'cognitive-services',
    resourceType: 'Microsoft.CognitiveServices/accounts',
    dependencies: [
      {
        targetServiceId: 'private-endpoint',
        type: 'recommended',
        reason: 'Private Endpoint provides secure access from VNet',
      },
    ],
    containerRequirements: {
      required: ['resourceGroup'],
      recommended: [],
    },
  },
  {
    serviceId: 'machine-learning',
    resourceType: 'Microsoft.MachineLearningServices/workspaces',
    dependencies: [
      {
        targetServiceId: 'storage-account',
        type: 'required',
        reason: 'ML Workspace requires a Storage Account for datasets and models',
        bicepProperty: 'properties.storageAccount',
      },
      {
        targetServiceId: 'key-vault',
        type: 'required',
        reason: 'ML Workspace requires a Key Vault for secrets management',
        bicepProperty: 'properties.keyVault',
      },
      {
        targetServiceId: 'application-insights',
        type: 'required',
        reason: 'ML Workspace requires Application Insights for monitoring',
        bicepProperty: 'properties.applicationInsights',
      },
      {
        targetServiceId: 'container-registry',
        type: 'recommended',
        reason: 'Container Registry stores Docker images for ML models',
      },
    ],
    containerRequirements: {
      required: ['resourceGroup'],
      recommended: [],
    },
  },
  {
    serviceId: 'openai',
    resourceType: 'Microsoft.CognitiveServices/accounts',
    dependencies: [
      {
        targetServiceId: 'private-endpoint',
        type: 'recommended',
        reason: 'Private Endpoint provides secure access to Azure OpenAI',
      },
      {
        targetServiceId: 'managed-identity',
        type: 'recommended',
        reason: 'Managed Identity enables secure, key-less authentication',
      },
    ],
    containerRequirements: {
      required: ['resourceGroup'],
      recommended: [],
    },
  },
  {
    serviceId: 'search',
    resourceType: 'Microsoft.Search/searchServices',
    dependencies: [
      {
        targetServiceId: 'private-endpoint',
        type: 'recommended',
        reason: 'Private Endpoint provides secure access from VNet',
      },
      {
        targetServiceId: 'storage-account',
        type: 'recommended',
        reason: 'Storage Account is commonly used as a data source for indexing',
      },
    ],
    containerRequirements: {
      required: ['resourceGroup'],
      recommended: [],
    },
  },

  // ============ MONITORING ============
  {
    serviceId: 'application-insights',
    resourceType: 'Microsoft.Insights/components',
    dependencies: [
      {
        targetServiceId: 'log-analytics',
        type: 'required',
        reason: 'Application Insights requires a Log Analytics Workspace (workspace-based)',
        bicepProperty: 'properties.WorkspaceResourceId',
      },
    ],
    containerRequirements: {
      required: ['resourceGroup'],
      recommended: [],
    },
  },
  {
    serviceId: 'log-analytics',
    resourceType: 'Microsoft.OperationalInsights/workspaces',
    dependencies: [],
    containerRequirements: {
      required: ['resourceGroup'],
      recommended: [],
    },
  },

  // ============ IOT ============
  {
    serviceId: 'iot-hub',
    resourceType: 'Microsoft.Devices/IotHubs',
    dependencies: [
      {
        targetServiceId: 'storage-account',
        type: 'recommended',
        reason: 'Storage Account is required for IoT Hub file upload and message routing',
      },
      {
        targetServiceId: 'event-hub',
        type: 'recommended',
        reason: 'Event Hub can be used as a custom endpoint for message routing',
      },
    ],
    containerRequirements: {
      required: ['resourceGroup'],
      recommended: [],
    },
  },
];

// Helper function to get dependencies for a service
export function getServiceDependencies(serviceId: string): ServiceValidationRule | undefined {
  return serviceDependencies.find(s => s.serviceId === serviceId);
}

// Get all services that this service depends on
export function getRequiredDependencies(serviceId: string): ServiceDependency[] {
  const rule = getServiceDependencies(serviceId);
  return rule?.dependencies.filter(d => d.type === 'required') || [];
}

export function getRecommendedDependencies(serviceId: string): ServiceDependency[] {
  const rule = getServiceDependencies(serviceId);
  return rule?.dependencies.filter(d => d.type === 'recommended') || [];
}

// Get all services that depend on this service
export function getDependentServices(serviceId: string): { serviceId: string; dependency: ServiceDependency }[] {
  const dependents: { serviceId: string; dependency: ServiceDependency }[] = [];
  
  for (const rule of serviceDependencies) {
    for (const dep of rule.dependencies) {
      if (dep.targetServiceId === serviceId) {
        dependents.push({ serviceId: rule.serviceId, dependency: dep });
      }
    }
  }
  
  return dependents;
}
