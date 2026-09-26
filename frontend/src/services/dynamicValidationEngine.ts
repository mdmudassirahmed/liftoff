/**
 * Dynamic Validation Engine
 * 
 * Validates Azure architecture diagrams by checking for missing dependencies,
 * configuration issues, and best practices violations using live Azure schemas.
 * 
 * This replaces the static validationEngine.ts with dynamic schema-based validation.
 */

import { getResourceDependencies, type DependencyInfo } from './azureSchemaService';
import type { Node, Edge } from '@xyflow/react';

// Validation issue severity levels
export type IssueSeverity = 'error' | 'warning' | 'info';

// Validation issue types
export type IssueType = 
  | 'missing-dependency' 
  | 'configuration-issue' 
  | 'best-practice' 
  | 'connection-issue'
  | 'naming-convention';

/**
 * A validation issue found in the diagram
 */
export interface ValidationIssue {
  id: string;
  type: IssueType;
  severity: IssueSeverity;
  title: string;
  message: string;
  nodeId: string;
  nodeName: string;
  resourceType: string;
  suggestion?: string;
  dependencies?: DependencyInfo[];
  affectedNodes?: string[];
}

/**
 * Validation result for a diagram
 */
export interface ValidationResult {
  isValid: boolean;
  issues: ValidationIssue[];
  checkedAt: Date;
  nodeCount: number;
  edgeCount: number;
}

/**
 * Node data structure expected from the canvas
 * Using a flexible type to accommodate various node data shapes from the store
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DiagramNode = Node<any>;
type DiagramEdge = Edge;

/**
 * Configuration validation rules based on common Azure requirements
 */
const CONFIGURATION_RULES: Record<string, (node: DiagramNode) => ValidationIssue | null> = {
  // Storage account naming
  'Microsoft.Storage/storageAccounts': (node) => {
    const label = (node.data?.label || '') as string;
    if (label && !/^[a-z0-9]{3,24}$/.test(label.toLowerCase())) {
      return {
        id: `config-${node.id}-naming`,
        type: 'naming-convention',
        severity: 'warning',
        title: 'Storage Account Naming',
        message: `Storage account "${label}" must be 3-24 lowercase alphanumeric characters`,
        nodeId: node.id,
        nodeName: label,
        resourceType: 'Microsoft.Storage/storageAccounts',
        suggestion: 'Use only lowercase letters and numbers, 3-24 characters long',
      };
    }
    return null;
  },

  // Key Vault naming
  'Microsoft.KeyVault/vaults': (node) => {
    const label = (node.data?.label || '') as string;
    if (label && (label.length < 3 || label.length > 24)) {
      return {
        id: `config-${node.id}-naming`,
        type: 'naming-convention',
        severity: 'warning',
        title: 'Key Vault Naming',
        message: `Key Vault "${label}" name must be 3-24 characters`,
        nodeId: node.id,
        nodeName: label,
        resourceType: 'Microsoft.KeyVault/vaults',
        suggestion: 'Use 3-24 alphanumeric characters and hyphens',
      };
    }
    return null;
  },

  // Virtual Machine - Check for public IP without NSG
  'Microsoft.Compute/virtualMachines': (_node) => {
    // This would need edge analysis, handled in connection validation
    return null;
  },
};

/**
 * Best practice rules
 */
const BEST_PRACTICE_RULES: Record<string, (node: DiagramNode, allNodes: DiagramNode[], edges: DiagramEdge[]) => ValidationIssue | null> = {
  // AKS without Container Registry
  'Microsoft.ContainerService/managedClusters': (node, allNodes) => {
    const hasACR = allNodes.some(n => n.data?.resourceType === 'Microsoft.ContainerRegistry/registries');
    if (!hasACR) {
      return {
        id: `bp-${node.id}-acr`,
        type: 'best-practice',
        severity: 'info',
        title: 'Container Registry Recommended',
        message: 'AKS cluster would benefit from an Azure Container Registry for private image storage',
        nodeId: node.id,
        nodeName: (node.data?.label || 'AKS Cluster') as string,
        resourceType: 'Microsoft.ContainerService/managedClusters',
        suggestion: 'Add an Azure Container Registry to store container images privately',
      };
    }
    return null;
  },

  // App Service without Application Insights
  'Microsoft.Web/sites': (node, allNodes) => {
    const hasAppInsights = allNodes.some(n => n.data?.resourceType === 'Microsoft.Insights/components');
    if (!hasAppInsights) {
      return {
        id: `bp-${node.id}-insights`,
        type: 'best-practice',
        severity: 'info',
        title: 'Monitoring Recommended',
        message: 'App Service should have Application Insights for monitoring and diagnostics',
        nodeId: node.id,
        nodeName: (node.data?.label || 'App Service') as string,
        resourceType: 'Microsoft.Web/sites',
        suggestion: 'Add Application Insights for application performance monitoring',
      };
    }
    return null;
  },

  // SQL Database without Key Vault for secrets
  'Microsoft.Sql/servers': (node, allNodes) => {
    const hasKeyVault = allNodes.some(n => n.data?.resourceType === 'Microsoft.KeyVault/vaults');
    if (!hasKeyVault) {
      return {
        id: `bp-${node.id}-keyvault`,
        type: 'best-practice',
        severity: 'info',
        title: 'Secret Management Recommended',
        message: 'SQL Server connection strings should be stored in Key Vault',
        nodeId: node.id,
        nodeName: (node.data?.label || 'SQL Server') as string,
        resourceType: 'Microsoft.Sql/servers',
        suggestion: 'Add Azure Key Vault to securely store connection strings and credentials',
      };
    }
    return null;
  },
};

