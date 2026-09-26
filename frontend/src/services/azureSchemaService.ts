/**
 * Azure Schema Service - Dynamic fetching of Azure resource schemas
 * 
 * Uses the official Azure Bicep Types repository as the source of truth:
 * https://github.com/Azure/bicep-types-az
 * 
 * This ensures we always have the latest Azure resource definitions,
 * properties, and API versions without manual maintenance.
 */

// Cache configuration
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const BICEP_TYPES_BASE_URL = 'https://raw.githubusercontent.com/Azure/bicep-types-az/main/generated';

// Types for Bicep schema
export interface BicepTypeProperty {
  type: BicepTypeReference;
  flags?: number;
  description?: string;
}

export interface BicepTypeReference {
  $ref?: string;
  type?: string;
}

export interface BicepResourceType {
  name: string;
  properties?: Record<string, BicepTypeProperty>;
  additionalProperties?: BicepTypeReference;
}

export interface BicepTypesIndex {
  resources: Record<string, BicepResourceTypeInfo>;
  resourceFunctions: Record<string, unknown>;
}

export interface BicepResourceTypeInfo {
  relativePath: string;
  index: number;
}

export interface AzureResourceSchema {
  resourceType: string;
  apiVersion: string;
  properties: PropertyDefinition[];
  requiredProperties: string[];
  dependencies: DependencyInfo[];
  lastUpdated: number;
}

export interface PropertyDefinition {
  name: string;
  type: string;
  required: boolean;
  description?: string;
  defaultValue?: unknown;
  allowedValues?: unknown[];
  isReference?: boolean;
  referencedType?: string;
}

export interface DependencyInfo {
  resourceType: string;
  name: string;
  type: 'required' | 'optional' | 'recommended';
  propertyPath: string;
  description: string;
}

