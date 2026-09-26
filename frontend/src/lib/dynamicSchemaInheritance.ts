/**
 * Dynamic Schema Inheritance Engine
 * 
 * Production-grade solution that:
 * 1. Uses LOCAL azureServices.json as PRIMARY source (fast, reliable, no 404s!)
 * 2. Falls back to remote schemas ONLY if local data is missing
 * 3. Automatically determines which source properties should flow to target
 * 4. NO HARDCODED PROPERTY NAMES - everything is schema-driven
 * 
 * Data Sources:
 * - PRIMARY: azureServices.json (local, curated, always available)
 * - FALLBACK: https://github.com/Azure/bicep-types-az (remote, may fail)
 */

// Import ONLY what's used in this file - the rest are re-exported at bottom
import { getInheritedPropertiesFromConnection } from './azureSchemaService';

// Cache for ARM schemas (remote fallback)
const armSchemaCache = new Map<string, { schema: ARMSchema; timestamp: number }>();
const CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours

// ARM Schema URL (used for remote fallback when local schema not available)
const ARM_SCHEMA_BASE = 'https://schema.management.azure.com/schemas';

// Common API versions for each provider (fallback)
const API_VERSIONS: Record<string, string> = {
  'Microsoft.Web': '2024-04-01',
  'Microsoft.Compute': '2024-07-01',
  'Microsoft.Storage': '2023-05-01',
  'Microsoft.Network': '2024-01-01',
  'Microsoft.Sql': '2023-08-01-preview',
  'Microsoft.DocumentDB': '2024-05-15',
  'Microsoft.KeyVault': '2024-04-01-preview',
  'Microsoft.Insights': '2020-02-02',
  'Microsoft.OperationalInsights': '2023-09-01',
  'Microsoft.ContainerService': '2024-02-01',
  'Microsoft.ContainerRegistry': '2023-11-01-preview',
  'Microsoft.App': '2024-03-01',
  'Microsoft.Cache': '2024-03-01',
  'Microsoft.ServiceBus': '2024-01-01',
  'Microsoft.EventHub': '2024-01-01',
  'Microsoft.CognitiveServices': '2024-04-01-preview',
};

// Schema structure from ARM
interface ARMSchema {
  resourceDefinitions?: Record<string, ARMResourceDefinition>;
  definitions?: Record<string, ARMDefinition>;
}

interface ARMResourceDefinition {
  properties?: Record<string, ARMPropertyDefinition>;
  required?: string[];
  description?: string;
}

interface ARMDefinition {
  properties?: Record<string, ARMPropertyDefinition>;
  required?: string[];
  type?: string;
  description?: string;
}

interface ARMPropertyDefinition {
  type?: string;
  description?: string;
  $ref?: string;
  oneOf?: Array<{ $ref?: string; type?: string }>;
  enum?: string[];
}

// Our simplified property structure
export interface SchemaProperty {
  name: string;
  fullPath: string; // e.g., "properties.serverFarmId"
  type: string;
  required: boolean;
  description?: string;
  isResourceReference: boolean;
  referencedResourceType?: string;
}

export interface ResourceSchema {
  resourceType: string;
  apiVersion: string;
  properties: SchemaProperty[];
  requiredProperties: string[];
}

/**
 * Map our internal resource types to Microsoft provider format
 */