/**
 * Check if a node has a connection to another node of a specific resource type
 */
function hasConnectionTo(
  node: DiagramNode,
  targetResourceType: string,
  allNodes: DiagramNode[],
  edges: DiagramEdge[]
): boolean {
  // Find all connected nodes
  const connectedNodeIds = new Set<string>();
  
  for (const edge of edges) {
    if (edge.source === node.id) {
      connectedNodeIds.add(edge.target);
    }
    if (edge.target === node.id) {
      connectedNodeIds.add(edge.source);
    }
  }

  // Check if any connected node has the target resource type
  return allNodes.some(
    n => connectedNodeIds.has(n.id) && n.data?.resourceType === targetResourceType
  );
}

/**
 * Check if a node is inside a parent container of a specific resource type
 */
function hasParentOfType(
  node: DiagramNode,
  parentResourceType: string,
  allNodes: DiagramNode[]
): boolean {
  if (!node.parentId) return false;
  
  const parent = allNodes.find(n => n.id === node.parentId);
  if (!parent) return false;
  
  if (parent.data?.resourceType === parentResourceType) return true;
  
  // Recursively check parent's parent
  return hasParentOfType(parent, parentResourceType, allNodes);
}

/**
 * Validate missing dependencies for a node
 */
/**
 * Check if two nodes share the same parent (are siblings in the same scope)
 */
function sharesSameParent(
  node: DiagramNode,
  otherNode: DiagramNode
): boolean {
  // Both at root level
  if (!node.parentId && !otherNode.parentId) return true;
  
  // Same parent
  if (node.parentId === otherNode.parentId) return true;
  
  // Check if one is ancestor of the other's parent
  return false;
}

/**
 * Check if dependency resource exists in the same scope (Resource Group)
 */
function hasDependencyInSameScope(
  node: DiagramNode,
  targetResourceType: string,
  allNodes: DiagramNode[]
): DiagramNode | null {
  // Find all nodes of the target resource type
  const targetNodes = allNodes.filter(n => 
    n.type === 'service' && n.data?.resourceType === targetResourceType
  );
  
  if (targetNodes.length === 0) return null;
  
  // Check if any target node shares the same parent scope
  for (const target of targetNodes) {
    // Same parent (same Resource Group level)
    if (node.parentId === target.parentId) return target;
    
    // Node is inside the target's parent chain
    if (node.parentId === target.id) return target;
    
    // Target is inside the node's parent chain
    if (target.parentId === node.id) return target;
    
    // Both are at root level or share ancestor
    if (sharesSameParent(node, target)) return target;
  }
  
  return null;
}

/**
 * Validate missing dependencies for a node
 */
async function validateDependencies(
  node: DiagramNode,
  allNodes: DiagramNode[],
  edges: DiagramEdge[]
): Promise<ValidationIssue[]> {
  const issues: ValidationIssue[] = [];
  const resourceType = node.data?.resourceType as string | undefined;
  
  if (!resourceType) return issues;

  try {
    // Get dependencies from the schema service
    const dependencies = await getResourceDependencies(resourceType);
    
    for (const dep of dependencies) {
      // Check if the dependency is satisfied
      let isSatisfied = false;

      // Check by connection (explicit edge)
      const hasConnection = hasConnectionTo(node, dep.resourceType, allNodes, edges);
      
      // Check by parent container
      const hasParent = hasParentOfType(node, dep.resourceType, allNodes);
      
      // Check if dependency exists in the same scope (Resource Group)
      const sameScope = hasDependencyInSameScope(node, dep.resourceType, allNodes);
      
      // Check if dependency exists anywhere in diagram
      const existsInDiagram = allNodes.some(n => n.data?.resourceType === dep.resourceType);

      // Determine if satisfied based on dependency type
      switch (dep.type) {
        case 'required':
          // Required deps are satisfied if:
          // 1. Connected via edge, OR
          // 2. Is a parent container, OR
          // 3. Exists in the same scope (e.g., same Resource Group)
          isSatisfied = hasConnection || hasParent || sameScope !== null;
          break;
        case 'optional':
          // Optional deps don't need to exist, skip
          continue;
        case 'recommended':
          // Recommended should exist somewhere in diagram
          isSatisfied = existsInDiagram;
          break;
      }

      if (!isSatisfied) {
        const severity: IssueSeverity = dep.type === 'required' ? 'error' : 'warning';
        
        issues.push({
          id: `dep-${node.id}-${dep.resourceType.replace(/[^a-z0-9]/gi, '-')}`,
          type: 'missing-dependency',
          severity,
          title: dep.type === 'required' ? 'Missing Required Dependency' : 'Missing Recommended Dependency',
          message: `${node.data?.label || resourceType} requires ${dep.name}`,
          nodeId: node.id,
          nodeName: (node.data?.label || resourceType) as string,
          resourceType,
          suggestion: `Add ${dep.name} (${dep.resourceType}) to your architecture`,
          dependencies: [dep],
        });
      }
    }
  } catch (error) {
    console.warn(`Failed to fetch dependencies for ${resourceType}:`, error);
  }

  return issues;
}

