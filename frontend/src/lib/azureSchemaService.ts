/**
 * Azure Schema Service
 * 
 * SMART SOLUTION: Uses the local azureServices.json as the source of truth for:
 * - Required properties for each Azure resource type
 * - Optional properties for each Azure resource type
 * - Property inheritance rules (which property links to which resource type)
 * 
 * This is production-grade because:
 * 1. NO external network calls that can fail (like the 404s we saw)
 * 2. Data is curated and accurate for our supported palette services
 * 3. Fast - no latency from remote fetches
 * 4. Can be updated when Azure schema changes
 * 
 * The data in azureServices.json was compiled from official Microsoft sources:
 * - https://github.com/Azure/bicep-types-az (Bicep type definitions)
 * - https://learn.microsoft.com/en-us/azure/templates/ (ARM template reference)
 */

import azureServicesData from '@/data/azureServices.json';

// ===== TYPES =====

export interface BicepPropertyInfo {
  required: string[];
  optional: string[];
}

export interface AzureServiceSchema {
  id: string;
  name: string;
  resourceType: string;
  category: string;
  bicepProperties: BicepPropertyInfo;
}

export interface PropertyInheritanceRule {
  targetProperty: string;        // e.g., "properties.serverFarmId"
  sourceResourceType: string;    // e.g., "Microsoft.Web/serverfarms"
  sourceProperty: string;        // e.g., "id" (the Azure resource ID)
  description: string;
}

export interface InheritedPropertyValue {
  propertyPath: string;
  value: unknown;
  sourceNodeId: string;
  sourceResourceType: string;
  isRequired: boolean;
}

// ===== CACHES =====

// Cache of services indexed by resourceType
const servicesByResourceType = new Map<string, AzureServiceSchema>();
const servicesByNormalizedType = new Map<string, AzureServiceSchema>();

// ===== PROPERTY REFERENCE MAPPINGS =====
// Maps property names to the resource type they reference
// This is the KEY for property inheritance!

const PROPERTY_TO_RESOURCE_TYPE: Record<string, string> = {
  // Web / App Service
  'serverFarmId': 'Microsoft.Web/serverfarms',
  'properties.serverFarmId': 'Microsoft.Web/serverfarms',
  
  // Storage
  'storageAccountId': 'Microsoft.Storage/storageAccounts',
  'properties.storageAccountId': 'Microsoft.Storage/storageAccounts',
  'storageAccountResourceId': 'Microsoft.Storage/storageAccounts',
  'properties.storageAccountResourceId': 'Microsoft.Storage/storageAccounts',
  
  // Networking
  'subnetId': 'Microsoft.Network/virtualNetworks/subnets',
  'properties.subnetId': 'Microsoft.Network/virtualNetworks/subnets',
  'virtualNetworkSubnetId': 'Microsoft.Network/virtualNetworks/subnets',
  'properties.virtualNetworkSubnetId': 'Microsoft.Network/virtualNetworks/subnets',
  'networkSecurityGroupId': 'Microsoft.Network/networkSecurityGroups',
  'properties.networkSecurityGroupId': 'Microsoft.Network/networkSecurityGroups',
  'publicIPAddressId': 'Microsoft.Network/publicIPAddresses',
  'properties.publicIPAddressId': 'Microsoft.Network/publicIPAddresses',
  
  // Container Apps
  'managedEnvironmentId': 'Microsoft.App/managedEnvironments',
  'properties.managedEnvironmentId': 'Microsoft.App/managedEnvironments',
  'environmentId': 'Microsoft.App/managedEnvironments',
  'properties.environmentId': 'Microsoft.App/managedEnvironments',
  
  // Container Registry
  'containerRegistryId': 'Microsoft.ContainerRegistry/registries',
  'properties.containerRegistryId': 'Microsoft.ContainerRegistry/registries',
  'acrResourceId': 'Microsoft.ContainerRegistry/registries',
  
  // Log Analytics / Application Insights
  'workspaceResourceId': 'Microsoft.OperationalInsights/workspaces',
  'properties.workspaceResourceId': 'Microsoft.OperationalInsights/workspaces',
  'WorkspaceResourceId': 'Microsoft.OperationalInsights/workspaces',
  'properties.WorkspaceResourceId': 'Microsoft.OperationalInsights/workspaces',
  'workspaceId': 'Microsoft.OperationalInsights/workspaces',
  'properties.workspaceId': 'Microsoft.OperationalInsights/workspaces',
  'applicationInsightsId': 'Microsoft.Insights/components',
  'properties.applicationInsightsId': 'Microsoft.Insights/components',
  
  // Key Vault
  'keyVaultId': 'Microsoft.KeyVault/vaults',
  'properties.keyVaultId': 'Microsoft.KeyVault/vaults',
  'keyVaultResourceId': 'Microsoft.KeyVault/vaults',
  
  // SQL - Parent/Child relationship
  'parent': 'Microsoft.Sql/servers',  // SQL Database parent reference
  'serverResourceId': 'Microsoft.Sql/servers',
  'properties.serverResourceId': 'Microsoft.Sql/servers',
  'serverName': 'Microsoft.Sql/servers',  // Common pattern for child resources
  
  // Cosmos DB
  'cosmosDbAccountId': 'Microsoft.DocumentDB/databaseAccounts',
  'properties.cosmosDbAccountId': 'Microsoft.DocumentDB/databaseAccounts',
  
  // Service Bus
  'serviceBusNamespaceId': 'Microsoft.ServiceBus/namespaces',
  'properties.serviceBusNamespaceId': 'Microsoft.ServiceBus/namespaces',
  
  // Event Hub
  'eventHubNamespaceId': 'Microsoft.EventHub/namespaces',
  'properties.eventHubNamespaceId': 'Microsoft.EventHub/namespaces',
  
  // Redis
  'redisCacheId': 'Microsoft.Cache/redis',
  'properties.redisCacheId': 'Microsoft.Cache/redis',
  
  // User Assigned Identity
  'userAssignedIdentityId': 'Microsoft.ManagedIdentity/userAssignedIdentities',
};

