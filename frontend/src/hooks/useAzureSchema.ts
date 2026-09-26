/**
 * useAzureSchema - Hook for dynamically fetching Azure resource schemas from Microsoft
 * 
 * This hook fetches the official Azure Bicep types from:
 * https://github.com/Azure/bicep-types-az
 * 
 * Ensures properties are always up-to-date with Microsoft's latest API versions.
 */

import { useState, useEffect, useCallback } from 'react';

// Types for the schema
export interface AzureProperty {
  name: string;
  path: string; // e.g., "properties.serverFarmId"
  type: 'string' | 'boolean' | 'number' | 'object' | 'array' | 'enum';
  required: boolean;
  description?: string;
  defaultValue?: unknown;
  allowedValues?: string[];
  isResourceReference?: boolean;
  referencedResourceType?: string;
  nestedProperties?: AzureProperty[];
}

export interface AzureResourceSchemaDetails {
  resourceType: string;
  apiVersion: string;
  properties: AzureProperty[];
  requiredProperties: string[];
  lastFetched: Date;
}

// Bicep types base URL - official Microsoft repository
const BICEP_TYPES_BASE_URL = 'https://raw.githubusercontent.com/Azure/bicep-types-az/main/generated';

// Cache for schemas - persists across component renders
const schemaCache = new Map<string, { schema: AzureResourceSchemaDetails; timestamp: number }>();
const CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours

// Resource reference patterns for detecting dependencies
const RESOURCE_REFERENCE_PATTERNS: Record<string, string> = {
  serverFarmId: 'Microsoft.Web/serverfarms',
  workspaceResourceId: 'Microsoft.OperationalInsights/workspaces',
  WorkspaceResourceId: 'Microsoft.OperationalInsights/workspaces',
  storageAccountId: 'Microsoft.Storage/storageAccounts',
  keyVaultId: 'Microsoft.KeyVault/vaults',
  subnetId: 'Microsoft.Network/virtualNetworks/subnets',
  virtualNetworkSubnetId: 'Microsoft.Network/virtualNetworks/subnets',
  publicIPAddressId: 'Microsoft.Network/publicIPAddresses',
  networkSecurityGroupId: 'Microsoft.Network/networkSecurityGroups',
  managedEnvironmentId: 'Microsoft.App/managedEnvironments',
  applicationInsightsId: 'Microsoft.Insights/components',
  containerRegistryId: 'Microsoft.ContainerRegistry/registries',
  administratorLoginPassword: 'secure-string', // Mark as sensitive
};

/**
 * Parse Bicep types JSON to extract property definitions
 */
function parseBicepTypes(
  typesData: unknown[],
  resourceType: string,
  apiVersion: string
): AzureResourceSchemaDetails {
  const properties: AzureProperty[] = [];
  const requiredProperties: string[] = [];
  
  // Helper to resolve type references
  const resolveType = (typeRef: { $ref?: string; type?: string }): string => {
    if (typeRef.type) return typeRef.type;
    if (typeRef.$ref) return 'object';
    return 'string';
  };
  
  // Helper to parse flags for required status
  const isRequired = (flags?: number): boolean => {
    // In Bicep types, flag 1 = Required, flag 2 = ReadOnly
    return (flags ?? 0) & 1 ? true : false;
  };
  
  // Find the main resource type definition
  const resourceTypeName = resourceType.split('/').slice(1).join('/').toLowerCase();
  
  // Find types array entries
  for (let i = 0; i < typesData.length; i++) {
    const entry = typesData[i] as Record<string, unknown>;
    
    // Look for ResourceType entries
    if (entry.$type === 'ResourceType' && 
        typeof entry.name === 'string' && 
        entry.name.toLowerCase().includes(resourceTypeName)) {
      
      // Found our resource - now parse its body reference
      const bodyRef = entry.body as { $ref?: string };
      if (bodyRef?.$ref) {
        const bodyIndex = parseInt(bodyRef.$ref.replace('#/', ''), 10);
        const bodyType = typesData[bodyIndex] as Record<string, unknown>;
        
        if (bodyType?.properties) {
          const bodyProps = bodyType.properties as Record<string, unknown>;
          
          // Parse top-level properties (name, location, tags, etc.)
          for (const [propName, propDef] of Object.entries(bodyProps)) {
            const prop = propDef as { type?: { $ref?: string; type?: string }; flags?: number; description?: string };
            
            const azureProp: AzureProperty = {
              name: propName,
              path: propName,
              type: resolveType(prop.type || {}) as AzureProperty['type'],
              required: isRequired(prop.flags),
              description: prop.description,
            };
            
            properties.push(azureProp);
            
            if (azureProp.required) {
              requiredProperties.push(propName);
            }
            
            // If this is the "properties" object, parse its nested properties
            if (propName === 'properties' && prop.type?.$ref) {
              const propsIndex = parseInt(prop.type.$ref.replace('#/', ''), 10);
              const propsType = typesData[propsIndex] as Record<string, unknown>;
              
              if (propsType?.properties) {
                parseNestedProperties(
                  propsType.properties as Record<string, unknown>,
                  'properties',
                  properties,
                  requiredProperties,
                  typesData,
                  resolveType,
                  isRequired
                );
              }
            }
          }
        }
      }
      break;
    }
  }
  
  return {
    resourceType,
    apiVersion,
    properties,
    requiredProperties,
    lastFetched: new Date(),
  };
}