// Known resource type dependencies based on Bicep property references
const KNOWN_DEPENDENCIES: Record<string, DependencyInfo[]> = {
  'Microsoft.Web/sites': [
    { resourceType: 'Microsoft.Web/serverfarms', name: 'App Service Plan', type: 'required', propertyPath: 'properties.serverFarmId', description: 'App Service Plan is required for hosting' },
    { resourceType: 'Microsoft.Network/virtualNetworks/subnets', name: 'Virtual Network Subnet', type: 'optional', propertyPath: 'properties.virtualNetworkSubnetId', description: 'VNet integration for network isolation' },
  ],
  'Microsoft.Web/sites/functions': [
    { resourceType: 'Microsoft.Web/sites', name: 'Function App', type: 'required', propertyPath: 'parent', description: 'Function must be hosted in a Function App' },
  ],
  'Microsoft.Compute/virtualMachines': [
    { resourceType: 'Microsoft.Network/networkInterfaces', name: 'Network Interface', type: 'required', propertyPath: 'properties.networkProfile.networkInterfaces', description: 'Network interface for VM connectivity' },
    { resourceType: 'Microsoft.Compute/availabilitySets', name: 'Availability Set', type: 'optional', propertyPath: 'properties.availabilitySet.id', description: 'Availability set for high availability' },
  ],
  'Microsoft.Network/networkInterfaces': [
    { resourceType: 'Microsoft.Network/virtualNetworks/subnets', name: 'Subnet', type: 'required', propertyPath: 'properties.ipConfigurations[].subnet.id', description: 'Subnet for network interface' },
    { resourceType: 'Microsoft.Network/networkSecurityGroups', name: 'Network Security Group', type: 'recommended', propertyPath: 'properties.networkSecurityGroup.id', description: 'NSG for network security' },
  ],
  'Microsoft.ContainerService/managedClusters': [
    { resourceType: 'Microsoft.OperationalInsights/workspaces', name: 'Log Analytics Workspace', type: 'recommended', propertyPath: 'properties.addonProfiles.omsagent.config.logAnalyticsWorkspaceResourceID', description: 'Log Analytics for monitoring' },
    { resourceType: 'Microsoft.Network/virtualNetworks/subnets', name: 'VNet Subnet', type: 'optional', propertyPath: 'properties.agentPoolProfiles[].vnetSubnetID', description: 'VNet for AKS networking' },
  ],
  'Microsoft.App/containerApps': [
    { resourceType: 'Microsoft.App/managedEnvironments', name: 'Container Apps Environment', type: 'required', propertyPath: 'properties.managedEnvironmentId', description: 'Container Apps Environment is required' },
  ],
  'Microsoft.App/managedEnvironments': [
    { resourceType: 'Microsoft.OperationalInsights/workspaces', name: 'Log Analytics Workspace', type: 'recommended', propertyPath: 'properties.appLogsConfiguration.destination', description: 'Log Analytics for logs' },
    { resourceType: 'Microsoft.Network/virtualNetworks/subnets', name: 'VNet Subnet', type: 'optional', propertyPath: 'properties.vnetConfiguration.infrastructureSubnetId', description: 'VNet for environment' },
  ],
  'Microsoft.Sql/servers/databases': [
    { resourceType: 'Microsoft.Sql/servers', name: 'SQL Server', type: 'required', propertyPath: 'parent', description: 'Database requires a SQL Server' },
  ],
  'Microsoft.Insights/components': [
    { resourceType: 'Microsoft.OperationalInsights/workspaces', name: 'Log Analytics Workspace', type: 'required', propertyPath: 'properties.WorkspaceResourceId', description: 'Log Analytics Workspace is required' },
  ],
  'Microsoft.MachineLearningServices/workspaces': [
    { resourceType: 'Microsoft.Storage/storageAccounts', name: 'Storage Account', type: 'required', propertyPath: 'properties.storageAccount', description: 'Storage account for ML workspace' },
    { resourceType: 'Microsoft.KeyVault/vaults', name: 'Key Vault', type: 'required', propertyPath: 'properties.keyVault', description: 'Key Vault for secrets' },
    { resourceType: 'Microsoft.Insights/components', name: 'Application Insights', type: 'required', propertyPath: 'properties.applicationInsights', description: 'Application Insights for monitoring' },
  ],
  'Microsoft.Synapse/workspaces': [
    { resourceType: 'Microsoft.Storage/storageAccounts', name: 'Data Lake Storage Gen2', type: 'required', propertyPath: 'properties.defaultDataLakeStorage.accountUrl', description: 'Data Lake Storage Gen2 is required' },
  ],
  'Microsoft.Network/applicationGateways': [
    { resourceType: 'Microsoft.Network/virtualNetworks/subnets', name: 'Subnet', type: 'required', propertyPath: 'properties.gatewayIPConfigurations[].subnet.id', description: 'Dedicated subnet for App Gateway' },
    { resourceType: 'Microsoft.Network/publicIPAddresses', name: 'Public IP Address', type: 'required', propertyPath: 'properties.frontendIPConfigurations[].publicIPAddress.id', description: 'Public IP for frontend' },
  ],
  'Microsoft.Network/azureFirewalls': [
    { resourceType: 'Microsoft.Network/virtualNetworks/subnets', name: 'AzureFirewallSubnet', type: 'required', propertyPath: 'properties.ipConfigurations[].subnet.id', description: 'AzureFirewallSubnet is required' },
    { resourceType: 'Microsoft.Network/publicIPAddresses', name: 'Public IP Address', type: 'required', propertyPath: 'properties.ipConfigurations[].publicIPAddress.id', description: 'Public IP for firewall' },
  ],
  'Microsoft.Network/bastionHosts': [
    { resourceType: 'Microsoft.Network/virtualNetworks/subnets', name: 'AzureBastionSubnet', type: 'required', propertyPath: 'properties.ipConfigurations[].subnet.id', description: 'AzureBastionSubnet is required' },
    { resourceType: 'Microsoft.Network/publicIPAddresses', name: 'Public IP Address', type: 'required', propertyPath: 'properties.ipConfigurations[].publicIPAddress.id', description: 'Public IP for Bastion' },
  ],
  'Microsoft.Network/virtualNetworkGateways': [
    { resourceType: 'Microsoft.Network/virtualNetworks/subnets', name: 'GatewaySubnet', type: 'required', propertyPath: 'properties.ipConfigurations[].subnet.id', description: 'GatewaySubnet is required' },
    { resourceType: 'Microsoft.Network/publicIPAddresses', name: 'Public IP Address', type: 'required', propertyPath: 'properties.ipConfigurations[].publicIPAddress.id', description: 'Public IP for VPN Gateway' },
  ],
};

// Cache storage
interface CacheEntry<T> {
  data: T;
  timestamp: number;
}

class SchemaCache {
  private cache: Map<string, CacheEntry<unknown>> = new Map();

