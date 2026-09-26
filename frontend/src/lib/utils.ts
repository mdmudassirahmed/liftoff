import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import type { XYPosition } from '@xyflow/react';
import type { DiagramNode, GroupNode, ServiceNodeData, GroupNodeData, ConnectionEdgeData } from '@/types';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function generateId(prefix: string = 'node'): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Compute the absolute canvas position of a node by traversing up the parent chain.
 * Nodes with parentId have positions relative to their parent.
 */
export function getAbsolutePosition(
  node: DiagramNode,
  allNodes: DiagramNode[]
): XYPosition {
  let absoluteX = node.position.x;
  let absoluteY = node.position.y;
  
  let currentNode = node;
  while (currentNode.parentId) {
    const parent = allNodes.find(n => n.id === currentNode.parentId);
    if (!parent) break;
    
    absoluteX += parent.position.x;
    absoluteY += parent.position.y;
    currentNode = parent;
  }
  
  return { x: absoluteX, y: absoluteY };
}

/**
 * Check if a position (absolute canvas coordinates) is inside a node's bounds.
 * Computes the node's absolute position if it has a parent.
 */
export function isInsideBoundsAbsolute(
  position: XYPosition,
  node: DiagramNode,
  allNodes: DiagramNode[]
): boolean {
  const nodeWidth = node.measured?.width ?? node.width ?? (node.style?.width as number) ?? 200;
  const nodeHeight = node.measured?.height ?? node.height ?? (node.style?.height as number) ?? 150;
  
  // Get the node's absolute position
  const absPos = getAbsolutePosition(node, allNodes);
  
  return (
    position.x >= absPos.x &&
    position.x <= absPos.x + nodeWidth &&
    position.y >= absPos.y &&
    position.y <= absPos.y + nodeHeight
  );
}

export function isInsideBounds(
  position: XYPosition,
  node: DiagramNode
): boolean {
  const nodeWidth = node.measured?.width ?? node.width ?? 200;
  const nodeHeight = node.measured?.height ?? node.height ?? 150;
  
  return (
    position.x >= node.position.x &&
    position.x <= node.position.x + nodeWidth &&
    position.y >= node.position.y &&
    position.y <= node.position.y + nodeHeight
  );
}

export function detectParentGroup(
  position: XYPosition,
  nodes: DiagramNode[]
): string | null {
  const groups = nodes.filter(
    (n): n is GroupNode => n.type === 'group'
  );
  
  // Sort by area (smaller groups first) to find most specific parent
  const sortedGroups = [...groups].sort((a, b) => {
    const areaA = (a.measured?.width ?? a.width ?? 200) * (a.measured?.height ?? a.height ?? 150);
    const areaB = (b.measured?.width ?? b.width ?? 200) * (b.measured?.height ?? b.height ?? 150);
    return areaA - areaB;
  });
  
  for (const group of sortedGroups) {
    // Use absolute position check for nested groups
    if (isInsideBoundsAbsolute(position, group, nodes)) {
      return group.id;
    }
  }
  
  return null;
}

/**
 * Find all parent groups in the hierarchy for a given position (absolute canvas coordinates).
 * Uses absolute position calculation to properly detect containment in nested groups.
 * Returns groups from innermost (smallest) to outermost (largest).
 */
export function findAllParentGroups(
  position: XYPosition,
  nodes: DiagramNode[]
): GroupNode[] {
  const groups = nodes.filter(
    (n): n is GroupNode => n.type === 'group'
  );
  
  // Find all groups that contain this position using absolute coordinates
  const containingGroups = groups.filter(group => isInsideBoundsAbsolute(position, group, nodes));
  
  // Sort by area (smallest first) - innermost to outermost
  return containingGroups.sort((a, b) => {
    const areaA = (a.measured?.width ?? a.width ?? 200) * (a.measured?.height ?? a.height ?? 150);
    const areaB = (b.measured?.width ?? b.width ?? 200) * (b.measured?.height ?? b.height ?? 150);
    return areaA - areaB;
  });
}