/**
 * Recursively parse nested properties from the properties object
 */
function parseNestedProperties(
  propsObj: Record<string, unknown>,
  parentPath: string,
  properties: AzureProperty[],
  requiredProperties: string[],
  typesData: unknown[],
  resolveType: (ref: { $ref?: string; type?: string }) => string,
  isRequired: (flags?: number) => boolean,
  depth: number = 0
): void {
  // Limit recursion depth to prevent infinite loops
  if (depth > 5) return;
  
  for (const [propName, propDef] of Object.entries(propsObj)) {
    const prop = propDef as { type?: { $ref?: string; type?: string }; flags?: number; description?: string };
    const fullPath = `${parentPath}.${propName}`;
    
    // Check if this is a resource reference
    let isResourceRef = false;
    let refType: string | undefined;
    
    if (RESOURCE_REFERENCE_PATTERNS[propName]) {
      isResourceRef = true;
      refType = RESOURCE_REFERENCE_PATTERNS[propName];
    } else if (propName.endsWith('Id') || propName.endsWith('ResourceId')) {
      isResourceRef = true;
    }
    
    const azureProp: AzureProperty = {
      name: propName,
      path: fullPath,
      type: resolveType(prop.type || {}) as AzureProperty['type'],
      required: isRequired(prop.flags),
      description: prop.description,
      isResourceReference: isResourceRef,
      referencedResourceType: refType,
    };
    
    properties.push(azureProp);
    
    if (azureProp.required) {
      requiredProperties.push(fullPath);
    }
    
    // Parse nested objects (like siteConfig, sku, etc.)
    if (prop.type?.$ref && depth < 3) {
      const nestedIndex = parseInt(prop.type.$ref.replace('#/', ''), 10);
      const nestedType = typesData[nestedIndex] as Record<string, unknown>;
      
      if (nestedType?.properties) {
        parseNestedProperties(
          nestedType.properties as Record<string, unknown>,
          fullPath,
          properties,
          requiredProperties,
          typesData,
          resolveType,
          isRequired,
          depth + 1
        );
      }
    }
  }
}

/**
 * Fetch schema for a resource type from Microsoft's Bicep types
 */
