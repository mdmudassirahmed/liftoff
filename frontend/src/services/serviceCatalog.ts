/**
 * Azure Service Catalog - Dynamic Service Discovery
 * 
 * Provides a dynamic catalog of Azure services using the Azure Bicep Types repository.
 * This replaces static JSON files with live data from official Microsoft sources.
 */

import { fetchResourceTypesIndex, fetchResourceSchema } from './azureSchemaService';
import { getResourceIcon, type IconResult } from './azureIconService';

// Cache configuration
const CATALOG_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const STORAGE_KEY = 'azure-service-catalog-cache';

/**
 * Azure service definition for the canvas
 */
export interface AzureService {
  id: string;
  name: string;
  resourceType: string;
  category: string;
  description: string;
  icon: IconResult | null;
  apiVersions: string[];
  latestApiVersion: string;
  isContainer?: boolean;
  properties?: PropertyDefinition[];
}

export interface PropertyDefinition {
  name: string;
  path: string;
  type: 'string' | 'number' | 'boolean' | 'select' | 'object' | 'array';
  description?: string;
  required?: boolean;
  default?: unknown;
  enum?: string[];
  minLength?: number;
  maxLength?: number;
  minimum?: number;
  maximum?: number;
  pattern?: string;
}

export interface ServiceCategory {
  id: string;
  name: string;
  icon: string;
  services: AzureService[];
}

// Category mapping for Azure resource providers
const PROVIDER_CATEGORY_MAP: Record<string, { name: string; icon: string }> = {
  'Microsoft.Compute': { name: 'Compute', icon: 'mdi:server' },
  'Microsoft.Web': { name: 'Web & App Services', icon: 'mdi:web' },
  'Microsoft.ContainerService': { name: 'Containers', icon: 'mdi:docker' },
  'Microsoft.App': { name: 'Container Apps', icon: 'mdi:docker' },
  'Microsoft.ContainerRegistry': { name: 'Containers', icon: 'mdi:docker' },
  'Microsoft.ContainerInstance': { name: 'Containers', icon: 'mdi:docker' },
  'Microsoft.Sql': { name: 'Databases', icon: 'mdi:database' },
  'Microsoft.DocumentDB': { name: 'Databases', icon: 'mdi:database' },
  'Microsoft.DBforMySQL': { name: 'Databases', icon: 'mdi:database' },
  'Microsoft.DBforPostgreSQL': { name: 'Databases', icon: 'mdi:database' },
  'Microsoft.DBforMariaDB': { name: 'Databases', icon: 'mdi:database' },
  'Microsoft.Cache': { name: 'Databases', icon: 'mdi:memory' },
  'Microsoft.Network': { name: 'Networking', icon: 'mdi:lan' },
  'Microsoft.Storage': { name: 'Storage', icon: 'mdi:harddisk' },
  'Microsoft.KeyVault': { name: 'Security', icon: 'mdi:key-variant' },
  'Microsoft.ManagedIdentity': { name: 'Security', icon: 'mdi:shield-account' },
  'Microsoft.Authorization': { name: 'Security', icon: 'mdi:shield-lock' },
  'Microsoft.Insights': { name: 'Monitoring', icon: 'mdi:chart-line' },
  'Microsoft.OperationalInsights': { name: 'Monitoring', icon: 'mdi:text-search' },
  'Microsoft.AlertsManagement': { name: 'Monitoring', icon: 'mdi:alert' },
  'Microsoft.Logic': { name: 'Integration', icon: 'mdi:workflow' },
  'Microsoft.EventHub': { name: 'Integration', icon: 'mdi:message-flash' },
  'Microsoft.ServiceBus': { name: 'Integration', icon: 'mdi:bus' },
  'Microsoft.EventGrid': { name: 'Integration', icon: 'mdi:grid' },
  'Microsoft.ApiManagement': { name: 'Integration', icon: 'mdi:api' },
  'Microsoft.CognitiveServices': { name: 'AI & Machine Learning', icon: 'mdi:brain' },
  'Microsoft.MachineLearningServices': { name: 'AI & Machine Learning', icon: 'mdi:robot' },
  'Microsoft.Search': { name: 'AI & Machine Learning', icon: 'mdi:magnify' },
  'Microsoft.DataFactory': { name: 'Analytics', icon: 'mdi:factory' },
  'Microsoft.Synapse': { name: 'Analytics', icon: 'mdi:database-sync' },
  'Microsoft.Databricks': { name: 'Analytics', icon: 'mdi:fire' },
  'Microsoft.StreamAnalytics': { name: 'Analytics', icon: 'mdi:stream' },
  'Microsoft.Devices': { name: 'IoT', icon: 'mdi:devices' },
  'Microsoft.DigitalTwins': { name: 'IoT', icon: 'mdi:cube-outline' },
  'Microsoft.SignalRService': { name: 'Web & App Services', icon: 'mdi:signal' },
  'Microsoft.Resources': { name: 'Management', icon: 'mdi:folder-cog' },
};