/**
 * Inherit properties from parent groups based on group type.
 * Returns an object with inherited properties from all containing groups.
 */
export function inheritPropertiesFromGroups(
  parentGroups: GroupNode[]
): Record<string, unknown> {
  const inherited: Record<string, unknown> = {};
  
  // Process from outermost to innermost so inner values override outer
  const reversedGroups = [...parentGroups].reverse();
  
  for (const group of reversedGroups) {
    const data = group.data;
    
    switch (data.groupType) {
      case 'subscription':
        if (data.subscriptionId) {
          inherited.subscriptionId = data.subscriptionId;
        }
        if (data.name) {
          inherited.subscriptionName = data.name;
        }
        break;
        
      case 'region':
        if (data.location || data.regionName) {
          inherited.location = data.location || data.regionName;
        }
        if (data.name) {
          inherited.regionName = data.name;
        }
        break;
        
      case 'resourceGroup':
        if (data.name) {
          inherited.resourceGroupName = data.name;
        }
        if (data.location) {
          inherited.location = data.location;
        }
        break;
        
      case 'virtualNetwork':
        if (data.name) {
          inherited.virtualNetworkName = data.name;
        }
        if (data.addressSpace) {
          inherited.virtualNetworkAddressSpace = data.addressSpace;
        }
        break;
        
      case 'subnet':
        if (data.name) {
          inherited.subnetName = data.name;
        }
        if (data.addressPrefix) {
          inherited.subnetAddressPrefix = data.addressPrefix;
        }
        break;
        
      case 'availabilityZone':
        if (data.name) {
          inherited.availabilityZone = data.name;
        }
        break;
    }
  }
  
  return inherited;
}

/**
 * Find the nearest Resource Group ancestor for a given position.
 * Services should only be direct children of Resource Groups.
 * Returns the Resource Group node or null if not inside any Resource Group.
 */
export function findNearestResourceGroup(
  position: XYPosition,
  nodes: DiagramNode[]
): GroupNode | null {
  const parentGroups = findAllParentGroups(position, nodes);
  
  // Find the innermost Resource Group
  for (const group of parentGroups) {
    if (group.data.groupType === 'resourceGroup') {
      return group;
    }
  }
  
  return null;
}

/**
 * Find all nodes (services and groups) that are visually inside a given group node.
 * Uses absolute positions to properly detect containment in nested groups.
 * Returns nodes that are contained within the group's bounding box.
 */
export function findChildrenOfGroup(
  groupNode: GroupNode,
  allNodes: DiagramNode[]
): DiagramNode[] {
  const groupWidth = groupNode.measured?.width ?? groupNode.width ?? (groupNode.style?.width as number) ?? 300;
  const groupHeight = groupNode.measured?.height ?? groupNode.height ?? (groupNode.style?.height as number) ?? 200;
  
  // Get the group's absolute position
  const groupAbsPos = getAbsolutePosition(groupNode, allNodes);
  
  return allNodes.filter(node => {
    // Don't include the group itself
    if (node.id === groupNode.id) return false;
    
    // Get the node's absolute position
    const nodeAbsPos = getAbsolutePosition(node, allNodes);
    
    // Check if node's center is inside the group (using absolute positions)
    const nodeWidth = node.measured?.width ?? node.width ?? (node.style?.width as number) ?? 100;
    const nodeHeight = node.measured?.height ?? node.height ?? (node.style?.height as number) ?? 80;
    const nodeCenterX = nodeAbsPos.x + nodeWidth / 2;
    const nodeCenterY = nodeAbsPos.y + nodeHeight / 2;
    
    return (
      nodeCenterX >= groupAbsPos.x &&
      nodeCenterX <= groupAbsPos.x + groupWidth &&
      nodeCenterY >= groupAbsPos.y &&
      nodeCenterY <= groupAbsPos.y + groupHeight
    );
  });
}

/**
 * Apply inherited properties to a node based on its type.
 * Returns a new data object with inherited properties merged in.
 */
