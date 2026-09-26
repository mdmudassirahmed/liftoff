// Azure Service Types

export interface BicepProperties {
  required: string[];
  optional: string[];
}

export interface AzureService {
  id: string;
  name: string;
  resourceType: string;
  category: AzureServiceCategory;
  iconPath: string;
  defaultProperties: Record<string, unknown>;
  requiredProperties?: string[];  // Legacy - use bicepProperties
  bicepProperties?: BicepProperties;
  mcpSchemaId?: string;
  description?: string;
}

export type AzureServiceCategory = 
  | 'Compute'
  | 'Networking'
  | 'Storage'
  | 'Databases'
  | 'AI'
  | 'Analytics'
  | 'Security'
  | 'Integration'
  | 'Containers'
  | 'Web'
  | 'DevOps'
  | 'Identity'
  | 'Management'
  | 'IoT'
  | 'Mobile'
  | 'Media'
  | 'Mixed Reality'
  | 'Migration'
  | 'Monitor'
  | 'Hybrid'
  | 'Other';

export interface GroupTemplate {
  id: string;
  name: string;
  groupType: GroupType;
  defaultSize: { width: number; height: number };
  color: string;
  iconPath?: string;
  description?: string;
}

export type GroupType = 
  | 'resourceGroup'
  | 'virtualNetwork'
  | 'subnet'
  | 'region'
  | 'subscription'
  | 'availabilityZone';

export interface AzureLocation {
  name: string;
  displayName: string;
  regionalDisplayName: string;
}

export interface AzureSku {
  name: string;
  tier: string;
  size?: string;
  family?: string;
  capacity?: number;
}

export interface AzureSubscription {
  id: string;
  subscriptionId: string;
  displayName: string;
  state: 'Enabled' | 'Disabled' | 'Warned' | 'PastDue' | 'Deleted';
  tenantId: string;
}

export interface AzureResourceGroup {
  id: string;
  name: string;
  location: string;
  tags?: Record<string, string>;
}

export interface AzureServiceCatalog {
  services: AzureService[];
  categories: AzureServiceCategory[];
  lastUpdated: string;
}

// Visual-only elements (not exported to IaC)
export interface VisualTemplate {
  id: string;
  name: string;
  iconPath: string;
  color: string;
  description: string;
}