// Priority services to always include
const PRIORITY_SERVICES: string[] = [
  // Compute
  'Microsoft.Compute/virtualMachines',
  'Microsoft.Compute/virtualMachineScaleSets',
  'Microsoft.Compute/availabilitySets',
  
  // Web
  'Microsoft.Web/sites',
  'Microsoft.Web/serverfarms',
  'Microsoft.Web/staticSites',
  
  // Containers
  'Microsoft.ContainerService/managedClusters',
  'Microsoft.App/containerApps',
  'Microsoft.App/managedEnvironments',
  'Microsoft.ContainerRegistry/registries',
  'Microsoft.ContainerInstance/containerGroups',
  
  // Databases
  'Microsoft.Sql/servers',
  'Microsoft.DocumentDB/databaseAccounts',
  'Microsoft.Cache/redis',
  'Microsoft.DBforMySQL/flexibleServers',
  'Microsoft.DBforPostgreSQL/flexibleServers',
  
  // Networking
  'Microsoft.Network/virtualNetworks',
  'Microsoft.Network/networkSecurityGroups',
  'Microsoft.Network/loadBalancers',
  'Microsoft.Network/applicationGateways',
  'Microsoft.Network/publicIPAddresses',
  'Microsoft.Network/networkInterfaces',
  'Microsoft.Network/privateDnsZones',
  'Microsoft.Network/azureFirewalls',
  'Microsoft.Network/bastionHosts',
  'Microsoft.Network/frontDoors',
  'Microsoft.Network/privateEndpoints',
  'Microsoft.Network/virtualNetworkGateways',
  
  // Storage
  'Microsoft.Storage/storageAccounts',
  
  // Security
  'Microsoft.KeyVault/vaults',
  'Microsoft.ManagedIdentity/userAssignedIdentities',
  
  // Monitoring
  'Microsoft.Insights/components',
  'Microsoft.OperationalInsights/workspaces',
  
  // Integration
  'Microsoft.Logic/workflows',
  'Microsoft.EventHub/namespaces',
  'Microsoft.ServiceBus/namespaces',
  'Microsoft.EventGrid/topics',
  'Microsoft.ApiManagement/service',
  
  // AI/ML
  'Microsoft.CognitiveServices/accounts',
  'Microsoft.MachineLearningServices/workspaces',
  'Microsoft.Search/searchServices',
  
  // Analytics
  'Microsoft.DataFactory/factories',
  'Microsoft.Synapse/workspaces',
  'Microsoft.Databricks/workspaces',
  
  // IoT
  'Microsoft.Devices/IotHubs',
  
  // Resource Groups (containers)
  'Microsoft.Resources/resourceGroups',
];

// Container resource types that can contain other resources
const CONTAINER_RESOURCE_TYPES = new Set([
  'Microsoft.Resources/resourceGroups',
  'Microsoft.Network/virtualNetworks',
  'Microsoft.ContainerService/managedClusters',
  'Microsoft.App/managedEnvironments',
]);

// Cache implementation
interface CatalogCacheEntry {
  services: AzureService[];
  categories: ServiceCategory[];
  timestamp: number;
}

class ServiceCatalogCache {
  private cache: CatalogCacheEntry | null = null;

  constructor() {
    this.loadFromStorage();
  }

  private loadFromStorage(): void {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const data = JSON.parse(stored) as CatalogCacheEntry;
        if (Date.now() - data.timestamp < CATALOG_CACHE_TTL_MS) {
          this.cache = data;
        }
      }
    } catch {
      // Ignore storage errors
    }
  }

  private saveToStorage(): void {
    if (!this.cache) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.cache));
    } catch {
      // Ignore storage errors
    }
  }

  get(): CatalogCacheEntry | null {
    if (!this.cache) return null;
    if (Date.now() - this.cache.timestamp > CATALOG_CACHE_TTL_MS) {
      this.cache = null;
      return null;
    }
    return this.cache;
  }

  set(services: AzureService[], categories: ServiceCategory[]): void {
    this.cache = { services, categories, timestamp: Date.now() };
    this.saveToStorage();
  }

  clear(): void {
    this.cache = null;
    localStorage.removeItem(STORAGE_KEY);
  }
}

const catalogCache = new ServiceCatalogCache();

/**
 * Convert resource type to display name
 */
function resourceTypeToName(resourceType: string): string {
  const parts = resourceType.split('/');
  if (parts.length < 2) return resourceType;
  
  const typeName = parts[parts.length - 1];
  
  // Convert camelCase to Title Case with spaces
  return typeName
    .replace(/([A-Z])/g, ' $1')
    .replace(/^./, (str) => str.toUpperCase())
    .replace(/^ /, '')
    .replace(/([a-z])([A-Z])/g, '$1 $2');
}

/**
 * Get category info for a resource type
 */
function getCategoryForResourceType(resourceType: string): { name: string; icon: string } {
  const provider = resourceType.split('/')[0];
  return PROVIDER_CATEGORY_MAP[provider] || { name: 'Other', icon: 'mdi:cloud' };
}

