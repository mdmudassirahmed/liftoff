/**
 * Bicep Schema Fetcher - Dynamic fetching of Azure resource schemas
 * 
 * Uses the official Azure Bicep Types repository as the source of truth:
 * https://github.com/Azure/bicep-types-az
 * 
 * This ensures we always have the latest Azure resource definitions,
 * properties, types, and enum values without manual maintenance.
 * 
 * Based on the Azure Schema Fetching Guide.
 */

// ===== CONSTANTS =====

const BASE_URL = 'https://raw.githubusercontent.com/Azure/bicep-types-az/main/generated';
const INDEX_URL = `${BASE_URL}/index.json`;
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

// Bounds for recursive required-field discovery. Azure bodies can be deep and cyclic,
// so we cap depth and total count and guard against type cycles.
const MAX_REQUIRED_DEPTH = 5;
const MAX_REQUIRED_PATHS = 250;

// ===== TYPES =====

export interface BicepProperty {
  name: string;
  type: string;
  required: boolean;
  readonly: boolean;
  description: string;
  enumValues: string[] | null;
  defaultValue?: unknown;
}

export interface BicepResourceSchema {
  resourceType: string;
  apiVersion: string;
  required: BicepProperty[];
  optional: BicepProperty[];
  nested: Record<string, BicepProperty[]>;
  /**
   * Flattened list of every required property across the whole resource body,
   * including nested ones as dotted paths (e.g. "sku.name", "identity.type").
   * Additive: surfaces required fields the flat `required`/`nested` views miss.
   */
  requiredPaths: BicepProperty[];
  fetchedAt: number;
}

interface IndexEntry {
  $ref: string;
}

interface BicepIndex {
  resources: Record<string, IndexEntry>;
  resourceFunctions: Record<string, unknown>;
}

interface TypeDefinition {
  $type?: string;
  name?: string;
  value?: string;
  flags?: number;
  description?: string;
  properties?: Record<string, TypePropertyDef>;
  elements?: TypeReference[];
  itemType?: TypeReference;
  body?: TypeReference;
  type?: TypeReference;
}

interface TypePropertyDef {
  type?: TypeReference;
  flags?: number;
  description?: string;
}

interface TypeReference {
  $ref?: string;
}

// ===== CACHE =====

interface CacheEntry<T> {
  data: T;
  timestamp: number;
}