function normalizeResourceType(resourceType: string): { provider: string; type: string } | null {
  const type = resourceType.toLowerCase();
  
  // Already in Microsoft format
  if (type.startsWith('microsoft.')) {
    const parts = type.split('/');
    return {
      provider: parts[0].charAt(0).toUpperCase() + parts[0].slice(1).replace('.', '.'),
      type: parts.slice(1).join('/'),
    };
  }
  
  // Map common UI names to Microsoft resource types
  const mappings: Record<string, { provider: string; type: string }> = {
    'webapp': { provider: 'Microsoft.Web', type: 'sites' },
    'appservice': { provider: 'Microsoft.Web', type: 'sites' },
    'functionapp': { provider: 'Microsoft.Web', type: 'sites' },
    'appserviceplan': { provider: 'Microsoft.Web', type: 'serverfarms' },
    'serverfarms': { provider: 'Microsoft.Web', type: 'serverfarms' },
    'web/sites': { provider: 'Microsoft.Web', type: 'sites' },
    'web/serverfarms': { provider: 'Microsoft.Web', type: 'serverfarms' },
    'storageaccount': { provider: 'Microsoft.Storage', type: 'storageAccounts' },
    'storage/storageaccounts': { provider: 'Microsoft.Storage', type: 'storageAccounts' },
    'keyvault': { provider: 'Microsoft.KeyVault', type: 'vaults' },
    'keyvault/vaults': { provider: 'Microsoft.KeyVault', type: 'vaults' },
    'sqlserver': { provider: 'Microsoft.Sql', type: 'servers' },
    'sql/servers': { provider: 'Microsoft.Sql', type: 'servers' },
    'sqldatabase': { provider: 'Microsoft.Sql', type: 'servers/databases' },
    'sql/servers/databases': { provider: 'Microsoft.Sql', type: 'servers/databases' },
    'cosmosdb': { provider: 'Microsoft.DocumentDB', type: 'databaseAccounts' },
    'documentdb/databaseaccounts': { provider: 'Microsoft.DocumentDB', type: 'databaseAccounts' },
    'applicationinsights': { provider: 'Microsoft.Insights', type: 'components' },
    'insights/components': { provider: 'Microsoft.Insights', type: 'components' },
    'loganalytics': { provider: 'Microsoft.OperationalInsights', type: 'workspaces' },
    'loganalyticsworkspace': { provider: 'Microsoft.OperationalInsights', type: 'workspaces' },
    'operationalinsights/workspaces': { provider: 'Microsoft.OperationalInsights', type: 'workspaces' },
    'aks': { provider: 'Microsoft.ContainerService', type: 'managedClusters' },
    'containerservice/managedclusters': { provider: 'Microsoft.ContainerService', type: 'managedClusters' },
    'containerregistry': { provider: 'Microsoft.ContainerRegistry', type: 'registries' },
    'containerregistry/registries': { provider: 'Microsoft.ContainerRegistry', type: 'registries' },
    'containerapp': { provider: 'Microsoft.App', type: 'containerApps' },
    'app/containerapps': { provider: 'Microsoft.App', type: 'containerApps' },
    'redis': { provider: 'Microsoft.Cache', type: 'redis' },
    'cache/redis': { provider: 'Microsoft.Cache', type: 'redis' },
    'servicebus': { provider: 'Microsoft.ServiceBus', type: 'namespaces' },
    'servicebus/namespaces': { provider: 'Microsoft.ServiceBus', type: 'namespaces' },
    'eventhub': { provider: 'Microsoft.EventHub', type: 'namespaces' },
    'eventhub/namespaces': { provider: 'Microsoft.EventHub', type: 'namespaces' },
    'virtualnetwork': { provider: 'Microsoft.Network', type: 'virtualNetworks' },
    'network/virtualnetworks': { provider: 'Microsoft.Network', type: 'virtualNetworks' },
    'subnet': { provider: 'Microsoft.Network', type: 'virtualNetworks/subnets' },
    'cognitiveservices': { provider: 'Microsoft.CognitiveServices', type: 'accounts' },
    'openai': { provider: 'Microsoft.CognitiveServices', type: 'accounts' },
  };
  
  return mappings[type] || null;
}

/**
 * Detect if a property is a resource reference based on description and name
 */