// ===== INITIALIZATION =====

function initializeCache(): void {
  if (servicesByResourceType.size > 0) return; // Already initialized

  const services = azureServicesData.services as AzureServiceSchema[];
  
  for (const service of services) {
    // Index by exact resourceType
    servicesByResourceType.set(service.resourceType, service);
    servicesByResourceType.set(service.resourceType.toLowerCase(), service);
    
    // Also index by normalized versions
    const normalized = normalizeResourceType(service.resourceType);
    if (normalized) {
      servicesByNormalizedType.set(normalized, service);
    }
    
    // Index by service ID
    servicesByNormalizedType.set(service.id.toLowerCase(), service);
  }
}

function normalizeResourceType(resourceType: string): string {
  return resourceType.toLowerCase().replace(/\s+/g, '');
}

// ===== PUBLIC API =====

/**
 * Get schema information for a resource type
 */
export function getServiceSchema(resourceType: string): AzureServiceSchema | null {
  initializeCache();
  
  // Try exact match first
  let schema = servicesByResourceType.get(resourceType);
  if (schema) return schema;
  
  // Try lowercase
  schema = servicesByResourceType.get(resourceType.toLowerCase());
  if (schema) return schema;
  
  // Try normalized
  schema = servicesByNormalizedType.get(normalizeResourceType(resourceType));
  if (schema) return schema;
  
  return null;
}

/**
 * Get required properties for a resource type
 */
export function getRequiredProperties(resourceType: string): string[] {
  const schema = getServiceSchema(resourceType);
  return schema?.bicepProperties?.required || [];
}

/**
 * Get optional properties for a resource type
 */
export function getOptionalProperties(resourceType: string): string[] {
  const schema = getServiceSchema(resourceType);
  return schema?.bicepProperties?.optional || [];
}

/**
 * Get all properties (required + optional) for a resource type
 */
export function getAllProperties(resourceType: string): { required: string[]; optional: string[] } {
  const schema = getServiceSchema(resourceType);
  return {
    required: schema?.bicepProperties?.required || [],
    optional: schema?.bicepProperties?.optional || [],
  };
}