  get<T>(key: string): T | null {
    const entry = this.cache.get(key);
    if (!entry) return null;
    if (Date.now() - entry.timestamp > CACHE_TTL_MS) {
      this.cache.delete(key);
      return null;
    }
    return entry.data as T;
  }

  set<T>(key: string, data: T): void {
    this.cache.set(key, { data, timestamp: Date.now() });
  }

  clear(): void {
    this.cache.clear();
  }
}

const schemaCache = new SchemaCache();

/**
 * Fetch the Bicep types index to discover all available resource types
 */
export async function fetchResourceTypesIndex(): Promise<Map<string, string[]>> {
  const cacheKey = 'resource-types-index';
  const cached = schemaCache.get<Map<string, string[]>>(cacheKey);
  if (cached) return cached;

  try {
    const response = await fetch(`${BICEP_TYPES_BASE_URL}/index.json`);
    if (!response.ok) throw new Error(`Failed to fetch index: ${response.status}`);
    
    const data: BicepTypesIndex = await response.json();
    
    // Parse resource types and their API versions
    const resourceTypes = new Map<string, string[]>();
    
    for (const resourceKey of Object.keys(data.resources || {})) {
      // resourceKey format: "microsoft.web/sites@2023-12-01"
      const [typeWithProvider, apiVersion] = resourceKey.split('@');
      const resourceType = typeWithProvider.split('/').map(part => 
        part.charAt(0).toUpperCase() + part.slice(1)
      ).join('/');
      
      // Convert to proper casing: microsoft.web -> Microsoft.Web
      const parts = resourceType.split('/');
      const provider = parts[0].split('.').map(p => p.charAt(0).toUpperCase() + p.slice(1)).join('.');
      const fullType = [provider, ...parts.slice(1)].join('/');
      
      if (!resourceTypes.has(fullType)) {
        resourceTypes.set(fullType, []);
      }
      resourceTypes.get(fullType)!.push(apiVersion);
    }
    
    schemaCache.set(cacheKey, resourceTypes);
    return resourceTypes;
  } catch (error) {
    console.error('Failed to fetch resource types index:', error);
    return new Map();
  }
}

/**
 * Fetch the schema for a specific resource type
 */
export async function fetchResourceSchema(
  resourceType: string, 
  apiVersion?: string
): Promise<AzureResourceSchema | null> {
  const cacheKey = `schema-${resourceType}-${apiVersion || 'latest'}`;
  const cached = schemaCache.get<AzureResourceSchema>(cacheKey);
  if (cached) return cached;

  try {
    // Get available API versions
    const index = await fetchResourceTypesIndex();
    const versions = index.get(resourceType);
    
    if (!versions || versions.length === 0) {
      console.warn(`No API versions found for ${resourceType}`);
      return null;
    }
    
    // Use specified version or latest
    const targetVersion = apiVersion || versions.sort().reverse()[0];
    
    // Construct the path: microsoft.web/2023-12-01/types.json
    const providerPath = resourceType.toLowerCase().split('/')[0];
    const typesUrl = `${BICEP_TYPES_BASE_URL}/${providerPath}/${targetVersion}/types.json`;
    
    const response = await fetch(typesUrl);
    if (!response.ok) {
      console.warn(`Failed to fetch schema for ${resourceType}: ${response.status}`);
      return null;
    }
    
    const typesData = await response.json();
    
    // Parse the types to find our resource
    const schema = parseResourceSchema(resourceType, targetVersion, typesData);
    
    if (schema) {
      schemaCache.set(cacheKey, schema);
    }
    
    return schema;
  } catch (error) {
    console.error(`Failed to fetch schema for ${resourceType}:`, error);
    return null;
  }
}

/**
 * Parse the Bicep types JSON to extract schema for a resource
 */
