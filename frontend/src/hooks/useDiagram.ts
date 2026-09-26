// Diagram operations hook

import { useCallback } from 'react';
import type { XYPosition, ReactFlowInstance } from '@xyflow/react';
import { useDiagramStore } from '@/store';
import { useCspStore } from '@/store/cspStore';
import type {
  AzureService,
  GroupTemplate,
  VisualTemplate,
  ServiceNodeData,
  GroupNodeData,
  DiagramNode,
  DiagramEdge,
  DragData,
} from '@/types';
import { generateId } from '@/lib/utils';

export function useDiagram() {
  const { activeCsp } = useCspStore();
  const {
    nodes,
    edges,
    selectedNodeId,
    addServiceNode,
    addGroupNode,
    updateNodeData,
    removeNode,
    removeEdge,
    selectNode,
    clearDiagram,
    serializeDiagram,
    getSelectedNode,
    getServiceNodes,
    getGroupNodes,
  } = useDiagramStore();

  const handleDrop = useCallback(
    (
      event: React.DragEvent,
      reactFlowInstance: ReactFlowInstance<DiagramNode, DiagramEdge> | null
    ) => {
      event.preventDefault();

      if (!reactFlowInstance) return;

      const dataString = event.dataTransfer.getData('application/json');
      if (!dataString) return;

      try {
        const dragData: DragData = JSON.parse(dataString);
        
        const position = reactFlowInstance.screenToFlowPosition({
          x: event.clientX,
          y: event.clientY,
        });

        if (dragData.type === 'service') {
          const service = dragData.payload as AzureService;
          addServiceNode(
            {
              serviceId: service.id,
              name: `${service.id}-${generateId('').slice(0, 4)}`,
              displayName: service.name,
              resourceType: service.resourceType,
              iconPath: service.iconPath,
              properties: { ...(service.defaultProperties ?? {}) },
              csp: activeCsp,
            },
            position
          );
        } else if (dragData.type === 'group') {
          const template = dragData.payload as GroupTemplate;
          addGroupNode(
            {
              groupType: template.groupType,
              name: `${template.groupType}-${generateId('').slice(0, 4)}`,
              displayName: template.name,
              color: template.color,
            },
            position,
            template.defaultSize
          );
        } else if (dragData.type === 'visual') {
          // Visual elements are NOT exported to IaC
          const template = dragData.payload as VisualTemplate;
          addServiceNode(
            {
              serviceId: template.id,
              name: `${template.id}-${generateId('').slice(0, 4)}`,
              displayName: template.name,
              resourceType: 'visual.element', // Special type to identify visual-only nodes
              iconPath: template.iconPath,
              properties: {},
              isVisualOnly: true, // Flag to exclude from IaC export
            },
            position
          );
        }
      } catch (error) {
        console.error('Error handling drop:', error);
      }
    },
    [addServiceNode, addGroupNode, activeCsp]
  );

  const handleDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
  }, []);

  const duplicateNode = useCallback(
    (nodeId: string) => {
      const node = nodes.find((n) => n.id === nodeId);
      if (!node) return;

      const offset = { x: 50, y: 50 };
      const newPosition: XYPosition = {
        x: node.position.x + offset.x,
        y: node.position.y + offset.y,
      };

      if (node.type === 'service') {
        const data = node.data as ServiceNodeData;
        addServiceNode(
          {
            ...data,
            name: `${data.name}-copy`,
          },
          newPosition
        );
      } else if (node.type === 'group') {
        const data = node.data as GroupNodeData;
        addGroupNode(
          {
            ...data,
            name: `${data.name}-copy`,
          },
          newPosition,
          {
            width: (node.style as { width?: number })?.width || 300,
            height: (node.style as { height?: number })?.height || 200,
          }
        );
      }
    },
    [nodes, addServiceNode, addGroupNode]
  );

  const updateSelectedNodeProperty = useCallback(
    (key: string, value: unknown) => {
      if (!selectedNodeId) return;
      
      const node = getSelectedNode();
      if (!node) return;

      if (node.type === 'service') {
        const currentData = node.data as ServiceNodeData;
        updateNodeData(selectedNodeId, {
          properties: {
            ...currentData.properties,
            [key]: value,
          },
        });
      } else {
        updateNodeData(selectedNodeId, {
          metadata: {
            ...((node.data as GroupNodeData).metadata || {}),
            [key]: value,
          },
        });
      }
    },
    [selectedNodeId, getSelectedNode, updateNodeData]
  );

  const getNodesByParent = useCallback(
    (parentId: string): DiagramNode[] => {
      return nodes.filter((node) => node.parentId === parentId);
    },
    [nodes]
  );

  const getOrphanNodes = useCallback((): DiagramNode[] => {
    return nodes.filter((node) => !node.parentId && node.type === 'service');
  }, [nodes]);

  const validateDiagram = useCallback((): { valid: boolean; errors: string[] } => {
    const errors: string[] = [];

    // Check for orphan service nodes
    const orphans = getOrphanNodes();
    if (orphans.length > 0) {
      errors.push(
        `${orphans.length} service(s) are not inside a Resource Group`
      );
    }

    // Check for required properties
    const serviceNodes = getServiceNodes() as DiagramNode[];
    for (const node of serviceNodes) {
      const data = node.data as ServiceNodeData;
      if (!data.name || data.name.trim() === '') {
        errors.push(`Service "${data.displayName}" is missing a name`);
      }
      if (!data.location) {
        errors.push(`Service "${data.displayName || data.name}" is missing a location`);
      }
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }, [getOrphanNodes, getServiceNodes]);

  return {
    // State
    nodes,
    edges,
    selectedNodeId,
    selectedNode: getSelectedNode(),
    
    // Actions
    handleDrop,
    handleDragOver,
    duplicateNode,
    updateSelectedNodeProperty,
    removeNode,
    removeEdge,
    selectNode,
    clearDiagram,
    
    // Getters
    getNodesByParent,
    getOrphanNodes,
    getServiceNodes,
    getGroupNodes,
    serializeDiagram,
    validateDiagram,
  };
}
