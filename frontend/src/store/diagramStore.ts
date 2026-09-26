import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import { 
  applyNodeChanges, 
  applyEdgeChanges,
  addEdge,
  MarkerType,
  type NodeChange,
  type EdgeChange,
  type Connection,
  type XYPosition,
} from '@xyflow/react';
import type { 
  DiagramNode, 
  DiagramEdge, 
  ServiceNodeData, 
  GroupNodeData,
  ConnectionEdgeData,
  SerializedDiagram,
  GroupNode,
  ExportDiagram,
  ExportNode,
  ExportEdge,
  ExportServiceData,
  ExportGroupData,
  ExportConnectionType,
  ExportValidationResult,
  ExportValidationError,
} from '@/types';
import { 
  generateId, 
  detectParentGroup, 
  findAllParentGroups, 
  inheritPropertiesFromGroups,
  findChildrenOfGroup,
  applyInheritedPropertiesToNode,
  findNearestResourceGroup,
  getAbsolutePosition,
  // getEdgeInheritedProperties removed - now using dynamic schema inheritance
} from '@/lib/utils';
import { getDynamicEdgeInheritanceSync, getDynamicEdgeInheritance } from '@/lib/dynamicSchemaInheritance';

// History snapshot for undo/redo
interface HistorySnapshot {
  nodes: DiagramNode[];
  edges: DiagramEdge[];
}

const MAX_HISTORY_SIZE = 50;

interface DiagramState {
  // State
  nodes: DiagramNode[];
  edges: DiagramEdge[];
  selectedNodeId: string | null;
  selectedEdgeId: string | null;
  
  // History for undo/redo
  history: HistorySnapshot[];
  historyIndex: number;
  
  // Current active tab ID (for tracking which tab owns this state)
  currentTabId: string | null;
  
  // Actions
  onNodesChange: (changes: NodeChange<DiagramNode>[]) => void;
  onEdgesChange: (changes: EdgeChange<DiagramEdge>[]) => void;
  onConnect: (connection: Connection) => void;
  
  addServiceNode: (data: Omit<ServiceNodeData, 'status'>, position: XYPosition) => string;
  addGroupNode: (data: GroupNodeData, position: XYPosition, size?: { width: number; height: number }) => string;
  updateNodeData: (nodeId: string, data: Partial<ServiceNodeData | GroupNodeData>) => void;
  refreshNodeInheritance: (nodeId: string) => void;
  refreshAllInheritance: () => void;
  fixServiceParents: () => void;
  bringToFront: (nodeId: string) => void;
  sendToBack: (nodeId: string) => void;
  removeNode: (nodeId: string) => void;
  removeEdge: (edgeId: string) => void;
  addDependencyEdge: (sourceId: string, targetId: string, propertyPath: string) => void;
  
  selectNode: (nodeId: string | null) => void;
  selectEdge: (edgeId: string | null) => void;
  
  clearDiagram: () => void;
  loadDiagram: (diagram: SerializedDiagram) => void;
  
  // Tab content management
  saveCurrentToTab: () => { nodes: DiagramNode[]; edges: DiagramEdge[]; history: HistorySnapshot[]; historyIndex: number };
  loadFromTab: (content: { nodes: DiagramNode[]; edges: DiagramEdge[]; history: HistorySnapshot[]; historyIndex: number }, tabId: string) => void;
  setCurrentTabId: (tabId: string | null) => void;
  
  // History actions
  saveToHistory: () => void;
  undo: () => void;
  redo: () => void;
  canUndo: () => boolean;
  canRedo: () => boolean;
  
  // Getters
  getNode: (nodeId: string) => DiagramNode | undefined;
  getEdge: (edgeId: string) => DiagramEdge | undefined;
  getSelectedNode: () => DiagramNode | undefined;
  getServiceNodes: () => DiagramNode[];
  getGroupNodes: () => DiagramNode[];
  serializeDiagram: () => SerializedDiagram;
  getDiagramForExport: () => ExportDiagram;
  validateDiagramForExport: () => ExportValidationResult;
}

