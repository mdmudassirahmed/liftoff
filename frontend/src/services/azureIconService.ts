/**
 * Azure Icons Service - Dynamic fetching of official Azure icons
 * 
 * Uses the official Microsoft Azure Icons from:
 * https://github.com/microsoft/azure-icons
 * 
 * Falls back to Iconify fluent-emoji or mdi icons when official icons unavailable
 */

// Icon sources configuration
const AZURE_ICONS_CDN = 'https://raw.githubusercontent.com/microsoft/azure-icons/main/icons';

// Cache configuration
const ICON_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

// Resource type to icon mapping
// This maps Azure resource types to their icon file names
const RESOURCE_TYPE_ICON_MAP: Record<string, string> = {
  // Compute
  'Microsoft.Compute/virtualMachines': 'Virtual-Machine',
  'Microsoft.Compute/virtualMachineScaleSets': 'VM-Scale-Set',
  'Microsoft.Compute/availabilitySets': 'Availability-Set',
  'Microsoft.Compute/disks': 'Disks',
  
  // Web
  'Microsoft.Web/sites': 'App-Service',
  'Microsoft.Web/serverfarms': 'App-Service-Plans',
  'Microsoft.Web/staticSites': 'Static-Web-Apps',
  
  // Containers
  'Microsoft.ContainerService/managedClusters': 'Kubernetes-Services',
  'Microsoft.App/containerApps': 'Container-Apps',
  'Microsoft.App/managedEnvironments': 'Container-Apps-Environments',
  'Microsoft.ContainerRegistry/registries': 'Container-Registries',
  'Microsoft.ContainerInstance/containerGroups': 'Container-Instances',
  
  // Databases
  'Microsoft.Sql/servers': 'SQL-Server',
  'Microsoft.Sql/servers/databases': 'SQL-Database',
  'Microsoft.DocumentDB/databaseAccounts': 'Azure-Cosmos-DB',
  'Microsoft.Cache/redis': 'Cache-Redis',
  'Microsoft.DBforMySQL/flexibleServers': 'Azure-Database-MySQL-Server',
  'Microsoft.DBforPostgreSQL/flexibleServers': 'Azure-Database-PostgreSQL-Server',
  
  // Networking
  'Microsoft.Network/virtualNetworks': 'Virtual-Network',
  'Microsoft.Network/networkSecurityGroups': 'Network-Security-Groups',
  'Microsoft.Network/loadBalancers': 'Load-Balancers',
  'Microsoft.Network/applicationGateways': 'Application-Gateway',
  'Microsoft.Network/publicIPAddresses': 'Public-IP-Addresses',
  'Microsoft.Network/networkInterfaces': 'Network-Interfaces',
  'Microsoft.Network/privateDnsZones': 'DNS-Private-Zones',
  'Microsoft.Network/azureFirewalls': 'Firewall',
  'Microsoft.Network/bastionHosts': 'Bastions',
  'Microsoft.Network/frontDoors': 'Front-Doors',
  'Microsoft.Network/virtualNetworkGateways': 'Virtual-Network-Gateways',
  'Microsoft.Network/expressRouteCircuits': 'ExpressRoute-Circuits',
  'Microsoft.Network/privateEndpoints': 'Private-Endpoints',
  
  // Storage
  'Microsoft.Storage/storageAccounts': 'Storage-Accounts',
  'Microsoft.StorageSync/storageSyncServices': 'Storage-Sync-Services',
  
  // Security
  'Microsoft.KeyVault/vaults': 'Key-Vaults',
  'Microsoft.ManagedIdentity/userAssignedIdentities': 'Managed-Identities',
  
  // Monitoring
  'Microsoft.Insights/components': 'Application-Insights',
  'Microsoft.OperationalInsights/workspaces': 'Log-Analytics-Workspaces',
  'Microsoft.Insights/actionGroups': 'Action-Groups',
  
  // Integration
  'Microsoft.Logic/workflows': 'Logic-Apps',
  'Microsoft.EventHub/namespaces': 'Event-Hubs',
  'Microsoft.ServiceBus/namespaces': 'Service-Bus',
  'Microsoft.EventGrid/topics': 'Event-Grid-Topics',
  'Microsoft.ApiManagement/service': 'API-Management-Services',
  
  // AI/ML
  'Microsoft.CognitiveServices/accounts': 'Cognitive-Services',
  'Microsoft.MachineLearningServices/workspaces': 'Machine-Learning',
  'Microsoft.Search/searchServices': 'Cognitive-Search',
  
  // Analytics
  'Microsoft.DataFactory/factories': 'Data-Factory',
  'Microsoft.Synapse/workspaces': 'Azure-Synapse-Analytics',
  'Microsoft.Databricks/workspaces': 'Azure-Databricks',
  'Microsoft.StreamAnalytics/streamingjobs': 'Stream-Analytics-Jobs',
  
  // IoT
  'Microsoft.Devices/IotHubs': 'IoT-Hub',
  'Microsoft.Devices/provisioningServices': 'Device-Provisioning-Services',
  'Microsoft.DigitalTwins/digitalTwinsInstances': 'Digital-Twins',
  
  // DevOps
  'Microsoft.DevTestLab/labs': 'DevTest-Labs',
};