async function fetchSchemaFromMicrosoft(resourceType: string): Promise<AzureResourceSchemaDetails | null> {
  try {
    // First fetch the index to get available API versions
    const indexResponse = await fetch(`${BICEP_TYPES_BASE_URL}/index.json`);
    if (!indexResponse.ok) {
      console.warn('Failed to fetch Bicep types index');
      return null;
    }
    
    const indexData = await indexResponse.json();
    
    // Find matching resource type and get latest API version
    const normalizedType = resourceType.toLowerCase();
    let latestVersion = '';
    let matchingPath = '';
    
    for (const [key, value] of Object.entries(indexData.resources || {})) {
      const [typeWithProvider, version] = key.split('@');
      if (typeWithProvider.toLowerCase() === normalizedType) {
        if (!latestVersion || version > latestVersion) {
          latestVersion = version;
          matchingPath = (value as { relativePath: string }).relativePath;
        }
      }
    }
    
    if (!latestVersion || !matchingPath) {
      console.warn(`No API version or path found for ${resourceType}`);
      return null;
    }
    
    // Fetch the types file
    const typesUrl = `${BICEP_TYPES_BASE_URL}/${matchingPath}`;
    console.log(`[AzureSchema] Fetching types from: ${typesUrl}`);
    const typesResponse = await fetch(typesUrl);
    if (!typesResponse.ok) {
      console.warn(`Failed to fetch types for ${resourceType}: ${typesResponse.status}`);
      return null;
    }
    
    const typesData = await typesResponse.json();
    
    // Parse the schema
    return parseBicepTypes(typesData, resourceType, latestVersion);
  } catch (error) {
    console.error(`Error fetching schema for ${resourceType}:`, error);
    return null;
  }
}

/**
 * Get schema from cache or fetch from Microsoft
 */
async function getSchema(resourceType: string): Promise<AzureResourceSchemaDetails | null> {
  // Check cache first
  const cached = schemaCache.get(resourceType);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.schema;
  }
  
  // Fetch from Microsoft
  const schema = await fetchSchemaFromMicrosoft(resourceType);
  
  if (schema) {
    schemaCache.set(resourceType, {
      schema,
      timestamp: Date.now(),
    });
  }
  
  return schema;
}

/**
 * Hook to use Azure resource schema
 */
export function useAzureSchema(resourceType: string | null) {
  const [schema, setSchema] = useState<AzureResourceSchemaDetails | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  const fetchSchema = useCallback(async (type: string) => {
    setIsLoading(true);
    setError(null);
    
    try {
      const result = await getSchema(type);
      if (result) {
        setSchema(result);
      } else {
        setError(`Could not fetch schema for ${type}`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch schema');
    } finally {
      setIsLoading(false);
    }
  }, []);
  
  useEffect(() => {
    if (resourceType) {
      fetchSchema(resourceType);
    } else {
      setSchema(null);
    }
  }, [resourceType, fetchSchema]);
  
  // Helper to get only required properties
  const getRequiredProperties = useCallback((): AzureProperty[] => {
    if (!schema) return [];
    return schema.properties.filter(p => p.required);
  }, [schema]);
  
  // Helper to get properties by category
  const getPropertiesByPath = useCallback((pathPrefix: string): AzureProperty[] => {
    if (!schema) return [];
    return schema.properties.filter(p => p.path.startsWith(pathPrefix));
  }, [schema]);
  
  // Helper to get top-level properties
  const getTopLevelProperties = useCallback((): AzureProperty[] => {
    if (!schema) return [];
    return schema.properties.filter(p => !p.path.includes('.'));
  }, [schema]);
  
  // Helper to get properties.* level
  const getConfigProperties = useCallback((): AzureProperty[] => {
    if (!schema) return [];
    return schema.properties.filter(
      p => p.path.startsWith('properties.') && p.path.split('.').length === 2
    );
  }, [schema]);
  
  // Refresh schema from Microsoft
  const refresh = useCallback(() => {
    if (resourceType) {
      schemaCache.delete(resourceType);
      fetchSchema(resourceType);
    }
  }, [resourceType, fetchSchema]);
  
  return {
    schema,
    isLoading,
    error,
    refresh,
    getRequiredProperties,
    getPropertiesByPath,
    getTopLevelProperties,
    getConfigProperties,
    apiVersion: schema?.apiVersion || null,
  };
}

/**
 * Prefetch schemas for common resource types
 */
export async function prefetchCommonSchemas(): Promise<void> {
  // With LOCAL azureSchemaService, we don't need to prefetch from remote Bicep types
  // The local data in azureServices.json is always available immediately
  console.log('[AzureSchema] Using LOCAL azureServices.json - no remote prefetch needed');
  
  // The schemas are already loaded from the local JSON file
  // No network calls = no 404 errors!
}

/**
 * Export for getting schema directly (for use outside React)
 */
export { getSchema as fetchAzureSchema };