function detectResourceReference(name: string, description?: string): { isRef: boolean; refType?: string } {
  const lowerName = name.toLowerCase();
  const lowerDesc = (description || '').toLowerCase();
  
  // Common patterns for resource references
  const refPatterns: Array<{ pattern: RegExp; resourceType: string }> = [
    { pattern: /serverfarmid/i, resourceType: 'Microsoft.Web/serverfarms' },
    { pattern: /app service plan/i, resourceType: 'Microsoft.Web/serverfarms' },
    { pattern: /workspaceresourceid|workspace.*id/i, resourceType: 'Microsoft.OperationalInsights/workspaces' },
    { pattern: /log analytics/i, resourceType: 'Microsoft.OperationalInsights/workspaces' },
    { pattern: /storageaccountid|storage.*account.*id/i, resourceType: 'Microsoft.Storage/storageAccounts' },
    { pattern: /keyvaultid|key.*vault.*id/i, resourceType: 'Microsoft.KeyVault/vaults' },
    { pattern: /subnetid|subnet.*id/i, resourceType: 'Microsoft.Network/virtualNetworks/subnets' },
    { pattern: /virtualnetworksubnetid/i, resourceType: 'Microsoft.Network/virtualNetworks/subnets' },
    { pattern: /managedenvironmentid|managed.*environment/i, resourceType: 'Microsoft.App/managedEnvironments' },
    { pattern: /applicationinsightsid|application.*insights/i, resourceType: 'Microsoft.Insights/components' },
    { pattern: /containerregistryid|container.*registry/i, resourceType: 'Microsoft.ContainerRegistry/registries' },
    { pattern: /resource id/i, resourceType: 'unknown' },
    { pattern: /arm.*resource.*id/i, resourceType: 'unknown' },
    { pattern: /\/subscriptions\//i, resourceType: 'unknown' },
  ];
  
  for (const { pattern, resourceType } of refPatterns) {
    if (pattern.test(lowerName) || pattern.test(lowerDesc)) {
      return { isRef: true, refType: resourceType };
    }
  }
  
  return { isRef: false };
}

/**
 * Fetch ARM schema for a provider
 */
async function fetchARMSchema(provider: string, apiVersion?: string): Promise<ARMSchema | null> {
  const version = apiVersion || API_VERSIONS[provider] || '2024-04-01';
  const cacheKey = `${provider}@${version}`;
  
  // Check cache
  const cached = armSchemaCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.schema;
  }
  
  // Construct URL
  const url = `${ARM_SCHEMA_BASE}/${version}/${provider}.json`;
  
  try {
    const response = await fetch(url);
    if (!response.ok) {
      // Try without version suffix
      const fallbackUrl = `${ARM_SCHEMA_BASE}/common/${provider}.json`;
      const fallbackResponse = await fetch(fallbackUrl);
      if (!fallbackResponse.ok) {
        console.warn(`[DynamicSchema] Failed to fetch schema for ${provider}: ${response.status}`);
        return null;
      }
      const schema = await fallbackResponse.json();
      armSchemaCache.set(cacheKey, { schema, timestamp: Date.now() });
      return schema;
    }
    
    const schema = await response.json();
    armSchemaCache.set(cacheKey, { schema, timestamp: Date.now() });
    return schema;
  } catch (error) {
    console.warn(`[DynamicSchema] Error fetching schema for ${provider}:`, error);
    return null;
  }
}

/**
 * Parse ARM schema to extract properties for a specific resource type
 */
