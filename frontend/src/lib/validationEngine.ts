// Diagram Validation Engine
// Validates Azure architecture diagrams for missing dependencies and best practices

import type { Node } from '@xyflow/react';
import type { ServiceNodeData, GroupNodeData } from '@/types/diagram';
import { 
  serviceDependencies, 
  getServiceDependencies, 
  type IssueSeverity 
} from './serviceDependencies';

export interface ValidationIssue {
  id: string;
  nodeId: string;
  nodeName: string;
  serviceId: string;
  severity: IssueSeverity;
  title: string;
  description: string;
  recommendation: string;
  bicepProperty?: string;
  missingServiceId?: string;
  category: 'dependency' | 'container' | 'property' | 'configuration';
}

export interface ValidationResult {
  issues: ValidationIssue[];
  errors: number;
  warnings: number;
  infos: number;
  isValid: boolean;
}

// Check if a service type exists in the diagram
function serviceExistsInDiagram(
  targetServiceId: string, 
  allNodes: Node<ServiceNodeData | GroupNodeData>[],
  sourceNodeId?: string
): boolean {
  return allNodes.some(node => {
    if (node.id === sourceNodeId) return false; // Don't count self
    const data = node.data as ServiceNodeData;
    return data.serviceId === targetServiceId;
  });
}

// Check if node is inside a resource group
function isInsideResourceGroup(
  node: Node<ServiceNodeData | GroupNodeData>,
  allNodes: Node<ServiceNodeData | GroupNodeData>[]
): boolean {
  // Check if the node has a parent group of type resourceGroup
  for (const otherNode of allNodes) {
    if (otherNode.type === 'group') {
      const groupData = otherNode.data as GroupNodeData;
      if (groupData.groupType === 'resourceGroup') {
        // Check if node is visually inside this group
        if (isNodeInsideGroup(node, otherNode)) {
          return true;
        }
      }
    }
  }
  return false;
}

// Check if node is inside a VNet
function isInsideVirtualNetwork(
  node: Node<ServiceNodeData | GroupNodeData>,
  allNodes: Node<ServiceNodeData | GroupNodeData>[]
): boolean {
  for (const otherNode of allNodes) {
    if (otherNode.type === 'group') {
      const groupData = otherNode.data as GroupNodeData;
      if (groupData.groupType === 'virtualNetwork') {
        if (isNodeInsideGroup(node, otherNode)) {
          return true;
        }
      }
    }
  }
  return false;
}

// Simple bounds check to see if a node is inside a group
function isNodeInsideGroup(
  node: Node<ServiceNodeData | GroupNodeData>,
  group: Node<ServiceNodeData | GroupNodeData>
): boolean {
  const nodeX = node.position.x;
  const nodeY = node.position.y;
  const groupX = group.position.x;
  const groupY = group.position.y;
  const groupWidth = (group.measured?.width || group.width || 300) as number;
  const groupHeight = (group.measured?.height || group.height || 200) as number;

  return (
    nodeX >= groupX &&
    nodeX <= groupX + groupWidth &&
    nodeY >= groupY &&
    nodeY <= groupY + groupHeight
  );
}