// Fallback to Iconify icons
const ICONIFY_FALLBACK_MAP: Record<string, string> = {
  // Compute
  'Microsoft.Compute/virtualMachines': 'fluent:server-24-regular',
  'Microsoft.Compute/virtualMachineScaleSets': 'fluent:server-multiple-24-regular',
  'Microsoft.Web/sites': 'fluent:globe-24-regular',
  'Microsoft.Web/serverfarms': 'fluent:server-surface-24-regular',
  
  // Containers
  'Microsoft.ContainerService/managedClusters': 'mdi:kubernetes',
  'Microsoft.App/containerApps': 'mdi:docker',
  'Microsoft.ContainerRegistry/registries': 'mdi:package-variant-closed',
  
  // Databases
  'Microsoft.Sql/servers': 'mdi:database',
  'Microsoft.Sql/servers/databases': 'mdi:database',
  'Microsoft.DocumentDB/databaseAccounts': 'mdi:database-search',
  'Microsoft.Cache/redis': 'mdi:memory',
  
  // Networking
  'Microsoft.Network/virtualNetworks': 'mdi:lan',
  'Microsoft.Network/networkSecurityGroups': 'mdi:shield-network',
  'Microsoft.Network/loadBalancers': 'mdi:scale-balance',
  'Microsoft.Network/applicationGateways': 'mdi:gate',
  'Microsoft.Network/azureFirewalls': 'mdi:fire',
  'Microsoft.Network/bastionHosts': 'mdi:castle',
  
  // Storage
  'Microsoft.Storage/storageAccounts': 'mdi:harddisk',
  
  // Security
  'Microsoft.KeyVault/vaults': 'mdi:key-variant',
  'Microsoft.ManagedIdentity/userAssignedIdentities': 'mdi:card-account-details',
  
  // Monitoring
  'Microsoft.Insights/components': 'mdi:chart-line',
  'Microsoft.OperationalInsights/workspaces': 'mdi:text-search',
  
  // Integration
  'Microsoft.Logic/workflows': 'mdi:workflow',
  'Microsoft.EventHub/namespaces': 'mdi:message-flash',
  'Microsoft.ServiceBus/namespaces': 'mdi:bus',
  'Microsoft.ApiManagement/service': 'mdi:api',
  
  // AI/ML
  'Microsoft.CognitiveServices/accounts': 'mdi:brain',
  'Microsoft.MachineLearningServices/workspaces': 'mdi:robot',
  'Microsoft.Search/searchServices': 'mdi:magnify',
  
  // Default
  'default': 'mdi:cloud',
};

// Icon cache
interface IconCacheEntry {
  url: string;
  available: boolean;
  timestamp: number;
}