export function applyInheritedPropertiesToNode(
  node: DiagramNode,
  inheritedProps: Record<string, unknown>
): ServiceNodeData | GroupNodeData {
  if (node.type === 'service') {
    const serviceData = node.data;
    const existingProperties = typeof serviceData.properties === 'object' && serviceData.properties !== null
      ? serviceData.properties
      : {};
    
    return {
      ...serviceData,
      location: (inheritedProps.location as string | undefined) || serviceData.location,
      resourceGroupName: (inheritedProps.resourceGroupName as string | undefined) || serviceData.resourceGroupName,
      subscriptionId: (inheritedProps.subscriptionId as string | undefined) || serviceData.subscriptionId,
      virtualNetworkName: (inheritedProps.virtualNetworkName as string | undefined) || serviceData.virtualNetworkName,
      subnetName: (inheritedProps.subnetName as string | undefined) || serviceData.subnetName,
      properties: {
        ...existingProperties,
        ...inheritedProps,
      },
    };
  }
  
  // node.type === 'group'
  const groupData = node.data;
  return {
    ...groupData,
    location: (inheritedProps.location as string | undefined) || groupData.location,
    subscriptionId: (inheritedProps.subscriptionId as string | undefined) || groupData.subscriptionId,
    resourceGroupName: (inheritedProps.resourceGroupName as string | undefined) || groupData.resourceGroupName,
    virtualNetworkName: (inheritedProps.virtualNetworkName as string | undefined) || groupData.virtualNetworkName,
  };
}

/**
 * Get inherited properties for edge-connected nodes based on their resource types.
 * When a source service is connected to a target service, the target may inherit
 * certain properties from the source based on common Azure patterns.
 */
