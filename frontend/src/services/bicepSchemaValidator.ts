/**
 * Bicep Schema Validator - Validates Azure resources against live Bicep schemas
 * 
 * Based on the Azure Bicep Types repository for real-time schema validation.
 * This provides production-ready validation for Azure architectures.
 */

import { getResourceSchema, type BicepResourceSchema } from './bicepSchemaFetcher';

// ===== VALIDATION TYPES =====

export type ValidationSeverity = 'error' | 'warning' | 'info';

export interface SchemaValidationIssue {
  id: string;
  severity: ValidationSeverity;
  nodeId: string;
  nodeName: string;
  resourceType: string;
  propertyName: string;
  message: string;
  suggestion?: string;
  apiVersion?: string;
}

export interface SchemaValidationResult {
  isValid: boolean;
  errors: SchemaValidationIssue[];
  warnings: SchemaValidationIssue[];
  infos: SchemaValidationIssue[];
  summary: {
    totalNodes: number;
    validatedNodes: number;
    errorCount: number;
    warningCount: number;
    infoCount: number;
  };
  validatedAt: Date;
}

export interface NodeData {
  id: string;
  type?: string;
  data: {
    label?: string;
    displayName?: string;
    resourceType?: string;
    location?: string;
    region?: string;
    properties?: Record<string, unknown>;
    [key: string]: unknown;
  };
}

export interface EdgeData {
  id: string;
  source: string;
  target: string;
  data?: {
    connectionType?: string;
    [key: string]: unknown;
  };
}

// ===== IMPORTANT PROPERTIES PER RESOURCE TYPE =====
// These are production-critical properties that should be set

const IMPORTANT_PROPERTIES: Record<string, Record<string, string>> = {
  'Microsoft.Web/serverfarms': {
    'sku': 'SKU configuration for the App Service Plan',
    'sku.name': 'SKU name (e.g., P1v3, S1)',
    'sku.tier': 'SKU tier (e.g., PremiumV3, Standard)',
  },
  'Microsoft.Web/sites': {
    'serverFarmId': 'App Service Plan reference (required for hosting)',
    'httpsOnly': 'Enforce HTTPS (recommended: true)',
    'identity': 'Managed identity for secure access',
  },
  'Microsoft.Sql/servers': {
    'administratorLogin': 'SQL admin username (required)',
    'administratorLoginPassword': 'SQL admin password (use Key Vault reference)',
    'minimalTlsVersion': 'Minimum TLS version (recommended: 1.2)',
    'publicNetworkAccess': 'Public network access setting',
  },
  'Microsoft.Sql/servers/databases': {
    'sku': 'Database SKU configuration',
    'maxSizeBytes': 'Maximum database size',
    'collation': 'Database collation',
  },
  'Microsoft.Insights/components': {
    'Application_Type': 'Application type (web, other)',
    'WorkspaceResourceId': 'Log Analytics workspace ID (required)',
  },
  'Microsoft.OperationalInsights/workspaces': {
    'sku': 'Workspace SKU',
    'retentionInDays': 'Data retention period',
  },
  'Microsoft.Storage/storageAccounts': {
    'sku': 'Storage SKU (e.g., Standard_LRS)',
    'kind': 'Storage kind (e.g., StorageV2)',
    'accessTier': 'Access tier (Hot, Cool, Archive)',
  },
  'Microsoft.KeyVault/vaults': {
    'sku': 'Key Vault SKU',
    'tenantId': 'Azure AD tenant ID',
    'accessPolicies': 'Access policies for the vault',
  },
  'Microsoft.ContainerRegistry/registries': {
    'sku': 'Container Registry SKU (Basic, Standard, Premium)',
    'adminUserEnabled': 'Admin user enabled flag',
  },
  'Microsoft.ManagedIdentity/userAssignedIdentities': {
    // Minimal properties needed - just location
  },
};

