// Diagram Types for React Flow
import type { Node, Edge, XYPosition } from '@xyflow/react';

// Index signature required for React Flow v12 data compatibility
export interface ServiceNodeData {
  [key: string]: unknown;
  serviceId: string;
  name: string;
  displayName: string;
  resourceType: string;
  iconPath: string;
  status: NodeStatus;
  properties: Record<string, unknown>;
  // Inherited from parent groups
  location?: string;
  resourceGroupName?: string;
  subscriptionId?: string;
  virtualNetworkName?: string;
  subnetName?: string;
  // VNet integration against an EXISTING (centrally managed) network. IaC references these,
  // it never creates the VNet/subnet. subnetResourceId is the authoritative reference.
  vnetIntegrationEnabled?: boolean;
  subnetResourceId?: string;
  networkResourceGroup?: string;
  // Approved exception: when no VNet is available, allow public network access
  // for this one service (documented, surfaced in the compliance report).
  networkExceptionEnabled?: boolean;
  networkExceptionJustification?: string;
  // Service-specific
  sku?: string;
  tags?: Record<string, string>;
  // Visual-only flag - if true, this node is NOT exported to IaC
  isVisualOnly?: boolean;
  // Which CSP this node belongs to. Defaults to 'azure' for backward compat.
  csp?: 'azure' | 'aws';
}

export interface GroupNodeData {
  [key: string]: unknown;
  groupType: GroupNodeType;
  name: string;
  displayName: string;
  // Properties that children can inherit
  location?: string;
  subscriptionId?: string;
  resourceGroupName?: string;
  virtualNetworkName?: string;
  // VNet/Subnet specific
  addressSpace?: string;
  addressPrefix?: string;
  // Region-specific
  regionName?: string;
  // General
  metadata?: Record<string, unknown>;
  color?: string;
}

export type NodeStatus = 'draft' | 'valid' | 'error' | 'deploying' | 'deployed';

export type GroupNodeType =
  // Azure group types
  | 'resourceGroup'
  | 'virtualNetwork'
  | 'subnet'
  | 'region'
  | 'subscription'
  | 'availabilityZone'
  // AWS group types (VPC/subnet are references to pre-existing networking)
  | 'awsAccount'
  | 'awsRegion'
  | 'awsVpc'
  | 'awsSubnet';

export type ServiceNode = Node<ServiceNodeData, 'service'>;
export type GroupNode = Node<GroupNodeData, 'group'>;
export type DiagramNode = ServiceNode | GroupNode;

export interface ConnectionEdgeData {
  [key: string]: unknown;
  connectionType: ConnectionType;
  label?: string;
  animated?: boolean;
}

export type ConnectionType = 'dependency' | 'dataflow' | 'network' | 'reference';

export type DiagramEdge = Edge<ConnectionEdgeData>;

export interface DiagramState {
  nodes: DiagramNode[];
  edges: DiagramEdge[];
  selectedNodeId: string | null;
  selectedEdgeId: string | null;
}

export interface DragData {
  type: 'service' | 'group' | 'visual';
  payload: unknown;
}

export interface NodePosition {
  id: string;
  position: XYPosition;
}

// Serialized types for API
export interface SerializedNode {
  id: string;
  type: 'service' | 'group';
  data: ServiceNodeData | GroupNodeData;
  position: XYPosition;
  parentId?: string;
  width?: number;
  height?: number;
}

export interface SerializedEdge {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string | null;
  targetHandle?: string | null;
  data?: ConnectionEdgeData;
}

// Export format types for IaC generation backend.
// Backward-compat: 'service'/'group' (internal), 'azure.*' (Azure export), 'aws.*' (AWS export).
export type ExportNodeType =
  | 'azure.service' | 'azure.group'
  | 'aws.service' | 'aws.group'
  | 'service' | 'group';
export type ExportConnectionType = 'dependency' | 'network' | 'data' | 'identity';

export interface ExportServiceData {
  title: string;           // Display name (e.g., "Azure OpenAI")
  label: string;           // Instance label (e.g., "openai-177")
  resourceType: string;    // ARM resource type (e.g., "Microsoft.CognitiveServices/accounts")
  region?: string;         // Azure region
  resourceGroup?: string;  // Resource group name
  subscriptionId?: string; // Owning subscription (for cross-subscription references)
  sku?: string;            // SKU tier
  properties?: Record<string, unknown>;
  // VNet integration against an existing (centrally managed) network — referenced, never created.
  vnetIntegrationEnabled?: boolean;
  virtualNetworkName?: string;
  subnetName?: string;
  subnetResourceId?: string;
  networkResourceGroup?: string;
  // Approved public-access exception (only meaningful when VNet integration is off).
  networkExceptionEnabled?: boolean;
  networkExceptionJustification?: string;
}

export interface ExportGroupData {
  title: string;           // Group display name (e.g., "Production Resource Group")
  label: string;           // Group label/identifier
  groupType: GroupNodeType;
  resourceType?: string;   // ARM resource type for Resource Groups: "Microsoft.Resources/resourceGroups"
  region?: string;
  subscriptionId?: string;
  addressSpace?: string;   // For VNets
  addressPrefix?: string;  // For Subnets
}

// Validation types for export
export interface ExportValidationError {
  type: 'missing_parent' | 'missing_edge_node' | 'invalid_service_parent';
  message: string;
  nodeId?: string;
  edgeId?: string;
}

export interface ExportValidationResult {
  valid: boolean;
  errors: ExportValidationError[];
  warnings: string[];
}

export interface ExportNode {
  id: string;
  type: ExportNodeType;
  position: { x: number; y: number };
  parentId?: string;
  extent?: 'parent';
  data: ExportServiceData | ExportGroupData;
}

export interface ExportEdge {
  id: string;
  source: string;
  target: string;
  type: 'animated' | 'default';
  sourceHandle?: string | null;
  targetHandle?: string | null;
  label?: string;
  data: {
    connectionType: ExportConnectionType;
    label?: string;
  };
}

export interface ExportDiagram {
  nodes: ExportNode[];
  edges: ExportEdge[];
}

export interface SerializedDiagram {
  nodes: SerializedNode[];
  edges: SerializedEdge[];
}