class IconCache {
  private cache: Map<string, IconCacheEntry> = new Map();
  private readonly storageKey = 'azure-icon-cache';

  constructor() {
    this.loadFromStorage();
  }

  private loadFromStorage(): void {
    try {
      const stored = localStorage.getItem(this.storageKey);
      if (stored) {
        const data = JSON.parse(stored) as Record<string, IconCacheEntry>;
        const now = Date.now();
        for (const [key, entry] of Object.entries(data)) {
          if (now - entry.timestamp < ICON_CACHE_TTL_MS) {
            this.cache.set(key, entry);
          }
        }
      }
    } catch {
      // Ignore storage errors
    }
  }

  private saveToStorage(): void {
    try {
      const data: Record<string, IconCacheEntry> = {};
      this.cache.forEach((value, key) => {
        data[key] = value;
      });
      localStorage.setItem(this.storageKey, JSON.stringify(data));
    } catch {
      // Ignore storage errors
    }
  }

  get(resourceType: string): IconCacheEntry | null {
    const entry = this.cache.get(resourceType);
    if (!entry) return null;
    if (Date.now() - entry.timestamp > ICON_CACHE_TTL_MS) {
      this.cache.delete(resourceType);
      return null;
    }
    return entry;
  }

  set(resourceType: string, url: string, available: boolean): void {
    this.cache.set(resourceType, { url, available, timestamp: Date.now() });
    this.saveToStorage();
  }
}

const iconCache = new IconCache();

export interface IconResult {
  type: 'svg-url' | 'iconify';
  value: string;
  resourceType: string;
}

/**
 * Get the icon for an Azure resource type
 * Returns either an SVG URL or an Iconify icon name
 */
export async function getResourceIcon(resourceType: string): Promise<IconResult> {
  // Check cache first
  const cached = iconCache.get(resourceType);
  if (cached) {
    if (cached.available) {
      return { type: 'svg-url', value: cached.url, resourceType };
    }
    // Use fallback
    return { 
      type: 'iconify', 
      value: ICONIFY_FALLBACK_MAP[resourceType] || ICONIFY_FALLBACK_MAP['default'],
      resourceType 
    };
  }

  // Try to get the official icon
  const iconName = RESOURCE_TYPE_ICON_MAP[resourceType];
  if (iconName) {
    const svgUrl = `${AZURE_ICONS_CDN}/${iconName}.svg`;
    
    try {
      const response = await fetch(svgUrl, { method: 'HEAD' });
      if (response.ok) {
        iconCache.set(resourceType, svgUrl, true);
        return { type: 'svg-url', value: svgUrl, resourceType };
      }
    } catch {
      // Icon not available, use fallback
    }
  }

  // Use Iconify fallback
  const fallbackIcon = ICONIFY_FALLBACK_MAP[resourceType] || ICONIFY_FALLBACK_MAP['default'];
  iconCache.set(resourceType, fallbackIcon, false);
  
  return { type: 'iconify', value: fallbackIcon, resourceType };
}

/**
 * Get icons for multiple resource types in parallel
 */
export async function getResourceIcons(resourceTypes: string[]): Promise<Map<string, IconResult>> {
  const results = await Promise.all(
    resourceTypes.map(async (rt) => ({ resourceType: rt, icon: await getResourceIcon(rt) }))
  );
  
  const map = new Map<string, IconResult>();
  for (const { resourceType, icon } of results) {
    map.set(resourceType, icon);
  }
  return map;
}

/**
 * Preload icons for common resource types
 */
export async function preloadCommonIcons(): Promise<void> {
  const commonTypes = Object.keys(RESOURCE_TYPE_ICON_MAP);
  await getResourceIcons(commonTypes);
}

/**
 * Get the Iconify icon name for a resource type (synchronous fallback)
 */
export function getIconifyIcon(resourceType: string): string {
  return ICONIFY_FALLBACK_MAP[resourceType] || ICONIFY_FALLBACK_MAP['default'];
}