// Validate a single service node
function validateServiceNode(
  node: Node<ServiceNodeData>,
  allNodes: Node<ServiceNodeData | GroupNodeData>[]
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const serviceId = node.data.serviceId;
  const nodeName = node.data.displayName || node.data.name || serviceId;
  
  const rule = getServiceDependencies(serviceId);
  if (!rule) {
    // No validation rules for this service
    return issues;
  }

  // Check dependencies
  for (const dep of rule.dependencies) {
    // Skip if condition doesn't match
    if (dep.condition) {
      const propValue = (node.data as Record<string, unknown>)[dep.condition.property] as string;
      if (dep.condition.operator === 'in' && !dep.condition.values.includes(propValue)) {
        continue;
      }
      if (dep.condition.operator === 'notIn' && dep.condition.values.includes(propValue)) {
        continue;
      }
    }

    const exists = serviceExistsInDiagram(dep.targetServiceId, allNodes, node.id);
    
    if (!exists) {
      const severity: IssueSeverity = dep.type === 'required' ? 'error' : 
                                       dep.type === 'recommended' ? 'warning' : 'info';
      
      issues.push({
        id: `${node.id}-dep-${dep.targetServiceId}`,
        nodeId: node.id,
        nodeName,
        serviceId,
        severity,
        title: `Missing ${formatServiceName(dep.targetServiceId)}`,
        description: dep.reason,
        recommendation: `Add a ${formatServiceName(dep.targetServiceId)} to your architecture`,
        bicepProperty: dep.bicepProperty,
        missingServiceId: dep.targetServiceId,
        category: 'dependency' as const,
      });
    }
  }

  // Check container requirements
  if (rule.containerRequirements) {
    if (rule.containerRequirements.required.includes('resourceGroup')) {
      if (!isInsideResourceGroup(node, allNodes)) {
        issues.push({
          id: `${node.id}-container-rg`,
          nodeId: node.id,
          nodeName,
          serviceId,
          severity: 'warning' as const,
          title: 'Not in Resource Group',
          description: `${formatServiceName(serviceId)} should be placed inside a Resource Group container`,
          recommendation: 'Drag a Resource Group container onto the canvas and place this service inside it',
          category: 'container' as const,
        });
      }
    }

    if (rule.containerRequirements.recommended.includes('virtualNetwork')) {
      if (!isInsideVirtualNetwork(node, allNodes)) {
        issues.push({
          id: `${node.id}-container-vnet`,
          nodeId: node.id,
          nodeName,
          serviceId,
          severity: 'info' as const,
          title: 'Not in Virtual Network',
          description: `${formatServiceName(serviceId)} is recommended to be placed in a Virtual Network for network isolation`,
          recommendation: 'Consider adding a Virtual Network container for better network security',
          category: 'container' as const,
        });
      }
    }
  }

  return issues;
}

// Format service ID to display name
function formatServiceName(serviceId: string): string {
  return serviceId
    .split('-')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

// Main validation function
export function validateDiagram(
  nodes: Node<ServiceNodeData | GroupNodeData>[]
): ValidationResult {
  const issues: ValidationIssue[] = [];

  // Filter to only service nodes (not groups)
  const serviceNodes = nodes.filter(n => n.type === 'service') as Node<ServiceNodeData>[];

  for (const node of serviceNodes) {
    const nodeIssues = validateServiceNode(node, nodes);
    issues.push(...nodeIssues);
  }

  const errors = issues.filter(i => i.severity === 'error').length;
  const warnings = issues.filter(i => i.severity === 'warning').length;
  const infos = issues.filter(i => i.severity === 'info').length;

  return {
    issues,
    errors,
    warnings,
    infos,
    isValid: errors === 0,
  };
}

// Get summary of what services are commonly needed together
export function getSuggestedServices(currentServices: string[]): string[] {
  const suggestions = new Set<string>();
  
  for (const serviceId of currentServices) {
    const rule = getServiceDependencies(serviceId);
    if (rule) {
      for (const dep of rule.dependencies) {
        if (!currentServices.includes(dep.targetServiceId)) {
          suggestions.add(dep.targetServiceId);
        }
      }
    }
  }
  
  return Array.from(suggestions);
}

// Get dependency graph for visualization
export function getDependencyGraph(serviceId: string): { 
  required: string[]; 
  recommended: string[]; 
  optional: string[];
  dependents: string[];
} {
  const rule = getServiceDependencies(serviceId);
  
  const required: string[] = [];
  const recommended: string[] = [];
  const optional: string[] = [];
  
  if (rule) {
    for (const dep of rule.dependencies) {
      if (dep.type === 'required') required.push(dep.targetServiceId);
      else if (dep.type === 'recommended') recommended.push(dep.targetServiceId);
      else optional.push(dep.targetServiceId);
    }
  }
  
  // Find services that depend on this service
  const dependents: string[] = [];
  for (const r of serviceDependencies) {
    if (r.dependencies.some(d => d.targetServiceId === serviceId)) {
      dependents.push(r.serviceId);
    }
  }
  
  return { required, recommended, optional, dependents };
}