// Properties that are CRITICAL for production deployment (errors if missing)
const CRITICAL_PROPERTIES: Record<string, string[]> = {
  'Microsoft.Sql/servers': ['administratorLogin', 'administratorLoginPassword'],
  // WorkspaceResourceId and serverFarmId removed: the LLM always generates these
  // references; we suppress false errors via RESOURCE_DEFAULTS instead.
};

// Defaults the LLM always generates for every resource of a given type.
// Merging these into effective properties before validation prevents false
// "missing required" errors for things the user never configures in the diagram.
const RESOURCE_DEFAULTS: Record<string, Record<string, unknown>> = {
  'Microsoft.Storage/storageAccounts': {
    kind: 'StorageV2',
    sku: { name: 'Standard_LRS' },
    accessTier: 'Hot',
  },
  'Microsoft.KeyVault/vaults': {
    sku: { family: 'A', name: 'standard' },
    tenantId: 'subscription().tenantId',
    accessPolicies: [],
  },
  'Microsoft.Web/sites': {
    httpsOnly: true,
    serverFarmId: 'auto-generated',  // LLM always generates the appServicePlan.id reference
    identity: { type: 'SystemAssigned' }, // Guardrail constraints inject managed identity
  },
  'Microsoft.Web/serverfarms': {
    sku: { name: 'Y1', tier: 'Dynamic' },
  },
  'Microsoft.Insights/components': {
    kind: 'web',
    Application_Type: 'web',
    WorkspaceResourceId: 'auto-generated', // LLM always generates the Log Analytics reference
  },
  'Microsoft.ContainerRegistry/registries': {
    sku: { name: 'Basic' },
    adminUserEnabled: false,
  },
  'Microsoft.OperationalInsights/workspaces': {
    sku: { name: 'PerGB2018' },
    retentionInDays: 30,
  },
  'Microsoft.DocumentDB/databaseAccounts': {
    kind: 'GlobalDocumentDB',
  },
  'Microsoft.CognitiveServices/accounts': {
    sku: { name: 'S0' },
  },
};

// ===== HELPER FUNCTIONS =====

/**
 * Check if a property exists in the data (supports nested paths like "sku.name")
 */
function hasProperty(data: Record<string, unknown>, propPath: string): boolean {
  const parts = propPath.split('.');
  let value: unknown = data;
  
  for (const part of parts) {
    if (value && typeof value === 'object' && part in (value as Record<string, unknown>)) {
      value = (value as Record<string, unknown>)[part];
    } else {
      return false;
    }
  }
  
  return value !== undefined && value !== null && value !== '';
}

/**
 * Get a property value from nested path
 */
function getProperty(data: Record<string, unknown>, propPath: string): unknown {
  const parts = propPath.split('.');
  let value: unknown = data;
  
  for (const part of parts) {
    if (value && typeof value === 'object' && part in (value as Record<string, unknown>)) {
      value = (value as Record<string, unknown>)[part];
    } else {
      return undefined;
    }
  }
  
  return value;
}

// ===== VALIDATION FUNCTIONS =====

/**
 * Check if a node has a connected resource of a specific type via edges
 */
function hasConnectedResource(
  nodeId: string,
  resourceTypePattern: string,
  nodes: NodeData[],
  edges: EdgeData[]
): boolean {
  const pattern = resourceTypePattern.toLowerCase();
  
  // Find all edges connected to this node (as source or target)
  for (const edge of edges) {
    let connectedNodeId: string | null = null;
    
    if (edge.target === nodeId) {
      connectedNodeId = edge.source;
    } else if (edge.source === nodeId) {
      connectedNodeId = edge.target;
    }
    
    if (connectedNodeId) {
      const connectedNode = nodes.find(n => n.id === connectedNodeId);
      if (connectedNode?.data?.resourceType?.toLowerCase().includes(pattern)) {
        return true;
      }
    }
  }
  
  return false;
}

/**
 * Validate a single node against its Bicep schema
 * Matches the Python validation script logic
 */