/**
 * Check if a property is required for a resource type
 */
export function isPropertyRequired(resourceType: string, propertyPath: string): boolean {
  const required = getRequiredProperties(resourceType);
  return required.includes(propertyPath) || 
         required.includes(`properties.${propertyPath}`) ||
         required.some(r => r.endsWith(`.${propertyPath}`));
}

/**
 * Get the resource type that a property references
 */
export function getPropertyReferencedResourceType(propertyPath: string): string | null {
  // Check direct match
  if (PROPERTY_TO_RESOURCE_TYPE[propertyPath]) {
    return PROPERTY_TO_RESOURCE_TYPE[propertyPath];
  }
  
  // Check without 'properties.' prefix
  const withoutPrefix = propertyPath.replace(/^properties\./, '');
  if (PROPERTY_TO_RESOURCE_TYPE[withoutPrefix]) {
    return PROPERTY_TO_RESOURCE_TYPE[withoutPrefix];
  }
  
  // Check just the last part of the path
  const lastPart = propertyPath.split('.').pop() || '';
  if (PROPERTY_TO_RESOURCE_TYPE[lastPart]) {
    return PROPERTY_TO_RESOURCE_TYPE[lastPart];
  }
  
  return null;
}

/**
 * Find which property on a target resource accepts a reference to a source resource type
 * Returns the property path and whether it's required
 */
export function findReferencePropertyForSource(
  targetResourceType: string,
  sourceResourceType: string
): { propertyPath: string; isRequired: boolean } | null {
  const targetSchema = getServiceSchema(targetResourceType);
  if (!targetSchema) return null;
  
  const allProps = [...(targetSchema.bicepProperties?.required || []), ...(targetSchema.bicepProperties?.optional || [])];
  
  // Look through all properties to find one that references the source type
  for (const prop of allProps) {
    const referencedType = getPropertyReferencedResourceType(prop);
    if (referencedType && referencedType.toLowerCase() === sourceResourceType.toLowerCase()) {
      const isRequired = targetSchema.bicepProperties?.required?.includes(prop) || false;
      return { propertyPath: prop, isRequired };
    }
  }
  
  // Fallback: check known mappings
  for (const [propPath, refType] of Object.entries(PROPERTY_TO_RESOURCE_TYPE)) {
    if (refType.toLowerCase() === sourceResourceType.toLowerCase()) {
      // Check if target has this property
      const normalizedProp = propPath.startsWith('properties.') ? propPath : `properties.${propPath}`;
      if (allProps.includes(normalizedProp) || allProps.includes(propPath)) {
        const isRequired = targetSchema.bicepProperties?.required?.includes(normalizedProp) ||
                          targetSchema.bicepProperties?.required?.includes(propPath) || false;
        return { propertyPath: normalizedProp, isRequired };
      }
    }
  }
  
  return null;
}

/**
 * Get inherited properties when connecting a source node to a target node
 * This is the main function used by the diagram store
 */