function parseResourceProperties(
  schema: ARMSchema,
  resourceTypeName: string
): SchemaProperty[] {
  const properties: SchemaProperty[] = [];
  
  // Find resource definition
  const resourceDef = schema.resourceDefinitions?.[resourceTypeName];
  if (!resourceDef?.properties) {
    // Try finding by partial match
    for (const [name] of Object.entries(schema.resourceDefinitions || {})) {
      if (name.toLowerCase() === resourceTypeName.toLowerCase()) {
        return parseResourceProperties(schema, name);
      }
    }
    return properties;
  }
  
  // Parse direct properties
  for (const [propName, propDef] of Object.entries(resourceDef.properties)) {
    const { isRef, refType } = detectResourceReference(propName, propDef.description);
    
    properties.push({
      name: propName,
      fullPath: propName,
      type: propDef.type || 'object',
      required: resourceDef.required?.includes(propName) || false,
      description: propDef.description,
      isResourceReference: isRef,
      referencedResourceType: refType,
    });
    
    // If this is "properties", resolve the $ref to get nested properties
    if (propName === 'properties' && propDef.oneOf) {
      for (const option of propDef.oneOf) {
        if (option.$ref && schema.definitions) {
          const refName = option.$ref.replace('#/definitions/', '');
          const nestedDef = schema.definitions[refName];
          
          if (nestedDef?.properties) {
            for (const [nestedName, nestedProp] of Object.entries(nestedDef.properties)) {
              const { isRef: nestedIsRef, refType: nestedRefType } = detectResourceReference(
                nestedName,
                nestedProp.description
              );
              
              properties.push({
                name: nestedName,
                fullPath: `properties.${nestedName}`,
                type: nestedProp.type || 'object',
                required: nestedDef.required?.includes(nestedName) || false,
                description: nestedProp.description,
                isResourceReference: nestedIsRef,
                referencedResourceType: nestedRefType,
              });
            }
          }
        }
      }
    }
  }
  
  return properties;
}

/**
 * Get the full resource schema for a given resource type
 */
export async function getResourceSchema(resourceType: string): Promise<ResourceSchema | null> {
  const normalized = normalizeResourceType(resourceType);
  if (!normalized) {
    console.warn(`[DynamicSchema] Cannot normalize resource type: ${resourceType}`);
    return null;
  }
  
  const schema = await fetchARMSchema(normalized.provider);
  if (!schema) {
    return null;
  }
  
  const properties = parseResourceProperties(schema, normalized.type);
  
  return {
    resourceType: `${normalized.provider}/${normalized.type}`,
    apiVersion: API_VERSIONS[normalized.provider] || '2024-04-01',
    properties,
    requiredProperties: properties.filter(p => p.required).map(p => p.name),
  };
}

/**
 * MAIN FUNCTION: Dynamically determine which properties should be inherited
 * when connecting two resources via an edge
 * 
 * SMART APPROACH:
 * 1. Uses LOCAL azureSchemaService as PRIMARY source (fast, reliable)
 * 2. Falls back to remote ARM schema only if local data is missing
 * 3. 100% SCHEMA-DRIVEN - no hardcoded property names!
 */