function parseResourceSchema(
  resourceType: string,
  apiVersion: string,
  typesData: unknown[]
): AzureResourceSchema | null {
  // Find the resource type definition
  const resourceTypeName = resourceType.split('/').slice(1).join('/').toLowerCase();
  
  // The types array contains all type definitions
  // We need to find the one that matches our resource
  const resourceDef = typesData.find((t: unknown) => {
    const type = t as { name?: string; $type?: string };
    return type.name?.toLowerCase().includes(resourceTypeName) && 
           type.$type === 'ResourceType';
  }) as BicepResourceType | undefined;
  
  if (!resourceDef) {
    // Try to extract basic info from the types
    return createBasicSchema(resourceType, apiVersion, typesData);
  }
  
  const properties: PropertyDefinition[] = [];
  const requiredProperties: string[] = [];
  
  // Parse properties
  if (resourceDef.properties) {
    for (const [name, prop] of Object.entries(resourceDef.properties)) {
      const propDef: PropertyDefinition = {
        name,
        type: resolveTypeReference(prop.type, typesData),
        required: (prop.flags ?? 0) & 1 ? true : false, // Flag 1 = Required
        description: prop.description,
      };
      
      properties.push(propDef);
      
      if (propDef.required) {
        requiredProperties.push(name);
      }
    }
  }
  
  // Combine known dependencies with dynamically detected ones
  const knownDeps = KNOWN_DEPENDENCIES[resourceType] || [];
  const detectedDeps = detectDependenciesFromProperties(resourceType, properties, typesData);
  
  // Merge, preferring known (curated) dependencies over detected ones
  const knownTypes = new Set(knownDeps.map(d => d.resourceType));
  const mergedDeps = [
    ...knownDeps,
    ...detectedDeps.filter(d => !knownTypes.has(d.resourceType)),
  ];
  
  return {
    resourceType,
    apiVersion,
    properties,
    requiredProperties,
    dependencies: mergedDeps,
    lastUpdated: Date.now(),
  };
}

/**
 * Create a basic schema when full parsing fails
 */
function createBasicSchema(
  resourceType: string,
  apiVersion: string,
  _typesData: unknown[]
): AzureResourceSchema {
  // Return basic schema with known dependencies
  return {
    resourceType,
    apiVersion,
    properties: [
      { name: 'name', type: 'string', required: true, description: 'Resource name' },
      { name: 'location', type: 'string', required: true, description: 'Azure region' },
      { name: 'tags', type: 'object', required: false, description: 'Resource tags' },
      { name: 'properties', type: 'object', required: false, description: 'Resource properties' },
    ],
    requiredProperties: ['name', 'location'],
    dependencies: KNOWN_DEPENDENCIES[resourceType] || [],
    lastUpdated: Date.now(),
  };
}

/**
 * Resolve a type reference to a readable string
 */
function resolveTypeReference(typeRef: BicepTypeReference, _typesData: unknown[]): string {
  if (typeRef.type) {
    return typeRef.type;
  }
  if (typeRef.$ref) {
    // Reference like "#/0" means index 0 in the types array
    return 'object';
  }
  return 'unknown';
}

/**
 * Dynamic dependency detection patterns
 * These patterns identify property names that typically reference other resources
 */