export function getInheritedPropertiesFromConnection(
  sourceResourceType: string,
  targetResourceType: string,
  sourceNodeData: Record<string, unknown>
): InheritedPropertyValue[] {
  initializeCache();
  
  const result: InheritedPropertyValue[] = [];
  
  // Get source name for reference
  const sourceName = (sourceNodeData.name as string) ||
                     (sourceNodeData.label as string) ||
                     (sourceNodeData.properties as Record<string, unknown>)?.name as string ||
                     '';

  // SPECIAL CASE: Managed Identity → any resource with 'identity' property
  // The identity property is a complex object, not a simple ID reference
  if (sourceResourceType.toLowerCase().includes('managedidentity') || 
      sourceResourceType.toLowerCase().includes('userassignedidentities')) {
    
    const targetSchema = getServiceSchema(targetResourceType);
    const allProps = [...(targetSchema?.bicepProperties?.required || []), ...(targetSchema?.bicepProperties?.optional || [])];
    
    // Check if target has 'identity' property
    if (allProps.includes('identity')) {
      const identityValue = {
        type: 'UserAssigned',
        userAssignedIdentities: {
          [sourceName]: {}
        }
      };
      
      result.push({
        propertyPath: 'identity',
        value: identityValue,
        sourceNodeId: (sourceNodeData.nodeId as string) || 'unknown',
        sourceResourceType,
        isRequired: targetSchema?.bicepProperties?.required?.includes('identity') || false,
      });
      
      console.log('[AzureSchemaService] Managed Identity inheritance:', {
        sourceName,
        targetResourceType,
        identity: identityValue
      });
      
      return result;
    }
  }
  
  // Find which property on target accepts source type
  const refProp = findReferencePropertyForSource(targetResourceType, sourceResourceType);
  
  console.log('[AzureSchemaService] getInheritedPropertiesFromConnection:', {
    sourceResourceType,
    targetResourceType,
    sourceNodeData,
    refProp
  });
  
  if (refProp) {
    // The source provides its ID/reference to the target's reference property
    console.log('[AzureSchemaService] Source name resolution:', {
      'sourceNodeData.name': sourceNodeData.name,
      'sourceNodeData.label': sourceNodeData.label,
      sourceName
    });
    
    // Create a proper resource reference
    // If we have a name, use it; otherwise use a template placeholder
    let sourceRef: string;
    
    if (sourceNodeData.resourceId) {
      // Full ARM resource ID if available
      sourceRef = sourceNodeData.resourceId as string;
    } else if (sourceName) {
      // Use the resource name - this allows Bicep/Terraform to reference it
      // The format depends on export context, but storing the name is most flexible
      sourceRef = sourceName;
    } else {
      // Fallback to template reference
      const resourceTypeName = sourceResourceType.split('/').pop() || 'resource';
      // Convert to camelCase for Bicep-style reference
      const varName = resourceTypeName.replace(/s$/, '').replace(/-/g, '');
      sourceRef = `\${${varName}.id}`;
    }
    
    // Strip 'properties.' prefix since we're storing in the properties object already
    const cleanPropertyPath = refProp.propertyPath.replace(/^properties\./, '');
    
    result.push({
      propertyPath: cleanPropertyPath,
      value: sourceRef,
      sourceNodeId: (sourceNodeData.nodeId as string) || 'unknown',
      sourceResourceType,
      isRequired: refProp.isRequired,
    });
  }
  
  return result;
}

/**
 * Get all services from the palette
 */
export function getAllServices(): AzureServiceSchema[] {
  initializeCache();
  return azureServicesData.services as AzureServiceSchema[];
}

/**
 * Get services by category
 */
export function getServicesByCategory(category: string): AzureServiceSchema[] {
  initializeCache();
  return (azureServicesData.services as AzureServiceSchema[]).filter(
    s => s.category.toLowerCase() === category.toLowerCase()
  );
}

/**
 * Validate that all required properties are present for a resource
 */
export function validateRequiredProperties(
  resourceType: string,
  properties: Record<string, unknown>
): { isValid: boolean; missingProperties: string[] } {
  const required = getRequiredProperties(resourceType);
  const missing: string[] = [];
  
  for (const prop of required) {
    const value = getNestedValue(properties, prop);
    if (value === undefined || value === null || value === '') {
      missing.push(prop);
    }
  }
  
  return {
    isValid: missing.length === 0,
    missingProperties: missing,
  };
}

// ===== HELPER FUNCTIONS =====

function getNestedValue(obj: Record<string, unknown>, path: string): unknown {
  const parts = path.split('.');
  let current: unknown = obj;
  
  for (const part of parts) {
    if (current === null || current === undefined) return undefined;
    if (typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  
  return current;
}

/**
 * Export for debugging/inspection
 */
export function debugGetAllMappings(): Record<string, string> {
  return { ...PROPERTY_TO_RESOURCE_TYPE };
}

/**
 * Export for debugging - get all cached services
 */
export function debugGetCachedServices(): string[] {
  initializeCache();
  return Array.from(servicesByResourceType.keys());
}