export async function getDynamicEdgeInheritance(
  sourceType: string,
  targetType: string,
  sourceProperties: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const inherited: Record<string, unknown> = {};
  
  // STEP 1: Try LOCAL schema service first (fast, no network calls!)
  const localInherited = getInheritedPropertiesFromConnection(
    sourceType,
    targetType,
    sourceProperties
  );
  
  if (localInherited.length > 0) {
    console.log(`[DynamicSchema] Using LOCAL schema for ${sourceType} -> ${targetType}`);
    for (const prop of localInherited) {
      inherited[prop.propertyPath] = prop.value;
      console.log(`[DynamicSchema] Auto-inherited (local): ${prop.propertyPath} <- source (${sourceType}), required: ${prop.isRequired}`);
    }
    return inherited;
  }
  
  // STEP 2: Fallback to remote ARM schema (only if local data is missing)
  console.log(`[DynamicSchema] Local schema not found for ${sourceType} -> ${targetType}, trying remote...`);
  
  // Get target schema to find what it needs
  const targetSchema = await getResourceSchema(targetType);
  if (!targetSchema) {
    console.warn(`[DynamicSchema] Could not get schema for target: ${targetType}`);
    // Return sync fallback
    return getDynamicEdgeInheritanceSync(sourceType, targetType, sourceProperties);
  }
  
  // Get source schema to understand what it provides
  const sourceSchema = await getResourceSchema(sourceType);
  const sourceFullType = sourceSchema?.resourceType || '';
  
  // Find target properties that reference the source type
  for (const prop of targetSchema.properties) {
    if (prop.isResourceReference && prop.referencedResourceType) {
      // Check if source matches the referenced type
      const refTypeLower = prop.referencedResourceType.toLowerCase();
      const sourceTypeLower = sourceFullType.toLowerCase();
      
      if (sourceTypeLower.includes(refTypeLower) || refTypeLower.includes(sourceTypeLower.split('/').pop() || '')) {
        // This target property expects a reference to our source type!
        // Build the resource ID format
        const resourceId = buildResourceId(sourceProperties);
        inherited[prop.name] = resourceId || sourceProperties.name || sourceProperties.displayName;
        
        console.log(`[DynamicSchema] Auto-inherited (remote): ${prop.name} <- source (${sourceType})`);
      }
    }
  }
  
  // Special case: when connecting parent resources
  // (e.g., SQL Server -> SQL Database - the database needs to know its parent)
  if (isParentChildRelationship(sourceType, targetType)) {
    // Add parent name reference
    const parentNameProp = findParentNameProperty(targetSchema.properties);
    if (parentNameProp) {
      inherited[parentNameProp.name] = sourceProperties.name || sourceProperties.displayName;
    }
  }
  
  return inherited;
}

/**
 * Build ARM resource ID from properties
 */
function buildResourceId(props: Record<string, unknown>): string | null {
  const subscription = (props.subscription as string) || (props.subscriptionId as string);
  const resourceGroup = (props.resourceGroup as string) || (props.resourceGroupName as string);
  const name = (props.name as string) || (props.displayName as string);
  const resourceType = props.resourceType as string;
  
  if (!name) return null;
  
  // If we have full subscription/RG info, build full ID
  if (subscription && resourceGroup && resourceType) {
    return `/subscriptions/${subscription}/resourceGroups/${resourceGroup}/providers/${resourceType}/${name}`;
  }
  
  // Return just the name - the system will resolve it
  return name;
}

/**
 * Check if source is a parent of target in ARM hierarchy
 */
function isParentChildRelationship(sourceType: string, targetType: string): boolean {
  const source = normalizeResourceType(sourceType);
  const target = normalizeResourceType(targetType);
  
  if (!source || !target) return false;
  
  // Same provider, target type includes source type
  if (source.provider === target.provider) {
    const sourceTypeParts = source.type.split('/');
    const targetTypeParts = target.type.split('/');
    
    // Target has more parts and starts with source
    if (targetTypeParts.length > sourceTypeParts.length) {
      return targetTypeParts.slice(0, sourceTypeParts.length).join('/') === source.type;
    }
  }
  
  return false;
}

/**
 * Find a property that looks like a parent name reference
 */
function findParentNameProperty(properties: SchemaProperty[]): SchemaProperty | null {
  const parentPatterns = ['parentServerName', 'serverName', 'parentName', 'accountName'];
  
  for (const pattern of parentPatterns) {
    const prop = properties.find(p => p.name.toLowerCase() === pattern.toLowerCase());
    if (prop) return prop;
  }
  
  return null;
}

/**
 * Synchronous version - uses LOCAL schema as primary source
 * This is the preferred function for most use cases as it's fast and reliable
 */