/**
 * Validate configuration for a node
 */
function validateConfiguration(node: DiagramNode): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const resourceType = node.data?.resourceType as string | undefined;
  
  if (!resourceType) return issues;

  const rule = CONFIGURATION_RULES[resourceType];
  if (rule) {
    const issue = rule(node);
    if (issue) {
      issues.push(issue);
    }
  }

  return issues;
}

/**
 * Validate best practices for a node
 */
function validateBestPractices(
  node: DiagramNode,
  allNodes: DiagramNode[],
  edges: DiagramEdge[]
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const resourceType = node.data?.resourceType as string | undefined;
  
  if (!resourceType) return issues;

  const rule = BEST_PRACTICE_RULES[resourceType];
  if (rule) {
    const issue = rule(node, allNodes, edges);
    if (issue) {
      issues.push(issue);
    }
  }

  return issues;
}

/**
 * Main validation function - validates entire diagram
 */
export async function validateDiagram(
  nodes: DiagramNode[],
  edges: DiagramEdge[]
): Promise<ValidationResult> {
  const issues: ValidationIssue[] = [];
  
  // Filter to only nodes with resource types (not groups, annotations, etc.)
  const resourceNodes = nodes.filter(n => n.data?.resourceType);

  // Validate each node
  for (const node of resourceNodes) {
    // Check dependencies (async)
    const depIssues = await validateDependencies(node, resourceNodes, edges);
    issues.push(...depIssues);

    // Check configuration
    const configIssues = validateConfiguration(node);
    issues.push(...configIssues);

    // Check best practices
    const bpIssues = validateBestPractices(node, resourceNodes, edges);
    issues.push(...bpIssues);
  }

  // Sort issues by severity (errors first)
  const severityOrder: Record<IssueSeverity, number> = {
    error: 0,
    warning: 1,
    info: 2,
  };
  issues.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);

  return {
    isValid: !issues.some(i => i.severity === 'error'),
    issues,
    checkedAt: new Date(),
    nodeCount: resourceNodes.length,
    edgeCount: edges.length,
  };
}

/**
 * Validate a single node (for real-time validation as user adds nodes)
 */
export async function validateNode(
  node: DiagramNode,
  allNodes: DiagramNode[],
  edges: DiagramEdge[]
): Promise<ValidationIssue[]> {
  const issues: ValidationIssue[] = [];
  
  if (!node.data?.resourceType) return issues;

  // Check dependencies
  const depIssues = await validateDependencies(node, allNodes, edges);
  issues.push(...depIssues);

  // Check configuration
  const configIssues = validateConfiguration(node);
  issues.push(...configIssues);

  // Check best practices
  const bpIssues = validateBestPractices(node, allNodes, edges);
  issues.push(...bpIssues);

  return issues;
}

/**
 * Get issues for a specific node
 */
export function getIssuesForNode(
  nodeId: string,
  validationResult: ValidationResult
): ValidationIssue[] {
  return validationResult.issues.filter(i => i.nodeId === nodeId);
}

/**
 * Get issue counts by severity
 */
export function getIssueCounts(validationResult: ValidationResult): {
  errors: number;
  warnings: number;
  info: number;
  total: number;
} {
  const errors = validationResult.issues.filter(i => i.severity === 'error').length;
  const warnings = validationResult.issues.filter(i => i.severity === 'warning').length;
  const info = validationResult.issues.filter(i => i.severity === 'info').length;

  return {
    errors,
    warnings,
    info,
    total: errors + warnings + info,
  };
}

/**
 * Export for re-use
 */
export type { DependencyInfo };