class BicepCache {
  private cache = new Map<string, CacheEntry<unknown>>();

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

const cache = new BicepCache();

// ===== HELPER FUNCTIONS =====

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url, {
    headers: { 'User-Agent': 'AzureSchemaFetcher/1.0' },
  });
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.status}`);
  }
  return response.json();
}

function resolveRef(refPath: string, typesList: TypeDefinition[]): TypeDefinition {
  if (!refPath || !refPath.startsWith('#/')) {
    return {};
  }
  const index = parseInt(refPath.split('/').pop() || '0', 10);
  return typesList[index] || {};
}

function getTypeName(typeDef: TypeDefinition, typesList: TypeDefinition[]): string {
  if (!typeDef) return 'any';
  
  const t = typeDef.$type || '';
  
  switch (t) {
    case 'StringType':
      return 'string';
    case 'IntegerType':
      return 'integer';
    case 'BooleanType':
      return 'boolean';
    case 'ArrayType': {
      const itemRef = typeDef.itemType?.$ref;
      if (itemRef) {
        const inner = resolveRef(itemRef, typesList);
        return `array<${getTypeName(inner, typesList)}>`;
      }
      return 'array';
    }
    case 'ObjectType':
      return typeDef.name || 'object';
    case 'UnionType': {
      const elements = typeDef.elements || [];
      const values: string[] = [];
      for (const el of elements.slice(0, 4)) {
        if (el.$ref) {
          const inner = resolveRef(el.$ref, typesList);
          values.push(getTypeName(inner, typesList));
        }
      }
      const suffix = elements.length > 4 ? '...' : '';
      return values.length > 0 ? values.join(' | ') + suffix : 'union';
    }
    case 'StringLiteralType':
      return `"${typeDef.value || ''}"`;
    default:
      return typeDef.name || t || 'any';
  }
}

function getEnumValues(typeDef: TypeDefinition, typesList: TypeDefinition[]): string[] | null {
  if (typeDef.$type !== 'UnionType') {
    return null;
  }
  
  const values: string[] = [];
  for (const el of typeDef.elements || []) {
    if (el.$ref) {
      const inner = resolveRef(el.$ref, typesList);
      if (inner.$type === 'StringLiteralType' && inner.value) {
        values.push(inner.value);
      }
    }
  }
  return values.length > 0 ? values : null;
}

/**
 * Recursively collect required properties of a resource body, descending through
 * required object types (and the canonical top-level `properties` container) to surface
 * nested required fields as dotted paths (e.g. "sku.name", "siteConfig.linuxFxVersion").
 *
 * Strict "must provide" semantics: only descends into objects that are themselves
 * required (or the `properties` container), so it never over-claims conditionally
 * required fields. Bounded by depth and total count and cycle-guarded on type $ref,
 * so it is safe on large or recursive Azure schemas.
 */
function collectRequiredPaths(
  objType: TypeDefinition,
  typesList: TypeDefinition[],
  prefix: string,
  depth: number,
  visited: Set<string>,
  out: BicepProperty[]
): void {
  if (depth > MAX_REQUIRED_DEPTH || out.length >= MAX_REQUIRED_PATHS) return;
  if (!objType || !objType.properties) return;

  for (const [name, def] of Object.entries(objType.properties)) {
    if (out.length >= MAX_REQUIRED_PATHS) break;

    const flags = def.flags || 0;
    if (flags & 2) continue; // skip readonly
    const required = Boolean(flags & 1);

    const ref = def.type?.$ref;
    const resolved: TypeDefinition = ref ? resolveRef(ref, typesList) : {};
    const isObject = resolved.$type === 'ObjectType';
    // The bare top-level `properties` object is a container, not a user field; its
    // children are named without a `properties.` prefix to match the existing UI.
    const isContainer = name === 'properties' && prefix === '';
    const path = prefix ? `${prefix}.${name}` : name;

    const shouldDescend =
      isObject &&
      (required || isContainer) &&
      !!ref &&
      !visited.has(ref) &&
      depth < MAX_REQUIRED_DEPTH;

    if (shouldDescend) {
      const before = out.length;
      const nextVisited = new Set(visited);
      nextVisited.add(ref as string);
      collectRequiredPaths(
        resolved,
        typesList,
        isContainer ? '' : path,
        depth + 1,
        nextVisited,
        out
      );
      // A required object that contributed no required descendants is surfaced itself,
      // so it isn't silently dropped (the bare container is never surfaced).
      if (out.length === before && required && !isContainer) {
        out.push({
          name: path,
          type: getTypeName(resolved, typesList),
          required: true,
          readonly: false,
          description: (def.description || '').slice(0, 200),
          enumValues: getEnumValues(resolved, typesList),
        });
      }
    } else if (required) {
      out.push({
        name: path,
        type: getTypeName(resolved, typesList),
        required: true,
        readonly: false,
        description: (def.description || '').slice(0, 200),
        enumValues: getEnumValues(resolved, typesList),
      });
    }
  }
}

// ===== MAIN API =====

/**
 * Get the Bicep types index (cached)
 */
export async function getIndex(): Promise<BicepIndex> {
  const cached = cache.get<BicepIndex>('index');
  if (cached) return cached;
  
  console.log('[BicepSchema] Fetching index...');
  const index = await fetchJson<BicepIndex>(INDEX_URL);
  console.log(`[BicepSchema] Loaded ${Object.keys(index.resources).length} resource definitions`);
  cache.set('index', index);
  return index;
}

/**
 * Get types file for a provider path (cached)
 */
async function getTypes(filePath: string): Promise<TypeDefinition[]> {
  const cacheKey = `types:${filePath}`;
  const cached = cache.get<TypeDefinition[]>(cacheKey);
  if (cached) return cached;
  
  const url = `${BASE_URL}/${filePath}`;
  console.log(`[BicepSchema] Fetching types from ${filePath}`);
  const types = await fetchJson<TypeDefinition[]>(url);
  cache.set(cacheKey, types);
  return types;
}

/**
 * Get schema for an Azure resource type
 * 
 * @param resourceType - e.g., "Microsoft.Web/sites", "Microsoft.Sql/servers"
 * @param apiVersion - Optional. If not provided, uses latest.
 * @returns The resource schema with required/optional properties
 */
export async function getResourceSchema(
  resourceType: string,
  apiVersion?: string
): Promise<BicepResourceSchema | null> {
  const cacheKey = `schema:${resourceType}@${apiVersion || 'latest'}`;
  const cached = cache.get<BicepResourceSchema>(cacheKey);
  if (cached) return cached;
  
  try {
    const index = await getIndex();
    const resources = index.resources || {};
    
    // Find matching resource (latest version if not specified)
    let targetKey: string | null = null;
    
    if (apiVersion) {
      targetKey = `${resourceType}@${apiVersion}`;
      if (!resources[targetKey]) {
        // Try lowercase
        const lowerKey = targetKey.toLowerCase();
        targetKey = Object.keys(resources).find(k => k.toLowerCase() === lowerKey) || null;
      }
    }
    
    if (!targetKey) {
      // Find latest version - sort descending and take first match
      const normalizedType = resourceType.toLowerCase();
      const matchingKeys = Object.keys(resources)
        .filter(key => key.toLowerCase().startsWith(`${normalizedType}@`))
        .sort()
        .reverse();
      
      targetKey = matchingKeys[0] || null;
    }
    
    if (!targetKey) {
      console.warn(`[BicepSchema] Resource type '${resourceType}' not found`);
      return null;
    }
    
    // Parse the $ref: "web/microsoft.web/2025-03-01/types.json#/564"
    const ref = resources[targetKey]?.$ref || '';
    if (!ref) {
      console.warn(`[BicepSchema] No $ref found for ${targetKey}`);
      return null;
    }
    
    const [filePath, typeIndexStr] = ref.split('#/');
    const typeIndex = parseInt(typeIndexStr, 10);
    
    // Fetch types file
    const typesList = await getTypes(filePath);
    
    // Get resource definition
    const resourceDef = typesList[typeIndex];
    if (!resourceDef) {
      console.warn(`[BicepSchema] Resource definition not found at index ${typeIndex}`);
      return null;
    }
    
    // Get body (contains properties)
    const bodyRef = resourceDef.body?.$ref || '';
    if (!bodyRef) {
      console.warn(`[BicepSchema] No body reference found for ${targetKey}`);
      return null;
    }
    
    const bodyType = resolveRef(bodyRef, typesList);
    
    // Extract properties
    const required: BicepProperty[] = [];
    const optional: BicepProperty[] = [];
    const nested: Record<string, BicepProperty[]> = {};
    
    for (const [propName, propDef] of Object.entries(bodyType.properties || {})) {
      const flags = propDef.flags || 0;
      const isRequired = Boolean(flags & 1);
      const isReadonly = Boolean(flags & 2);
      
      // Resolve type
      const typeRef = propDef.type?.$ref;
      let resolvedType: TypeDefinition = {};
      let typeName = 'any';
      let enumValues: string[] | null = null;
      
      if (typeRef) {
        resolvedType = resolveRef(typeRef, typesList);
        typeName = getTypeName(resolvedType, typesList);
        enumValues = getEnumValues(resolvedType, typesList);
        
        // If it's an ObjectType and is the "properties" field, extract nested properties
        if (resolvedType.$type === 'ObjectType' && propName === 'properties') {
          const nestedProps: BicepProperty[] = [];
          
          for (const [nestedName, nestedDef] of Object.entries(resolvedType.properties || {})) {
            const nFlags = nestedDef.flags || 0;
            const nTypeRef = nestedDef.type?.$ref;
            let nResolved: TypeDefinition = {};
            
            if (nTypeRef) {
              nResolved = resolveRef(nTypeRef, typesList);
            }
            
            nestedProps.push({
              name: nestedName,
              type: getTypeName(nResolved, typesList),
              required: Boolean(nFlags & 1),
              readonly: Boolean(nFlags & 2),
              description: (nestedDef.description || '').slice(0, 200),
              enumValues: getEnumValues(nResolved, typesList),
            });
          }
          
          // Sort: required first, then alphabetically
          nested['properties'] = nestedProps.sort((a, b) => {
            if (a.required !== b.required) return a.required ? -1 : 1;
            return a.name.localeCompare(b.name);
          });
        }
      }
      
      const prop: BicepProperty = {
        name: propName,
        type: typeName,
        required: isRequired,
        readonly: isReadonly,
        description: (propDef.description || '').slice(0, 200),
        enumValues,
      };
      
      if (isRequired) {
        required.push(prop);
      } else {
        optional.push(prop);
      }
    }
    
    // Sort properties
    required.sort((a, b) => a.name.localeCompare(b.name));
    optional.sort((a, b) => a.name.localeCompare(b.name));

    // Recursively discover every required field (including nested) as dotted paths.
    // Fully guarded: on any failure we fall back to an empty list so the flat
    // required/optional/nested output is never affected.
    let requiredPaths: BicepProperty[] = [];
    try {
      const collected: BicepProperty[] = [];
      collectRequiredPaths(bodyType, typesList, '', 0, new Set<string>(), collected);
      // Dedupe by path (keep first) and sort alphabetically.
      const seen = new Set<string>();
      requiredPaths = collected
        .filter((p) => (seen.has(p.name) ? false : (seen.add(p.name), true)))
        .sort((a, b) => a.name.localeCompare(b.name));
    } catch (err) {
      console.warn('[BicepSchema] Required-path discovery failed, using empty set:', err);
      requiredPaths = [];
    }

    // Extract version from key
    const [, version] = targetKey.split('@');

    const schema: BicepResourceSchema = {
      resourceType: targetKey.split('@')[0],
      apiVersion: version,
      required,
      optional,
      nested,
      requiredPaths,
      fetchedAt: Date.now(),
    };
    
    cache.set(cacheKey, schema);
    return schema;
    
  } catch (error) {
    console.error(`[BicepSchema] Failed to fetch schema for ${resourceType}:`, error);
    return null;
  }
}

/**
 * List all available resource types for a provider
 * 
 * @param provider - Optional filter, e.g., "Microsoft.Web", "Microsoft.Sql"
 * @returns List of unique resource types (without version)
 */
export async function listAvailableResources(provider?: string): Promise<string[]> {
  const index = await getIndex();
  const resources = index.resources || {};
  
  const uniqueTypes = new Set<string>();
  
  for (const key of Object.keys(resources)) {
    const baseType = key.split('@')[0];
    if (!provider || baseType.toLowerCase().startsWith(provider.toLowerCase())) {
      uniqueTypes.add(baseType);
    }
  }
  
  return Array.from(uniqueTypes).sort();
}

/**
 * Get API versions available for a resource type
 */
export async function getApiVersions(resourceType: string): Promise<string[]> {
  const index = await getIndex();
  const resources = index.resources || {};
  const normalizedType = resourceType.toLowerCase();
  
  const versions: string[] = [];
  
  for (const key of Object.keys(resources)) {
    if (key.toLowerCase().startsWith(`${normalizedType}@`)) {
      const version = key.split('@')[1];
      if (version) {
        versions.push(version);
      }
    }
  }
  
  return versions.sort().reverse(); // Latest first
}

/**
 * Clear the schema cache
 */
export function clearSchemaCache(): void {
  cache.clear();
  console.log('[BicepSchema] Cache cleared');
}

/**
 * Prefetch schemas for common resource types
 */
export async function prefetchCommonSchemas(): Promise<void> {
  const commonTypes = [
    'Microsoft.Web/sites',
    'Microsoft.Web/serverfarms',
    'Microsoft.Sql/servers',
    'Microsoft.Sql/servers/databases',
    'Microsoft.Storage/storageAccounts',
    'Microsoft.Insights/components',
    'Microsoft.OperationalInsights/workspaces',
    'Microsoft.ManagedIdentity/userAssignedIdentities',
    'Microsoft.App/containerApps',
    'Microsoft.App/managedEnvironments',
    'Microsoft.KeyVault/vaults',
    'Microsoft.ContainerRegistry/registries',
  ];
  
  console.log('[BicepSchema] Prefetching common schemas...');
  
  await Promise.all(commonTypes.map(type => 
    getResourceSchema(type).catch(err => 
      console.warn(`[BicepSchema] Failed to prefetch ${type}:`, err)
    )
  ));
  
  console.log('[BicepSchema] Prefetch complete');
}