async function validateNode(
  node: NodeData,
  schema: BicepResourceSchema,
  nodes: NodeData[],
  edges: EdgeData[]
): Promise<SchemaValidationIssue[]> {
  const issues: SchemaValidationIssue[] = [];
  const { data } = node;
  const nodeId = node.id;
  const nodeName = (data.label || data.displayName || 'Unknown') as string;
  const resourceType = data.resourceType || '';

  // Merge LLM-generated defaults into the effective properties so the validator
  // does not raise false "missing required" errors for fields the user never sets
  // in the diagram but the LLM always emits in the generated template.
  const rawProps = (data.properties || {}) as Record<string, unknown>;
  const props = { ...(RESOURCE_DEFAULTS[resourceType] || {}), ...rawProps };

  // ===== 1. CHECK TOP-LEVEL REQUIRED PROPERTIES =====
  for (const prop of schema.required) {
    if (prop.readonly) continue;
    
    const propName = prop.name;
    
    // Special handling for common properties
    if (propName === 'name') {
      // Name is usually in label
      if (!data.label && !data.displayName) {
        issues.push({
          id: `${nodeId}-missing-${propName}`,
          severity: 'error',
          nodeId,
          nodeName,
          resourceType,
          propertyName: propName,
          message: `Missing required: name (label)`,
          suggestion: 'Provide a name/label for this resource',
          apiVersion: schema.apiVersion,
        });
      }
      continue;
    }
    
    if (propName === 'location') {
      // Location can be in data.region or data.location or properties.location.
      // In Bicep templates the LLM always emits a location parameter, so this is
      // at most advisory - never a blocking error.
      if (data.location || data.region || hasProperty(props, 'location')) {
        continue;
      }
      issues.push({
        id: `${nodeId}-missing-${propName}`,
        severity: 'warning',
        nodeId,
        nodeName,
        resourceType,
        propertyName: propName,
        message: `Location not specified - template will use resource group location`,
        suggestion: 'The generated template adds a location parameter defaulting to the resource group region',
        apiVersion: schema.apiVersion,
      });
      continue;
    }
    
    // Check if property exists in data or properties.
    // These are schema-required fields that the LLM always generates in the Bicep template
    // (kind, sku, tenantId, etc.) - the user never sets them in the diagram, so they must
    // never be blocking errors. Surface as info so the panel stays clean for any service.
    if (!hasProperty(data as Record<string, unknown>, propName) && !hasProperty(props, propName)) {
      issues.push({
        id: `${nodeId}-missing-${propName}`,
        severity: 'info',
        nodeId,
        nodeName,
        resourceType,
        propertyName: propName,
        message: `LLM-generated: ${propName} will be set in template`,
        suggestion: prop.description || `The IaC generator sets ${propName} automatically`,
        apiVersion: schema.apiVersion,
      });
    }
  }

  // ===== 2. CHECK NESTED REQUIRED PROPERTIES (properties.*) =====
  const nestedProps = schema.nested?.['properties'] || [];
  
  for (const prop of nestedProps) {
    if (prop.readonly) continue;
    if (!prop.required) continue;
    
    // Nested required props (e.g. properties.sku, properties.tenantId) are always emitted
    // by the LLM in the generated template. Surface as info, never as a blocking error.
    if (!hasProperty(props, prop.name)) {
      issues.push({
        id: `${nodeId}-missing-nested-${prop.name}`,
        severity: 'info',
        nodeId,
        nodeName,
        resourceType,
        propertyName: `properties.${prop.name}`,
        message: `LLM-generated: properties.${prop.name} will be set in template`,
        suggestion: prop.description || `The IaC generator sets properties.${prop.name} automatically`,
        apiVersion: schema.apiVersion,
      });
    }
  }

  // ===== 3. CHECK CRITICAL PROPERTIES FOR PRODUCTION =====
  const criticalProps = CRITICAL_PROPERTIES[resourceType] || [];
  
  for (const propName of criticalProps) {
    // Check in properties, at data level, and with "properties.X" pattern
    const inProps = hasProperty(props, propName);
    const inData = hasProperty(data as Record<string, unknown>, propName);
    const altKey = `properties.${propName}`;
    const inPropsAlt = hasProperty(props, altKey);
    
    if (!inProps && !inData && !inPropsAlt) {
      // Check if already reported as error
      const alreadyReported = issues.some(i => 
        i.propertyName === propName || 
        i.propertyName === `properties.${propName}`
      );
      
      if (!alreadyReported) {
        const desc = IMPORTANT_PROPERTIES[resourceType]?.[propName] || `Critical for deployment`;
        issues.push({
          id: `${nodeId}-critical-${propName}`,
          severity: 'error',
          nodeId,
          nodeName,
          resourceType,
          propertyName: propName,
          message: `CRITICAL: Missing ${propName}`,
          suggestion: desc,
          apiVersion: schema.apiVersion,
        });
      }
    }
  }

  // ===== 4. CHECK IMPORTANT/RECOMMENDED PROPERTIES =====
  const importantProps = IMPORTANT_PROPERTIES[resourceType] || {};
  
  for (const [propPath, description] of Object.entries(importantProps)) {
    // Skip if it's a critical property (already checked above)
    if (criticalProps.includes(propPath.split('.')[0])) continue;
    
    // Check if property exists
    const inProps = hasProperty(props, propPath);
    const inData = hasProperty(data as Record<string, unknown>, propPath);
    
    if (!inProps && !inData) {
      // SPECIAL CASE: identity property - check if Managed Identity is connected via edge
      if (propPath === 'identity') {
        const hasManagedIdentityConnection = hasConnectedResource(
          nodeId,
          'managedidentity',
          nodes,
          edges
        );
        if (hasManagedIdentityConnection) {
          console.log(`[Validator] Node ${nodeName} has Managed Identity connected via edge, skipping identity warning`);
          continue; // Skip this warning - identity will be inherited at export time
        }
      }
      
      // Skip if already reported
      const alreadyReported = issues.some(i => 
        i.propertyName === propPath || 
        i.propertyName === `properties.${propPath}` ||
        i.propertyName.startsWith(propPath + '.')
      );
      
      if (!alreadyReported) {
        issues.push({
          id: `${nodeId}-recommended-${propPath.replace(/\./g, '-')}`,
          severity: 'warning',
          nodeId,
          nodeName,
          resourceType,
          propertyName: propPath,
          message: `Recommended: ${propPath}`,
          suggestion: description,
          apiVersion: schema.apiVersion,
        });
      }
    }
  }

  // ===== 5. SPECIAL VALIDATIONS =====
  
  // Check WorkspaceResourceId format for App Insights
  if (resourceType === 'Microsoft.Insights/components') {
    const workspaceRef = getProperty(props, 'WorkspaceResourceId') || 
                        getProperty(props, 'properties.WorkspaceResourceId');
    if (workspaceRef && typeof workspaceRef === 'string') {
      if (!workspaceRef.startsWith('/subscriptions/') && !workspaceRef.startsWith('${')) {
        issues.push({
          id: `${nodeId}-invalid-workspaceref`,
          severity: 'warning',
          nodeId,
          nodeName,
          resourceType,
          propertyName: 'WorkspaceResourceId',
          message: 'WorkspaceResourceId should be a full resource ID',
          suggestion: 'Use format: /subscriptions/{sub}/resourceGroups/{rg}/providers/Microsoft.OperationalInsights/workspaces/{name}',
          apiVersion: schema.apiVersion,
        });
      }
    }
  }

  return issues;
}