export function getEdgeInheritedProperties(
  sourceData: ServiceNodeData,
  targetData: ServiceNodeData,
  edgeData?: ConnectionEdgeData
): Record<string, unknown> {
  const inherited: Record<string, unknown> = {};
  
  const sourceType = sourceData.resourceType?.toLowerCase() || '';
  const targetType = targetData.resourceType?.toLowerCase() || '';
  
  // App Service Plan -> App Service/Function App
  // Microsoft requires: properties.serverFarmId
  if (sourceType.includes('serverfarms') || sourceType.includes('appserviceplan')) {
    if (targetType.includes('sites') || targetType.includes('webapp') || targetType.includes('functionapp')) {
      // Use the actual property name that Microsoft expects
      inherited.serverFarmId = sourceData.name || sourceData.displayName;
      inherited.appServicePlanName = sourceData.name || sourceData.displayName;
      if (sourceData.properties?.sku) {
        inherited.appServicePlanSku = sourceData.properties.sku;
      }
    }
  }
  
  // Virtual Network -> Subnet/Services with VNet integration
  if (sourceType.includes('virtualnetwork')) {
    inherited.virtualNetworkName = sourceData.name;
    if (sourceData.properties?.addressSpace) {
      inherited.virtualNetworkAddressSpace = sourceData.properties.addressSpace;
    }
  }
  
  // Subnet -> Services deployed in subnet
  if (sourceType.includes('subnet')) {
    inherited.subnetName = sourceData.name;
    if (sourceData.properties?.addressPrefix) {
      inherited.subnetAddressPrefix = sourceData.properties.addressPrefix;
    }
    // Also inherit parent VNet name if available
    if (sourceData.virtualNetworkName) {
      inherited.virtualNetworkName = sourceData.virtualNetworkName;
    }
  }
  
  // Storage Account -> Services using storage
  if (sourceType.includes('storageaccounts')) {
    inherited.storageAccountName = sourceData.name;
  }
  
  // Key Vault -> Services using Key Vault
  if (sourceType.includes('keyvault')) {
    inherited.keyVaultName = sourceData.name;
  }
  
  // SQL Server -> SQL Database
  // Microsoft requires: parent reference (database is child of server)
  if (sourceType.includes('sql/servers') && !sourceType.includes('database')) {
    if (targetType.includes('database')) {
      inherited.sqlServerName = sourceData.name || sourceData.displayName;
      inherited.parentServerName = sourceData.name || sourceData.displayName; // For parent reference
    }
  }
  
  // Cosmos DB Account -> Cosmos DB Database
  if (sourceType.includes('databaseaccounts')) {
    if (targetType.includes('database')) {
      inherited.cosmosDbAccountName = sourceData.name;
    }
  }
  
  // Application Insights -> App Service/Function
  if (sourceType.includes('insights') || sourceType.includes('applicationinsights')) {
    inherited.applicationInsightsName = sourceData.name;
    if (sourceData.properties?.instrumentationKey) {
      inherited.applicationInsightsKey = sourceData.properties.instrumentationKey;
    }
  }
  
  // Log Analytics Workspace -> Application Insights and other resources
  // Microsoft requires: properties.WorkspaceResourceId for Application Insights
  if (sourceType.includes('workspaces') && sourceType.includes('operationalinsights')) {
    inherited.logAnalyticsWorkspaceName = sourceData.name || sourceData.displayName;
    inherited.WorkspaceResourceId = sourceData.name || sourceData.displayName; // Correct Microsoft property name
  }
  
  // Container Registry -> AKS/Container Apps
  if (sourceType.includes('containerregist')) {
    if (targetType.includes('kubernetes') || targetType.includes('containerapps')) {
      inherited.containerRegistryName = sourceData.name;
    }
  }
  
  // Service Bus Namespace -> Queues/Topics
  if (sourceType.includes('servicebus') && sourceType.includes('namespace')) {
    inherited.serviceBusNamespace = sourceData.name;
  }
  
  // Event Hub Namespace -> Event Hubs
  if (sourceType.includes('eventhub') && sourceType.includes('namespace')) {
    inherited.eventHubNamespace = sourceData.name;
  }
  
  // Redis Cache -> Services using cache
  if (sourceType.includes('redis')) {
    inherited.redisCacheName = sourceData.name;
  }
  
  // API Management -> Backend APIs
  if (sourceType.includes('apimanagement')) {
    inherited.apiManagementName = sourceData.name;
  }
  
  // If edge has a custom label, use it as a hint for property name
  if (edgeData?.label && typeof edgeData.label === 'string') {
    const propertyName = edgeData.label.replace(/[^a-zA-Z0-9]/g, '');
    if (propertyName && sourceData.name) {
      inherited[propertyName] = sourceData.name;
    }
  }
  
  return inherited;
}

export function formatBytes(bytes: number, decimals = 2): string {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB', 'PB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

export function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  if (minutes < 60) return `${minutes}m ${remainingSeconds}s`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return `${hours}h ${remainingMinutes}m`;
}

export function formatCurrency(amount: number, currency: string = 'USD'): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
  }).format(amount);
}

export function debounce<T extends (...args: unknown[]) => unknown>(
  fn: T,
  delay: number
): (...args: Parameters<T>) => void {
  let timeoutId: ReturnType<typeof setTimeout>;
  return (...args: Parameters<T>) => {
    clearTimeout(timeoutId);
    timeoutId = setTimeout(() => fn(...args), delay);
  };
}

export function throttle<T extends (...args: unknown[]) => unknown>(
  fn: T,
  limit: number
): (...args: Parameters<T>) => void {
  let inThrottle: boolean;
  return (...args: Parameters<T>) => {
    if (!inThrottle) {
      fn(...args);
      inThrottle = true;
      setTimeout(() => (inThrottle = false), limit);
    }
  };
}

export function downloadFile(content: string, filename: string, mimeType: string = 'text/plain'): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export function copyToClipboard(text: string): Promise<void> {
  return navigator.clipboard.writeText(text);
}

export function getResourceTypeShortName(resourceType: string): string {
  const parts = resourceType.split('/');
  return parts[parts.length - 1];
}

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}