const RESOURCE_REFERENCE_PATTERNS: Array<{
  pattern: RegExp;
  targetType: (propName: string, resourceType: string) => string;
  name: (propName: string) => string;
  description: (propName: string) => string;
  dependencyType: 'required' | 'optional' | 'recommended';
}> = [
  // Server/Farm references (e.g., serverFarmId -> Microsoft.Web/serverfarms)
  {
    pattern: /serverFarm(Id|ResourceId)?$/i,
    targetType: () => 'Microsoft.Web/serverfarms',
    name: () => 'App Service Plan',
    description: () => 'App Service Plan for hosting',
    dependencyType: 'required',
  },
  // Storage references
  {
    pattern: /storage(Account(Id|ResourceId)?|Uri)?$/i,
    targetType: () => 'Microsoft.Storage/storageAccounts',
    name: () => 'Storage Account',
    description: () => 'Storage account for data',
    dependencyType: 'recommended',
  },
  // Key Vault references
  {
    pattern: /keyVault(Id|Uri|ResourceId)?$/i,
    targetType: () => 'Microsoft.KeyVault/vaults',
    name: () => 'Key Vault',
    description: () => 'Key Vault for secrets and keys',
    dependencyType: 'recommended',
  },
  // Log Analytics references
  {
    pattern: /logAnalytics(Workspace)?(Id|ResourceId)?$/i,
    targetType: () => 'Microsoft.OperationalInsights/workspaces',
    name: () => 'Log Analytics Workspace',
    description: () => 'Log Analytics for monitoring and logging',
    dependencyType: 'recommended',
  },
  // Workspace resource ID patterns
  {
    pattern: /workspaceResourceId$/i,
    targetType: () => 'Microsoft.OperationalInsights/workspaces',
    name: () => 'Log Analytics Workspace',
    description: () => 'Log Analytics workspace for diagnostics',
    dependencyType: 'recommended',
  },
  // Application Insights references
  {
    pattern: /applicationInsights(Id|ResourceId)?$/i,
    targetType: () => 'Microsoft.Insights/components',
    name: () => 'Application Insights',
    description: () => 'Application Insights for monitoring',
    dependencyType: 'recommended',
  },
  // Subnet references
  {
    pattern: /subnet(Id|ResourceId)?$/i,
    targetType: () => 'Microsoft.Network/virtualNetworks/subnets',
    name: () => 'Subnet',
    description: () => 'Virtual network subnet',
    dependencyType: 'optional',
  },
  // VNet references
  {
    pattern: /virtualNetwork(Id|ResourceId)?$/i,
    targetType: () => 'Microsoft.Network/virtualNetworks',
    name: () => 'Virtual Network',
    description: () => 'Virtual network for networking',
    dependencyType: 'optional',
  },
  // Network interface references
  {
    pattern: /networkInterface(Id|s)?$/i,
    targetType: () => 'Microsoft.Network/networkInterfaces',
    name: () => 'Network Interface',
    description: () => 'Network interface for connectivity',
    dependencyType: 'required',
  },
  // NSG references
  {
    pattern: /networkSecurityGroup(Id)?$/i,
    targetType: () => 'Microsoft.Network/networkSecurityGroups',
    name: () => 'Network Security Group',
    description: () => 'Network security group for firewall rules',
    dependencyType: 'recommended',
  },
  // Public IP references
  {
    pattern: /publicIp(Address)?(Id)?$/i,
    targetType: () => 'Microsoft.Network/publicIPAddresses',
    name: () => 'Public IP Address',
    description: () => 'Public IP address',
    dependencyType: 'optional',
  },
  // Managed environment (Container Apps)
  {
    pattern: /managedEnvironment(Id)?$/i,
    targetType: () => 'Microsoft.App/managedEnvironments',
    name: () => 'Container Apps Environment',
    description: () => 'Container Apps managed environment',
    dependencyType: 'required',
  },
  // SQL Server references
  {
    pattern: /sqlServer(Id)?$/i,
    targetType: () => 'Microsoft.Sql/servers',
    name: () => 'SQL Server',
    description: () => 'Azure SQL Server',
    dependencyType: 'required',
  },
  // Container Registry references
  {
    pattern: /containerRegistry(Id|LoginServer)?$/i,
    targetType: () => 'Microsoft.ContainerRegistry/registries',
    name: () => 'Container Registry',
    description: () => 'Azure Container Registry for images',
    dependencyType: 'recommended',
  },
  // Availability Set references
  {
    pattern: /availabilitySet(Id)?$/i,
    targetType: () => 'Microsoft.Compute/availabilitySets',
    name: () => 'Availability Set',
    description: () => 'Availability set for high availability',
    dependencyType: 'optional',
  },
];

/**
 * Dynamically detect dependencies from property definitions
 */
function detectDependenciesFromProperties(
  resourceType: string,
  properties: PropertyDefinition[],
  typesData: unknown[]
): DependencyInfo[] {
  const detected: DependencyInfo[] = [];
  const seenTypes = new Set<string>();

  // Helper to scan property names recursively
  const scanProperties = (props: PropertyDefinition[], path: string = 'properties') => {
    for (const prop of props) {
      const fullPath = `${path}.${prop.name}`;
      
      // Check against patterns
      for (const refPattern of RESOURCE_REFERENCE_PATTERNS) {
        if (refPattern.pattern.test(prop.name)) {
          const targetType = refPattern.targetType(prop.name, resourceType);
          
          // Avoid duplicates
          if (!seenTypes.has(targetType)) {
            seenTypes.add(targetType);
            detected.push({
              resourceType: targetType,
              name: refPattern.name(prop.name),
              type: refPattern.dependencyType,
              propertyPath: fullPath,
              description: refPattern.description(prop.name),
            });
          }
          break;
        }
      }
      
      // Check for explicit resourceId type hints in description
      if (prop.description?.toLowerCase().includes('resource id') ||
          prop.description?.toLowerCase().includes('arm resource id')) {
        const typeMatch = prop.description.match(/microsoft\.[a-z]+\/[a-z]+/i);
        if (typeMatch && !seenTypes.has(typeMatch[0])) {
          seenTypes.add(typeMatch[0]);
          detected.push({
            resourceType: typeMatch[0],
            name: formatPropertyName(prop.name),
            type: prop.required ? 'required' : 'optional',
            propertyPath: fullPath,
            description: prop.description || `Reference to ${typeMatch[0]}`,
          });
        }
      }
    }
  };

  // Parse nested types from typesData if available
  const parseNestedProperties = (typeRef: string): PropertyDefinition[] => {
    if (!typeRef.startsWith('#/')) return [];
    const index = parseInt(typeRef.substring(2), 10);
    const nestedType = typesData[index] as { properties?: Record<string, BicepTypeProperty> } | undefined;
    if (!nestedType?.properties) return [];
    
    return Object.entries(nestedType.properties).map(([name, prop]) => ({
      name,
      type: resolveTypeReference(prop.type, typesData),
      required: (prop.flags ?? 0) & 1 ? true : false,
      description: prop.description,
    }));
  };

  // First scan top-level properties
  scanProperties(properties);

  // Scan nested 'properties' object if it exists
  const propsProperty = properties.find(p => p.name === 'properties');
  if (propsProperty?.type?.startsWith('#/')) {
    const nestedProps = parseNestedProperties(propsProperty.type);
    scanProperties(nestedProps, 'properties');
  }

  return detected;
}