/**
 * Create an AzureService from resource type and API versions
 */
async function createAzureService(
  resourceType: string,
  apiVersions: string[]
): Promise<AzureService> {
  const latestApiVersion = apiVersions[0] || '';
  const category = getCategoryForResourceType(resourceType);
  
  // Get icon asynchronously
  let icon: IconResult | null = null;
  try {
    icon = await getResourceIcon(resourceType);
  } catch {
    // Icon fetch failed, will use default
  }

  // Create base service
  const service: AzureService = {
    id: resourceType.toLowerCase().replace(/[^a-z0-9]/g, '-'),
    name: resourceTypeToName(resourceType),
    resourceType,
    category: category.name,
    description: `Azure ${resourceTypeToName(resourceType)}`,
    icon,
    apiVersions,
    latestApiVersion,
    isContainer: CONTAINER_RESOURCE_TYPES.has(resourceType),
  };

  return service;
}

/**
 * Load properties for a service from its schema
 */
export async function loadServiceProperties(service: AzureService): Promise<PropertyDefinition[]> {
  if (service.properties && service.properties.length > 0) {
    return service.properties;
  }

  try {
    const schema = await fetchResourceSchema(service.resourceType, service.latestApiVersion);
    if (!schema) {
      return [];
    }

    // The schema already has properties parsed as PropertyDefinition[]
    const properties: PropertyDefinition[] = schema.properties.map(prop => ({
      name: prop.name,
      path: prop.name.toLowerCase().replace(/\s+/g, ''),
      type: mapPropertyType(prop.type),
      description: prop.description,
      required: prop.required,
      default: prop.defaultValue,
      enum: prop.allowedValues as string[] | undefined,
    }));

    // Cache properties on service
    service.properties = properties;
    return properties;
  } catch {
    return [];
  }
}

/**
 * Map schema property type to our PropertyDefinition type
 */
function mapPropertyType(schemaType: string): PropertyDefinition['type'] {
  switch (schemaType.toLowerCase()) {
    case 'integer':
    case 'number':
      return 'number';
    case 'boolean':
      return 'boolean';
    case 'array':
      return 'array';
    case 'object':
      return 'object';
    default:
      return 'string';
  }
}

/**
 * Fetch the service catalog with caching
 */
export async function fetchServiceCatalog(): Promise<{
  services: AzureService[];
  categories: ServiceCategory[];
}> {
  // Check cache
  const cached = catalogCache.get();
  if (cached) {
    return { services: cached.services, categories: cached.categories };
  }

  // Fetch resource types index
  const resourceTypesMap = await fetchResourceTypesIndex();
  
  // Filter to priority services first
  const servicesToLoad = PRIORITY_SERVICES.filter((rt) => resourceTypesMap.has(rt));
  
  // Create services in parallel
  const services = await Promise.all(
    servicesToLoad.map(async (resourceType) => {
      const apiVersions = resourceTypesMap.get(resourceType) || [];
      return createAzureService(resourceType, apiVersions);
    })
  );

  // Group services by category
  const categoryMap = new Map<string, AzureService[]>();
  for (const service of services) {
    const existing = categoryMap.get(service.category) || [];
    existing.push(service);
    categoryMap.set(service.category, existing);
  }

  // Create category objects
  const categories: ServiceCategory[] = Array.from(categoryMap.entries()).map(
    ([categoryName, categoryServices]) => {
      const categoryInfo = Object.values(PROVIDER_CATEGORY_MAP).find((c) => c.name === categoryName);
      return {
        id: categoryName.toLowerCase().replace(/[^a-z0-9]/g, '-'),
        name: categoryName,
        icon: categoryInfo?.icon || 'mdi:cloud',
        services: categoryServices.sort((a, b) => a.name.localeCompare(b.name)),
      };
    }
  );

  // Sort categories
  categories.sort((a, b) => a.name.localeCompare(b.name));

  // Cache result
  catalogCache.set(services, categories);

  return { services, categories };
}

/**
 * Get a specific service by resource type
 */
export async function getServiceByResourceType(resourceType: string): Promise<AzureService | null> {
  const { services } = await fetchServiceCatalog();
  return services.find((s) => s.resourceType === resourceType) || null;
}

/**
 * Search services by name or resource type
 */
export async function searchServices(query: string): Promise<AzureService[]> {
  const { services } = await fetchServiceCatalog();
  const lowerQuery = query.toLowerCase();
  
  return services.filter(
    (s) =>
      s.name.toLowerCase().includes(lowerQuery) ||
      s.resourceType.toLowerCase().includes(lowerQuery) ||
      s.category.toLowerCase().includes(lowerQuery)
  );
}

/**
 * Get all services in a category
 */
export async function getServicesByCategory(categoryName: string): Promise<AzureService[]> {
  const { services } = await fetchServiceCatalog();
  return services.filter((s) => s.category === categoryName);
}

/**
 * Clear the service catalog cache (for forcing refresh)
 */
export function clearServiceCatalogCache(): void {
  catalogCache.clear();
}