/**
 * Validate all nodes in an architecture against Azure Bicep schemas
 */
export async function validateArchitecture(
  nodes: NodeData[],
  edges: EdgeData[] = []
): Promise<SchemaValidationResult> {
  const allIssues: SchemaValidationIssue[] = [];
  let validatedNodes = 0;

  // Filter to only service nodes (type 'service' or has resourceType)
  const serviceNodes = nodes.filter(
    (n) => n.type === 'service' || n.data?.resourceType
  );

  console.log(`[Validator] Validating ${serviceNodes.length} service nodes against Azure Bicep schemas...`);

  // Validate each node
  for (const node of serviceNodes) {
    const resourceType = node.data?.resourceType;
    if (!resourceType) continue;

    try {
      const schema = await getResourceSchema(resourceType);
      
      if (schema) {
        console.log(`[Validator] ${node.data?.label || node.id} (${resourceType}@${schema.apiVersion})`);
        console.log(`[Validator]   Required top: ${schema.required.filter(p => !p.readonly).map(p => p.name).join(', ') || 'none'}`);
        console.log(`[Validator]   Required nested: ${(schema.nested?.['properties'] || []).filter(p => p.required && !p.readonly).map(p => p.name).join(', ') || 'none'}`);
        
        const nodeIssues = await validateNode(node, schema, nodes, edges);
        allIssues.push(...nodeIssues);
        validatedNodes++;
        
        if (nodeIssues.length > 0) {
          console.log(`[Validator]   Issues: ${nodeIssues.map(i => `${i.severity}: ${i.propertyName}`).join(', ')}`);
        }
      } else {
        // Schema not found - add info
        console.log(`[Validator] Schema not found for ${resourceType}`);
        allIssues.push({
          id: `${node.id}-schema-not-found`,
          severity: 'info',
          nodeId: node.id,
          nodeName: (node.data?.label || node.data?.displayName || 'Unknown') as string,
          resourceType,
          propertyName: '',
          message: `Schema not found for ${resourceType}`,
          suggestion: 'This resource type may not be in the Azure Bicep Types repository',
        });
      }
    } catch (error) {
      console.warn(`[Validator] Failed to validate ${resourceType}:`, error);
      allIssues.push({
        id: `${node.id}-validation-error`,
        severity: 'info',
        nodeId: node.id,
        nodeName: (node.data?.label || 'Unknown') as string,
        resourceType,
        propertyName: '',
        message: `Validation error: ${error instanceof Error ? error.message : 'Unknown error'}`,
      });
    }
  }

  // Categorize issues
  const errors = allIssues.filter((i) => i.severity === 'error');
  const warnings = allIssues.filter((i) => i.severity === 'warning');
  const infos = allIssues.filter((i) => i.severity === 'info');

  console.log(`[Validator] ══════════════════════════════════════════════════════════════`);
  console.log(`[Validator] VALIDATION COMPLETE: ${validatedNodes}/${serviceNodes.length} nodes validated`);
  console.log(`[Validator]   Errors: ${errors.length}`);
  console.log(`[Validator]   Warnings: ${warnings.length}`);
  console.log(`[Validator]   Info: ${infos.length}`);
  console.log(`[Validator] ══════════════════════════════════════════════════════════════`);

  return {
    isValid: errors.length === 0,
    errors,
    warnings,
    infos,
    summary: {
      totalNodes: serviceNodes.length,
      validatedNodes,
      errorCount: errors.length,
      warningCount: warnings.length,
      infoCount: infos.length,
    },
    validatedAt: new Date(),
  };
}

/**
 * Quick check if architecture is valid (no errors)
 */
export async function isArchitectureValid(nodes: NodeData[]): Promise<boolean> {
  const result = await validateArchitecture(nodes);
  return result.isValid;
}

/**
 * Get a summary string for the validation result
 */
export function getValidationSummary(result: SchemaValidationResult): string {
  if (result.isValid && result.warnings.length === 0) {
    return `All ${result.summary.validatedNodes} resources validated successfully!`;
  }

  const parts: string[] = [];

  if (result.errors.length > 0) {
    parts.push(`${result.errors.length} error${result.errors.length > 1 ? 's' : ''}`);
  }

  if (result.warnings.length > 0) {
    parts.push(`${result.warnings.length} warning${result.warnings.length > 1 ? 's' : ''}`);
  }

  if (result.isValid) {
    return `Valid with ${parts.join(', ')}`;
  }

  return parts.join(', ');
}