/**
 * Format property name to human readable format
 */
function formatPropertyName(name: string): string {
  return name
    .replace(/([A-Z])/g, ' $1')
    .replace(/^./, str => str.toUpperCase())
    .replace(/Id$/, '')
    .trim();
}

/**
 * Get dependencies for a resource type
 * Always returns at least the known dependencies for the resource type
 */
export async function getResourceDependencies(resourceType: string): Promise<DependencyInfo[]> {
  // First, try to get known dependencies (these are curated and reliable)
  const knownDeps = KNOWN_DEPENDENCIES[resourceType];
  
  // Try to fetch schema for additional/dynamic dependencies
  try {
    const schema = await fetchResourceSchema(resourceType);
    if (schema?.dependencies && schema.dependencies.length > 0) {
      // If we have schema deps, merge with known deps (known take priority)
      if (knownDeps && knownDeps.length > 0) {
        const knownTypes = new Set(knownDeps.map(d => d.resourceType));
        const additionalDeps = schema.dependencies.filter(d => !knownTypes.has(d.resourceType));
        return [...knownDeps, ...additionalDeps];
      }
      return schema.dependencies;
    }
  } catch (error) {
    console.warn(`Failed to fetch schema for ${resourceType}, using known dependencies:`, error);
  }
  
  // Fallback to known dependencies
  if (knownDeps && knownDeps.length > 0) {
    return knownDeps;
  }
  
  // Try case-insensitive lookup as last resort
  const lowerResourceType = resourceType.toLowerCase();
  const matchingKey = Object.keys(KNOWN_DEPENDENCIES).find(
    key => key.toLowerCase() === lowerResourceType
  );
  
  if (matchingKey) {
    return KNOWN_DEPENDENCIES[matchingKey];
  }
  
  return [];
}

/**
 * Check if a resource type has required dependencies
 */
export async function getRequiredDependencies(resourceType: string): Promise<DependencyInfo[]> {
  const deps = await getResourceDependencies(resourceType);
  return deps.filter(d => d.type === 'required');
}

/**
 * Check if a resource type has optional/recommended dependencies
 */
export async function getOptionalDependencies(resourceType: string): Promise<DependencyInfo[]> {
  const deps = await getResourceDependencies(resourceType);
  return deps.filter(d => d.type !== 'required');
}

/**
 * Clear the schema cache
 */
export function clearSchemaCache(): void {
  schemaCache.clear();
}

/**
 * Prefetch schemas for common resource types
 */
export async function prefetchCommonSchemas(): Promise<void> {
  const commonTypes = [
    'Microsoft.Web/sites',
    'Microsoft.Web/serverfarms',
    'Microsoft.Compute/virtualMachines',
    'Microsoft.Network/virtualNetworks',
    'Microsoft.Storage/storageAccounts',
    'Microsoft.ContainerService/managedClusters',
    'Microsoft.App/containerApps',
    'Microsoft.Sql/servers',
    'Microsoft.KeyVault/vaults',
  ];
  
  await Promise.all(commonTypes.map(t => fetchResourceSchema(t)));
}