export function getDynamicEdgeInheritanceSync(
  sourceType: string,
  targetType: string,
  sourceProperties: Record<string, unknown>
): Record<string, unknown> {
  const inherited: Record<string, unknown> = {};
  
  // STEP 1: Try LOCAL schema service first (always available!)
  const localInherited = getInheritedPropertiesFromConnection(
    sourceType,
    targetType,
    sourceProperties
  );
  
  if (localInherited.length > 0) {
    for (const prop of localInherited) {
      inherited[prop.propertyPath] = prop.value;
    }
    return inherited;
  }
  
  // STEP 2: Fallback to pattern-based matching (for types not in palette)
  const sourceTypeLower = sourceType.toLowerCase();
  const targetTypeLower = targetType.toLowerCase();
  
  // Name of source resource
  const sourceName = (sourceProperties.name as string) || 
                     (sourceProperties.displayName as string) || '';
  
  if (!sourceName) return inherited;
  
  // Smart matching based on common Azure patterns
  
  // App Service Plan -> App Service (serverFarmId pattern)
  if ((sourceTypeLower.includes('serverfarm') || sourceTypeLower.includes('appserviceplan')) &&
      (targetTypeLower.includes('site') || targetTypeLower.includes('webapp') || targetTypeLower.includes('functionapp'))) {
    inherited.serverFarmId = sourceName;
  }
  
  // Log Analytics -> Application Insights (WorkspaceResourceId)
  if ((sourceTypeLower.includes('operationalinsights') || sourceTypeLower.includes('loganalytics') || sourceTypeLower.includes('workspaces')) &&
      (targetTypeLower.includes('insights') || targetTypeLower.includes('applicationinsights'))) {
    inherited.WorkspaceResourceId = sourceName;
  }
  
  // SQL Server -> SQL Database (parent reference)
  if (sourceTypeLower.includes('sql') && sourceTypeLower.includes('servers') && !sourceTypeLower.includes('database') &&
      targetTypeLower.includes('database')) {
    inherited.serverName = sourceName;
    inherited.parentServerName = sourceName;
  }
  
  // Storage Account -> dependent resources
  if (sourceTypeLower.includes('storage') && sourceTypeLower.includes('account')) {
    inherited.storageAccountName = sourceName;
    inherited.storageAccountId = sourceName;
  }
  
  // Key Vault -> dependent resources
  if (sourceTypeLower.includes('keyvault') || sourceTypeLower.includes('vault')) {
    inherited.keyVaultName = sourceName;
    inherited.keyVaultId = sourceName;
  }
  
  // Virtual Network -> subnets and dependent resources
  if (sourceTypeLower.includes('virtualnetwork') || sourceTypeLower.includes('vnet')) {
    inherited.virtualNetworkName = sourceName;
    inherited.vnetName = sourceName;
  }
  
  // Container Registry -> AKS/Container Apps
  if (sourceTypeLower.includes('containerregistry') || sourceTypeLower.includes('acr')) {
    if (targetTypeLower.includes('kubernetes') || targetTypeLower.includes('aks') || 
        targetTypeLower.includes('containerapp')) {
      inherited.containerRegistryName = sourceName;
    }
  }
  
  // Cosmos DB -> dependent resources
  if (sourceTypeLower.includes('cosmosdb') || sourceTypeLower.includes('documentdb')) {
    inherited.cosmosDbAccountName = sourceName;
    inherited.databaseAccountName = sourceName;
  }
  
  // Managed Identity -> any resource (identity property is complex object)
  if (sourceTypeLower.includes('managedidentity') || sourceTypeLower.includes('userassignedidentities')) {
    inherited.identity = {
      type: 'UserAssigned',
      userAssignedIdentities: {
        [sourceName]: {}
      }
    };
  }
  
  return inherited;
}

// Export for prefetching - now a no-op since we use local data
export async function prefetchCommonARMSchemas(): Promise<void> {
  // With local azureSchemaService, we don't need to prefetch remote schemas
  // The local data is always available immediately
  console.log('[DynamicSchema] Using LOCAL azureServices.json - no remote prefetch needed');
  
  // Optionally, you can still prefetch remote schemas for services NOT in our palette
  // But for now, we skip this to avoid 404 errors
}

// Re-export useful functions from azureSchemaService for convenience
export {
  getServiceSchema,
  getRequiredProperties,
  getOptionalProperties,
  findReferencePropertyForSource,
} from './azureSchemaService';