export const useDiagramStore = create<DiagramState>()(
  devtools(
    // Note: We don't persist diagramStore directly - tabsStore handles per-tab content persistence
    (set, get) => ({
      // Initial state
      nodes: [],
      edges: [],
      selectedNodeId: null,
      selectedEdgeId: null,
      history: [],
      historyIndex: -1,
      currentTabId: null,
      
      // Tab content management
      saveCurrentToTab: () => {
          const { nodes, edges, history, historyIndex } = get();
          return {
            nodes: JSON.parse(JSON.stringify(nodes)),
            edges: JSON.parse(JSON.stringify(edges)),
            history: JSON.parse(JSON.stringify(history)),
            historyIndex,
          };
        },
        
        loadFromTab: (content, tabId) => {
          set({
            nodes: content.nodes || [],
            edges: content.edges || [],
            history: content.history || [],
            historyIndex: content.historyIndex ?? -1,
            selectedNodeId: null,
            selectedEdgeId: null,
            currentTabId: tabId,
          });
        },
        
        setCurrentTabId: (tabId) => {
          set({ currentTabId: tabId });
        },
        
        // Save current state to history (call before making changes)
        saveToHistory: () => {
          const { nodes, edges, history, historyIndex } = get();
          // Create snapshot of current state
          const snapshot: HistorySnapshot = {
            nodes: JSON.parse(JSON.stringify(nodes)),
            edges: JSON.parse(JSON.stringify(edges)),
          };
          // Trim future history if we're not at the end
          const newHistory = history.slice(0, historyIndex + 1);
          newHistory.push(snapshot);
          // Limit history size
          if (newHistory.length > MAX_HISTORY_SIZE) {
            newHistory.shift();
          }
          set({
            history: newHistory,
            historyIndex: newHistory.length - 1,
          });
        },
        
        // Undo to previous state
        undo: () => {
          const { history, historyIndex, nodes, edges } = get();
          if (historyIndex < 0) return;
          
          // Save current state to allow redo back to it
          if (historyIndex === history.length - 1) {
            const currentSnapshot: HistorySnapshot = {
              nodes: JSON.parse(JSON.stringify(nodes)),
              edges: JSON.parse(JSON.stringify(edges)),
            };
            const newHistory = [...history, currentSnapshot];
            set({
              nodes: history[historyIndex].nodes,
              edges: history[historyIndex].edges,
              history: newHistory,
              historyIndex: historyIndex - 1,
              selectedNodeId: null,
              selectedEdgeId: null,
            });
          } else {
            set({
              nodes: history[historyIndex].nodes,
              edges: history[historyIndex].edges,
              historyIndex: historyIndex - 1,
              selectedNodeId: null,
              selectedEdgeId: null,
            });
          }
        },
        
        // Redo to next state
        redo: () => {
          const { history, historyIndex } = get();
          if (historyIndex >= history.length - 1) return;
          
          const nextIndex = historyIndex + 1;
          set({
            nodes: history[nextIndex].nodes,
            edges: history[nextIndex].edges,
            historyIndex: nextIndex,
            selectedNodeId: null,
            selectedEdgeId: null,
          });
        },
        
        canUndo: () => get().historyIndex >= 0,
        canRedo: () => get().historyIndex < get().history.length - 1,
        
        // Node change handlers (for React Flow)
        onNodesChange: (changes) => {
          set((state) => ({
            nodes: applyNodeChanges(changes, state.nodes) as DiagramNode[],
          }));
        },
        
        onEdgesChange: (changes) => {
          set((state) => ({
            edges: applyEdgeChanges(changes, state.edges) as DiagramEdge[],
          }));
        },
        
        onConnect: (connection) => {
          // Save current state to history before making changes
          get().saveToHistory();
          
          const edgeData: ConnectionEdgeData = {
            connectionType: 'dependency',
            animated: true,
          };
          
          const allNodes = get().nodes;
          const sourceNode = allNodes.find(n => n.id === connection.source);
          const targetNode = allNodes.find(n => n.id === connection.target);
          
          // Apply edge-based property inheritance using DYNAMIC schema detection
          // BIDIRECTIONAL: Check both directions to handle any edge drawing direction
          let updatedNodes = allNodes;
          if (sourceNode?.type === 'service' && targetNode?.type === 'service') {
            const sourceData = sourceNode.data as ServiceNodeData;
            const targetData = targetNode.data as ServiceNodeData;
            
            // Cast to access all fields including those not in the strict type
            const sourceDataAny = sourceData as Record<string, unknown>;
            const targetDataAny = targetData as Record<string, unknown>;
            
            // Build complete data objects for both nodes
            const fullSourceData: Record<string, unknown> = {
              ...sourceData.properties,
              name: sourceDataAny.label || sourceData.name || sourceData.displayName || sourceDataAny.title || '',
              label: sourceDataAny.label || '',
              title: sourceDataAny.title || sourceData.displayName || '',
              nodeId: sourceNode.id,
              resourceType: sourceData.resourceType,
            };
            
            const fullTargetData: Record<string, unknown> = {
              ...targetData.properties,
              name: targetDataAny.label || targetData.name || targetData.displayName || targetDataAny.title || '',
              label: targetDataAny.label || '',
              title: targetDataAny.title || targetData.displayName || '',
              nodeId: targetNode.id,
              resourceType: targetData.resourceType,
            };
            
            console.log('[DiagramStore] Edge connection - checking BOTH directions:', {
              source: { resourceType: sourceData.resourceType, label: sourceDataAny.label },
              target: { resourceType: targetData.resourceType, label: targetDataAny.label }
            });
            
            // DIRECTION 1: Source provides to Target (e.g., App Service Plan → App Service)
            const inheritedToTarget = getDynamicEdgeInheritanceSync(
              sourceData.resourceType || '',
              targetData.resourceType || '',
              fullSourceData
            );
            
            // DIRECTION 2: Target provides to Source (e.g., if user drew SQL Database → SQL Server, 
            // we still want SQL Database to get the parent reference)
            const inheritedToSource = getDynamicEdgeInheritanceSync(
              targetData.resourceType || '',
              sourceData.resourceType || '',
              fullTargetData
            );
            
            console.log('[DiagramStore] Inheritance results:', {
              inheritedToTarget,
              inheritedToSource
            });
            
            // Apply properties to the appropriate nodes
            updatedNodes = allNodes.map(node => {
              // Apply inherited props to TARGET node
              if (node.id === targetNode.id && node.type === 'service' && Object.keys(inheritedToTarget).length > 0) {
                const existingData = node.data as ServiceNodeData;
                const existingProps = existingData.properties || {};
                return {
                  ...node,
                  data: {
                    ...existingData,
                    properties: {
                      ...existingProps,
                      ...inheritedToTarget,
                    },
                  },
                };
              }
              // Apply inherited props to SOURCE node (for reverse direction)
              if (node.id === sourceNode.id && node.type === 'service' && Object.keys(inheritedToSource).length > 0) {
                const existingData = node.data as ServiceNodeData;
                const existingProps = existingData.properties || {};
                return {
                  ...node,
                  data: {
                    ...existingData,
                    properties: {
                      ...existingProps,
                      ...inheritedToSource,
                    },
                  },
                };
              }
              return node;
            }) as DiagramNode[];
            
            // Also trigger ASYNC schema fetch for more accurate inheritance
            // This will update the node again with schema-driven properties
            getDynamicEdgeInheritance(
              sourceData.resourceType || '',
              targetData.resourceType || '',
              fullSourceData
            ).then(asyncInheritedProps => {
              if (Object.keys(asyncInheritedProps).length > 0) {
                // Update the target node with schema-driven properties
                set((state) => ({
                  nodes: state.nodes.map(node => {
                    if (node.id === targetNode.id && node.type === 'service') {
                      const existingData = node.data as ServiceNodeData;
                      const existingProps = existingData.properties || {};
                      return {
                        ...node,
                        data: {
                          ...existingData,
                          properties: {
                            ...existingProps,
                            ...asyncInheritedProps,
                          },
                        },
                      };
                    }
                    return node;
                  }) as DiagramNode[],
                }));
              }
            }).catch(err => {
              console.warn('Async schema inheritance failed, using sync fallback:', err);
            });
          }
          
          set((state) => ({
            nodes: updatedNodes,
            edges: addEdge(
              {
                ...connection,
                id: generateId('edge'),
                type: 'connection',
                data: edgeData,
                markerEnd: {
                  type: MarkerType.ArrowClosed,
                  color: '#0078D4',
                  width: 20,
                  height: 20,
                },
              },
              state.edges
            ) as DiagramEdge[],
          }));
        },
        
        // Add service node with property inheritance from parent groups
        // Services should ONLY be direct children of Resource Groups
        addServiceNode: (data, position) => {
          // Save current state to history before making changes
          get().saveToHistory();
          
          const id = generateId('service');
          const allNodes = get().nodes;
          
          // Find all parent groups to inherit properties from
          const parentGroups = findAllParentGroups(position, allNodes);
          const inheritedProps = inheritPropertiesFromGroups(parentGroups);
          
          // Find the nearest Resource Group - services should only be children of Resource Groups
          const resourceGroupNode = findNearestResourceGroup(position, allNodes);
          const parentId = resourceGroupNode?.id || null;
          const resourceGroupName = resourceGroupNode?.data.name || (inheritedProps.resourceGroupName as string | undefined);
          
          // Calculate position relative to parent if there is one
          // React Flow expects child positions to be relative to their parent
          let relativePosition = position;
          if (parentId && resourceGroupNode) {
            const parentAbsolutePos = getAbsolutePosition(resourceGroupNode, allNodes);
            relativePosition = {
              x: position.x - parentAbsolutePos.x,
              y: position.y - parentAbsolutePos.y,
            };
          }
          
          // Safely get existing properties
          const existingProperties = typeof data.properties === 'object' && data.properties !== null
            ? data.properties
            : {};
          
          // Calculate z-index: service nodes should always be above all group nodes
          // Groups typically have z-index 0-100 based on depth, so services get 1000+
          const maxCurrentZIndex = Math.max(...allNodes.map(n => n.zIndex ?? 0), 0);
          const serviceZIndex = Math.max(1000, maxCurrentZIndex + 1);
          
          // Merge inherited properties into the service node data
          const newNode: DiagramNode = {
            id,
            type: 'service',
            position: relativePosition,
            // Set high z-index to ensure service is always clickable above groups
            zIndex: serviceZIndex,
            data: {
              ...data,
              status: 'draft',
              // Apply inherited properties
              location: (inheritedProps.location as string | undefined) || data.location,
              resourceGroupName: resourceGroupName || data.resourceGroupName,
              subscriptionId: (inheritedProps.subscriptionId as string | undefined) || data.subscriptionId,
              virtualNetworkName: (inheritedProps.virtualNetworkName as string | undefined) || data.virtualNetworkName,
              subnetName: (inheritedProps.subnetName as string | undefined) || data.subnetName,
              // Merge inherited props into properties object too
              properties: {
                ...existingProperties,
                ...inheritedProps,
              },
            } as ServiceNodeData,
            parentId: parentId || undefined,
          };
          
          set((state) => ({
            nodes: [...state.nodes, newNode],
            selectedNodeId: id,
          }));
          
          return id;
        },
        
        // Add group node with property inheritance from parent groups
        addGroupNode: (data, position, size) => {
          // Save current state to history before making changes
          get().saveToHistory();
          
          const id = generateId('group');
          const allNodes = get().nodes;
          const parentId = detectParentGroup(position, allNodes);
          
          // Find all parent groups to inherit properties from
          const parentGroups = findAllParentGroups(position, allNodes);
          const inheritedProps = inheritPropertiesFromGroups(parentGroups);
          
          // Calculate position relative to parent if there is one
          // React Flow expects child positions to be relative to their parent
          let relativePosition = position;
          if (parentId) {
            const parentNode = allNodes.find(n => n.id === parentId);
            if (parentNode) {
              const parentAbsolutePos = getAbsolutePosition(parentNode, allNodes);
              relativePosition = {
                x: position.x - parentAbsolutePos.x,
                y: position.y - parentAbsolutePos.y,
              };
            }
          }
          
          // Calculate z-index based on nesting depth (parent groups have lower z-index)
          // Region = 0, Subscription = 10, ResourceGroup = 20, etc.
          // This ensures child groups render above parent groups
          const nestingDepth = parentGroups.length;
          const groupZIndex = nestingDepth * 10;
          
          // Merge inherited properties into the group node data
          const mergedData: GroupNodeData = {
            ...data,
            // Inherit location from parent region or resource group
            location: (inheritedProps.location as string | undefined) || data.location,
            // Inherit subscription info from parent subscription
            subscriptionId: (inheritedProps.subscriptionId as string | undefined) || data.subscriptionId,
            // Inherit resource group name if inside a resource group
            resourceGroupName: (inheritedProps.resourceGroupName as string | undefined) || data.resourceGroupName,
            // Inherit virtual network name if inside a vnet
            virtualNetworkName: (inheritedProps.virtualNetworkName as string | undefined) || data.virtualNetworkName,
          };
          
          const newNode: DiagramNode = {
            id,
            type: 'group',
            position: relativePosition,
            // Set z-index based on nesting depth (groups always below services)
            zIndex: groupZIndex,
            data: mergedData,
            parentId: parentId || undefined,
            style: {
              width: size?.width || 300,
              height: size?.height || 200,
            },
          };
          
          set((state) => ({
            nodes: [...state.nodes, newNode],
            selectedNodeId: id,
          }));
          
          return id;
        },
        
        // Update node data with live propagation to all children and edge-connected nodes
        updateNodeData: (nodeId, data) => {
          set((state) => {
            // First, update the target node
            let updatedNodes = state.nodes.map((node) => {
              if (node.id === nodeId) {
                return { ...node, data: { ...node.data, ...data } } as DiagramNode;
              }
              return node;
            });
            
            // Check if the updated node is a group - if so, propagate to children
            const updatedNode = updatedNodes.find(n => n.id === nodeId);
            if (updatedNode && updatedNode.type === 'group') {
              const groupNode = updatedNode as GroupNode;
              
              // Find all children (nodes inside this group)
              const children = findChildrenOfGroup(groupNode, updatedNodes);
              
              if (children.length > 0) {
                // Update all children with inherited properties using absolute positions
                updatedNodes = updatedNodes.map(node => {
                  // Check if this node needs updating
                  const needsUpdate = children.some(n => n.id === node.id);
                  if (!needsUpdate) return node;
                  
                  // Get node's absolute position for proper parent detection
                  const absolutePos = getAbsolutePosition(node, updatedNodes);
                  const parentGroups = findAllParentGroups(absolutePos, updatedNodes);
                  const inheritedProps = inheritPropertiesFromGroups(parentGroups);
                  
                  // Apply inherited properties
                  const newData = applyInheritedPropertiesToNode(node, inheritedProps);
                  return { ...node, data: newData } as DiagramNode;
                });
              }
            }
            
            // If the updated node is a service, propagate to edge-connected nodes
            if (updatedNode && updatedNode.type === 'service') {
              // Find edges where this node is the source (this node provides to others)
              const outgoingEdges = state.edges.filter(e => e.source === nodeId);
              
              for (const edge of outgoingEdges) {
                const targetNode = updatedNodes.find(n => n.id === edge.target);
                if (targetNode && targetNode.type === 'service') {
                  const sourceData = updatedNode.data as ServiceNodeData;
                  const targetData = targetNode.data as ServiceNodeData;
                  
                  // Use DYNAMIC inheritance instead of hardcoded
                  const inheritedEdgeProps = getDynamicEdgeInheritanceSync(
                    sourceData.resourceType || '',
                    targetData.resourceType || '',
                    sourceData.properties || {}
                  );
                  
                  if (Object.keys(inheritedEdgeProps).length > 0) {
                    updatedNodes = updatedNodes.map(n => {
                      if (n.id === edge.target) {
                        const existingProps = typeof targetData.properties === 'object' ? targetData.properties : {};
                        return {
                          ...n,
                          data: {
                            ...n.data,
                            ...inheritedEdgeProps,
                            properties: {
                              ...existingProps,
                              ...inheritedEdgeProps,
                            },
                          },
                        } as DiagramNode;
                      }
                      return n;
                    });
                  }
                }
              }
            }
            
            return { nodes: updatedNodes };
          });
        },
        
        // Refresh inherited properties for a single node based on its current position
        refreshNodeInheritance: (nodeId) => {
          set((state) => {
            const node = state.nodes.find(n => n.id === nodeId);
            if (!node) return state;
            
            const parentGroups = findAllParentGroups(node.position, state.nodes);
            const inheritedProps = inheritPropertiesFromGroups(parentGroups);
            const newData = applyInheritedPropertiesToNode(node, inheritedProps);
            
            const updatedNodes = state.nodes.map(n => {
              if (n.id === nodeId) {
                return { ...n, data: newData } as DiagramNode;
              }
              return n;
            });
            
            return { nodes: updatedNodes };
          });
        },
        
        // Refresh all nodes' inherited properties based on their positions AND edge connections
        // Uses DYNAMIC schema-based inheritance for edge connections
        refreshAllInheritance: () => {
          set((state) => {
            // First pass: apply parent group inheritance
            let updatedNodes = state.nodes.map(node => {
              const parentGroups = findAllParentGroups(node.position, state.nodes);
              const inheritedProps = inheritPropertiesFromGroups(parentGroups);
              const newData = applyInheritedPropertiesToNode(node, inheritedProps);
              return { ...node, data: newData } as DiagramNode;
            });
            
            // Second pass: apply DYNAMIC edge-based inheritance (sync version)
            for (const edge of state.edges) {
              const sourceNode = updatedNodes.find(n => n.id === edge.source);
              const targetNode = updatedNodes.find(n => n.id === edge.target);
              
              if (sourceNode?.type === 'service' && targetNode?.type === 'service') {
                const sourceData = sourceNode.data as ServiceNodeData;
                const targetData = targetNode.data as ServiceNodeData;
                
                // Use DYNAMIC sync inheritance instead of hardcoded
                const edgeInheritedProps = getDynamicEdgeInheritanceSync(
                  sourceData.resourceType || '',
                  targetData.resourceType || '',
                  sourceData.properties || {}
                );
                
                if (Object.keys(edgeInheritedProps).length > 0) {
                  updatedNodes = updatedNodes.map(node => {
                    if (node.id === targetNode.id && node.type === 'service') {
                      const existingData = node.data as ServiceNodeData;
                      const existingProps = existingData.properties || {};
                      return {
                        ...node,
                        data: {
                          ...existingData,
                          properties: {
                            ...existingProps,
                            ...edgeInheritedProps,
                          },
                        },
                      } as DiagramNode;
                    }
                    return node;
                  });
                }
              }
            }
            
            return { nodes: updatedNodes };
          });
          
          // Also trigger async schema-driven refresh for more accuracy
          const currentNodes = get().nodes;
          const currentEdges = get().edges;
          
          // Process all edges asynchronously for schema-driven properties
          Promise.all(
            currentEdges.map(async (edge) => {
              const sourceNode = currentNodes.find(n => n.id === edge.source);
              const targetNode = currentNodes.find(n => n.id === edge.target);
              
              if (sourceNode?.type === 'service' && targetNode?.type === 'service') {
                const sourceData = sourceNode.data as ServiceNodeData;
                const targetData = targetNode.data as ServiceNodeData;
                
                try {
                  const asyncProps = await getDynamicEdgeInheritance(
                    sourceData.resourceType || '',
                    targetData.resourceType || '',
                    sourceData.properties || {}
                  );
                  
                  if (Object.keys(asyncProps).length > 0) {
                    return { targetId: targetNode.id, props: asyncProps };
                  }
                } catch (err) {
                  console.warn(`Async schema fetch failed for edge ${edge.id}:`, err);
                }
              }
              return null;
            })
          ).then(results => {
            const validResults = results.filter(r => r !== null) as Array<{targetId: string, props: Record<string, unknown>}>;
            
            if (validResults.length > 0) {
              set((state) => ({
                nodes: state.nodes.map(node => {
                  const matchingResult = validResults.find(r => r.targetId === node.id);
                  if (matchingResult && node.type === 'service') {
                    const existingData = node.data as ServiceNodeData;
                    const existingProps = existingData.properties || {};
                    return {
                      ...node,
                      data: {
                        ...existingData,
                        properties: {
                          ...existingProps,
                          ...matchingResult.props,
                        },
                      },
                    } as DiagramNode;
                  }
                  return node;
                }),
              }));
            }
          }).catch(err => {
            console.warn('Async schema refresh failed:', err);
          });
        },

        // Fix all service nodes to have Resource Group as their direct parent
        // This repairs legacy data where services were parented to Region/Subscription
        // Also fixes z-index to ensure services are always clickable above groups
        // Handles position conversion from absolute to relative when assigning parentId
        fixServiceParents: () => {
          set((state) => {
            // First pass: fix group z-index based on nesting depth
            let updatedNodes = state.nodes.map(node => {
              if (node.type !== 'group') return node;
              
              // Calculate nesting depth for this group using its absolute position
              const absPos = getAbsolutePosition(node, state.nodes);
              const parentGroups = findAllParentGroups(absPos, state.nodes);
              // Don't count the node itself in the depth
              const nestingDepth = parentGroups.filter(g => g.id !== node.id).length;
              const groupZIndex = nestingDepth * 10;
              
              return {
                ...node,
                zIndex: groupZIndex,
              } as DiagramNode;
            });
            
            // Second pass: fix service nodes
            let serviceZIndex = 1000; // Start services at z-index 1000
            updatedNodes = updatedNodes.map(node => {
              // Only fix service nodes
              if (node.type !== 'service') return node;
              
              // Get the service's absolute position (in case it already has a parent)
              const serviceAbsPos = getAbsolutePosition(node, updatedNodes);
              
              // Find the nearest Resource Group using the absolute position
              const resourceGroup = findNearestResourceGroup(serviceAbsPos, updatedNodes);
              const resourceGroupId = resourceGroup?.id || undefined;
              const resourceGroupName = resourceGroup?.data.name;
              
              // Also update inherited properties
              const parentGroups = findAllParentGroups(serviceAbsPos, updatedNodes);
              const inheritedProps = inheritPropertiesFromGroups(parentGroups);
              
              const serviceData = node.data as ServiceNodeData;
              
              serviceZIndex++; // Increment for each service
              
              // Calculate new relative position if we're assigning to a Resource Group
              let newPosition = node.position;
              if (resourceGroup && resourceGroupId !== node.parentId) {
                // Get the Resource Group's absolute position
                const rgAbsPos = getAbsolutePosition(resourceGroup, updatedNodes);
                // Convert service's absolute position to relative (to the RG)
                newPosition = {
                  x: serviceAbsPos.x - rgAbsPos.x,
                  y: serviceAbsPos.y - rgAbsPos.y,
                };
                // Add a small offset to place it nicely inside the RG
                newPosition.x = Math.max(20, newPosition.x);
                newPosition.y = Math.max(50, newPosition.y); // Account for header
              }
              
              return {
                ...node,
                position: newPosition,
                parentId: resourceGroupId,
                zIndex: serviceZIndex, // Ensure high z-index
                data: {
                  ...serviceData,
                  resourceGroupName: resourceGroupName || serviceData.resourceGroupName,
                  location: (inheritedProps.location as string | undefined) || serviceData.location,
                  subscriptionId: (inheritedProps.subscriptionId as string | undefined) || serviceData.subscriptionId,
                } as ServiceNodeData,
              } as DiagramNode;
            });
            
            return { nodes: updatedNodes };
          });
        },
        
        // Bring node to front (highest z-index and move to end of array)
        bringToFront: (nodeId) => {
          set((state) => {
            const node = state.nodes.find(n => n.id === nodeId);
            if (!node) return state;
            
            const maxZIndex = Math.max(...state.nodes.map(n => n.zIndex ?? 0), 0);
            
            // For service nodes inside groups, we need special handling
            // Move the node to the end of its sibling group (nodes with same parent)
            const otherNodes = state.nodes.filter(n => n.id !== nodeId);
            const updatedNode = { ...node, zIndex: maxZIndex + 1 };
            
            // If node has a parent, insert it right after all siblings
            if (node.parentId) {
              // Find the last sibling (node with same parent)
              let insertIndex = otherNodes.length;
              for (let i = otherNodes.length - 1; i >= 0; i--) {
                if (otherNodes[i].parentId === node.parentId) {
                  insertIndex = i + 1;
                  break;
                }
              }
              const updatedNodes = [
                ...otherNodes.slice(0, insertIndex),
                updatedNode,
                ...otherNodes.slice(insertIndex),
              ];
              return { nodes: updatedNodes };
            }
            
            // For top-level nodes, move to end
            return { nodes: [...otherNodes, updatedNode] };
          });
        },
        
        // Send node to back (lowest z-index and move to start of array)
        sendToBack: (nodeId) => {
          set((state) => {
            const node = state.nodes.find(n => n.id === nodeId);
            if (!node) return state;
            
            const minZIndex = Math.min(...state.nodes.map(n => n.zIndex ?? 0), 0);
            
            const otherNodes = state.nodes.filter(n => n.id !== nodeId);
            const updatedNode = { ...node, zIndex: minZIndex - 1 };
            
            // If node has a parent, insert it right after the parent
            if (node.parentId) {
              const parentIndex = otherNodes.findIndex(n => n.id === node.parentId);
              if (parentIndex !== -1) {
                const updatedNodes = [
                  ...otherNodes.slice(0, parentIndex + 1),
                  updatedNode,
                  ...otherNodes.slice(parentIndex + 1),
                ];
                return { nodes: updatedNodes };
              }
            }
            
            // For top-level nodes (not groups themselves as they need to contain children)
            // Only move to front if it's a service node without children
            const hasChildren = state.nodes.some(n => n.parentId === nodeId);
            if (!hasChildren) {
              return { nodes: [updatedNode, ...otherNodes] };
            }
            
            // For groups with children, just update zIndex but keep order
            return {
              nodes: state.nodes.map(n => 
                n.id === nodeId ? updatedNode : n
              ),
            };
          });
        },
        
        // Remove node
        removeNode: (nodeId) => {
          // Save current state to history before making changes
          get().saveToHistory();
          
          set((state) => ({
            nodes: state.nodes.filter((node) => node.id !== nodeId),
            edges: state.edges.filter(
              (edge) => edge.source !== nodeId && edge.target !== nodeId
            ),
            selectedNodeId: state.selectedNodeId === nodeId ? null : state.selectedNodeId,
          }));
        },
        
        // Remove edge
        removeEdge: (edgeId) => {
          // Save current state to history before making changes
          get().saveToHistory();
          
          set((state) => ({
            edges: state.edges.filter((edge) => edge.id !== edgeId),
            selectedEdgeId: state.selectedEdgeId === edgeId ? null : state.selectedEdgeId,
          }));
        },
        
        // Add a dependency edge between two nodes
        addDependencyEdge: (sourceId, targetId, propertyPath) => {
          const edgeId = generateId('dep-edge');
          const edgeData: ConnectionEdgeData = {
            connectionType: 'dependency',
            label: propertyPath.split('.').pop() || 'dependency',
            animated: true,
          };
          
          set((state) => ({
            edges: [
              ...state.edges,
              {
                id: edgeId,
                source: sourceId,
                target: targetId,
                type: 'connection',
                data: edgeData,
              } as DiagramEdge,
            ],
          }));
        },
        
        // Selection
        selectNode: (nodeId) => {
          set({ selectedNodeId: nodeId, selectedEdgeId: null });
        },
        
        selectEdge: (edgeId) => {
          set({ selectedEdgeId: edgeId, selectedNodeId: null });
        },
        
        // Clear diagram
        clearDiagram: () => {
          set({
            nodes: [],
            edges: [],
            selectedNodeId: null,
            selectedEdgeId: null,
          });
        },
        
        // Load diagram
        loadDiagram: (diagram) => {
          set({
            nodes: diagram.nodes.map((node) => ({
              id: node.id,
              type: node.type,
              position: node.position,
              data: node.data,
              parentId: node.parentId,
              style: node.width && node.height
                ? { width: node.width, height: node.height }
                : undefined,
            })) as DiagramNode[],
            edges: diagram.edges.map((edge) => ({
              id: edge.id,
              source: edge.source,
              target: edge.target,
              sourceHandle: edge.sourceHandle,
              targetHandle: edge.targetHandle,
              type: 'connection',
              data: edge.data,
            })) as DiagramEdge[],
            selectedNodeId: null,
            selectedEdgeId: null,
          });
        },
        
        // Getters
        getNode: (nodeId) => get().nodes.find((node) => node.id === nodeId),
        
        getEdge: (edgeId) => get().edges.find((edge) => edge.id === edgeId),
        
        getSelectedNode: () => {
          const { nodes, selectedNodeId } = get();
          return selectedNodeId ? nodes.find((node) => node.id === selectedNodeId) : undefined;
        },
        
        getServiceNodes: () => get().nodes.filter((node) => node.type === 'service'),
        
        getGroupNodes: () => get().nodes.filter((node) => node.type === 'group'),
        
        serializeDiagram: () => {
          const { nodes, edges } = get();
          return {
            nodes: nodes.map((node) => ({
              id: node.id,
              type: node.type as 'service' | 'group',
              data: node.data,
              position: node.position,
              parentId: node.parentId,
              width: node.measured?.width ?? (node.style as { width?: number })?.width,
              height: node.measured?.height ?? (node.style as { height?: number })?.height,
            })),
            edges: edges.map((edge) => ({
              id: edge.id,
              source: edge.source,
              target: edge.target,
              sourceHandle: edge.sourceHandle,
              targetHandle: edge.targetHandle,
              data: edge.data,
            })),
          };
        },

        /**
         * Get diagram in export format for IaC generation backend.
         * Transforms internal node/edge structure to a clean export format
         * with azure.service and azure.group types.
         * EXCLUDES visual-only nodes (User, Internet, etc.)
         */
        getDiagramForExport: (): ExportDiagram => {
          const { nodes, edges } = get();
          
          // Filter out visual-only nodes
          const exportableNodes = nodes.filter((node) => {
            if (node.type === 'service') {
              const data = node.data as ServiceNodeData;
              return !data.isVisualOnly;
            }
            return true; // Groups are always exportable
          });
          
          const exportableNodeIds = new Set(exportableNodes.map(n => n.id));

          // Transform nodes to export format
          const exportNodes: ExportNode[] = exportableNodes.map((node) => {
            // Only set parentId if the parent actually exists
            const hasValidParent = node.parentId && exportableNodeIds.has(node.parentId);

            if (node.type === 'service') {
              const data = node.data as ServiceNodeData;
              const exportData: ExportServiceData = {
                title: data.displayName || data.name,
                label: data.name,
                resourceType: data.resourceType,
                region: data.location,
                resourceGroup: data.resourceGroupName,
                subscriptionId: data.subscriptionId,
                sku: data.sku,
                properties: data.properties,
                // VNet integration to an existing network (referenced, not created).
                vnetIntegrationEnabled: data.vnetIntegrationEnabled,
                virtualNetworkName: data.virtualNetworkName,
                subnetName: data.subnetName,
                subnetResourceId: data.subnetResourceId,
                networkResourceGroup: data.networkResourceGroup,
                // Approved public-access exception when no VNet is available.
                networkExceptionEnabled: data.networkExceptionEnabled,
                networkExceptionJustification: data.networkExceptionJustification,
              };

              // Determine export type prefix based on node's CSP (default: azure)
              const serviceCsp = (data as ServiceNodeData).csp ?? 'azure';
              const serviceExportType: 'aws.service' | 'azure.service' = serviceCsp === 'aws' ? 'aws.service' : 'azure.service';
              return {
                id: node.id,
                type: serviceExportType,
                position: { x: node.position.x, y: node.position.y },
                parentId: hasValidParent ? node.parentId : undefined,
                extent: hasValidParent ? ('parent' as const) : undefined,
                data: exportData,
              };
            } else {
              // Group node
              const data = node.data as GroupNodeData;
              
              // Add resourceType for Resource Groups
              const resourceType = data.groupType === 'resourceGroup' 
                ? 'Microsoft.Resources/resourceGroups' 
                : undefined;
              
              const exportData: ExportGroupData = {
                title: data.displayName || data.name,
                label: data.name,
                groupType: data.groupType,
                resourceType,
                region: data.location || data.regionName,
                subscriptionId: data.subscriptionId,
                addressSpace: data.addressSpace,
                addressPrefix: data.addressPrefix,
              };

              // For groups, detect AWS groups by groupType prefix
              const isAwsGroup = typeof data.groupType === 'string' && data.groupType.startsWith('aws');
              const groupExportType: 'aws.group' | 'azure.group' = isAwsGroup ? 'aws.group' : 'azure.group';
              return {
                id: node.id,
                type: groupExportType,
                position: { x: node.position.x, y: node.position.y },
                parentId: hasValidParent ? node.parentId : undefined,
                extent: hasValidParent ? ('parent' as const) : undefined,
                data: exportData,
              };
            }
          });

          // Transform edges to export format - only include edges with valid source/target (excludes visual nodes)
          const exportEdges: ExportEdge[] = edges
            .filter(edge => exportableNodeIds.has(edge.source) && exportableNodeIds.has(edge.target))
            .map((edge) => {
              // Map connection types to export format
              const connectionType: ExportConnectionType = 
                (edge.data?.connectionType as ExportConnectionType) || 'dependency';

              return {
                id: edge.id,
                source: edge.source,
                target: edge.target,
                type: edge.data?.animated ? 'animated' : 'default',
                data: {
                  connectionType,
                  label: edge.data?.label,
                },
              };
            });

          return {
            nodes: exportNodes,
            edges: exportEdges,
          };
        },

        /**
         * Validate diagram before export.
         * Checks for missing parent references, invalid edges, and service parent rules.
         */
        validateDiagramForExport: (): ExportValidationResult => {
          const { nodes, edges } = get();
          const errors: ExportValidationError[] = [];
          const warnings: string[] = [];
          const nodeIds = new Set(nodes.map(n => n.id));

          // Check all parentId references exist
          for (const node of nodes) {
            if (node.parentId && !nodeIds.has(node.parentId)) {
              errors.push({
                type: 'missing_parent',
                message: `Node "${node.id}" references non-existent parent "${node.parentId}"`,
                nodeId: node.id,
              });
            }
          }

          // Check all edge source/target IDs exist
          for (const edge of edges) {
            if (!nodeIds.has(edge.source)) {
              errors.push({
                type: 'missing_edge_node',
                message: `Edge "${edge.id}" references non-existent source node "${edge.source}"`,
                edgeId: edge.id,
              });
            }
            if (!nodeIds.has(edge.target)) {
              errors.push({
                type: 'missing_edge_node',
                message: `Edge "${edge.id}" references non-existent target node "${edge.target}"`,
                edgeId: edge.id,
              });
            }
          }

          // Check all services have a Resource Group as their direct parent
          const serviceNodes = nodes.filter(n => n.type === 'service');
          for (const service of serviceNodes) {
            if (service.parentId) {
              const parent = nodes.find(n => n.id === service.parentId);
              if (parent && parent.type === 'group') {
                const parentData = parent.data as GroupNodeData;
                if (parentData.groupType !== 'resourceGroup') {
                  errors.push({
                    type: 'invalid_service_parent',
                    message: `Service "${service.id}" has parent "${parent.id}" which is a ${parentData.groupType}, not a resourceGroup`,
                    nodeId: service.id,
                  });
                }
              }
            } else {
              // Service without a parent - this is a warning, not an error
              warnings.push(`Service "${service.id}" is not inside a Resource Group`);
            }
          }

          return {
            valid: errors.length === 0,
            errors,
            warnings,
          };
        },
      }),
    // Note: We don't persist diagramStore directly - tabsStore handles per-tab content persistence
    // This prevents conflicts between global diagram state and tab-specific content
    { name: 'DiagramStore' }
  )
);
