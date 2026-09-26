// Diagram Canvas Component

import { useCallback, useRef, useEffect } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  Panel,
  type ReactFlowInstance,
  type NodeTypes,
  type EdgeTypes,
  BackgroundVariant,
  ConnectionMode,
  type Node,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { Icon } from '@iconify/react';

import { useDiagramStore } from '@/store';
import { useDiagram } from '@/hooks/useDiagram';
import { ServiceNode } from '@/components/nodes/ServiceNode';
import { GroupNode } from '@/components/nodes/GroupNode';
import { ConnectionEdge } from '@/components/edges/ConnectionEdge';
import type { DiagramNode, DiagramEdge } from '@/types';

const nodeTypes: NodeTypes = {
  service: ServiceNode,
  group: GroupNode,
};

const edgeTypes: EdgeTypes = {
  connection: ConnectionEdge,
};

export function DiagramCanvas() {
  const reactFlowWrapper = useRef<HTMLDivElement>(null);
  const reactFlowInstance = useRef<ReactFlowInstance<DiagramNode, DiagramEdge> | null>(null);

  const { nodes, edges, onNodesChange, onEdgesChange, onConnect, selectNode, refreshNodeInheritance, refreshAllInheritance, undo, redo, canUndo, canRedo } =
    useDiagramStore();
  const { handleDrop, handleDragOver } = useDiagram();

  // Keyboard shortcut for undo/redo
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key === 'z') {
        event.preventDefault();
        if (event.shiftKey) {
          redo();
        } else {
          undo();
        }
      }
      if ((event.ctrlKey || event.metaKey) && event.key === 'y') {
        event.preventDefault();
        redo();
      }
    };
    
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [undo, redo]);

  const onInit = useCallback((instance: ReactFlowInstance<DiagramNode, DiagramEdge>) => {
    reactFlowInstance.current = instance;
  }, []);

  const onDrop = useCallback(
    (event: React.DragEvent) => {
      handleDrop(event, reactFlowInstance.current);
    },
    [handleDrop]
  );

  const onNodeClick = useCallback(
    (_: React.MouseEvent, node: { id: string }) => {
      selectNode(node.id);
    },
    [selectNode]
  );

  const onPaneClick = useCallback(() => {
    selectNode(null);
  }, [selectNode]);

  // When a node is dragged to a new position, refresh its inherited properties
  const onNodeDragStop = useCallback(
    (_event: React.MouseEvent, node: Node) => {
      // If a group was moved, refresh all inheritance as children may have moved too
      if (node.type === 'group') {
        refreshAllInheritance();
      } else {
        // For individual nodes, just refresh their own inheritance
        refreshNodeInheritance(node.id);
      }
    },
    [refreshNodeInheritance, refreshAllInheritance]
  );
  return (
    <div ref={reactFlowWrapper} className="flex-1 h-full">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onInit={onInit}
        onDrop={onDrop}
        onDragOver={handleDragOver}
        onNodeClick={onNodeClick}
        onNodeDragStop={onNodeDragStop}
        onPaneClick={onPaneClick}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        defaultEdgeOptions={{
          type: 'connection',
          animated: true,
        }}
        fitView
        snapToGrid
        snapGrid={[15, 15]}
        connectionMode={ConnectionMode.Loose}
        minZoom={0.2}
        maxZoom={2}
        deleteKeyCode={['Backspace', 'Delete']}
        selectionKeyCode={['Shift']}
        multiSelectionKeyCode={['Meta', 'Control']}
        className="bg-gray-100"
      >
        <Background
          variant={BackgroundVariant.Dots}
          gap={20}
          size={1}
          color="#d1d5db"
        />
        <Controls
          showZoom
          showFitView
          showInteractive
          className="!bg-white !border-gray-300 !shadow-md"
        />
        
        {/* Undo/Redo buttons */}
        <Panel position="bottom-left" className="!ml-12 !mb-2">
          <div className="flex gap-0.5 bg-white border border-gray-300 rounded shadow-md">
            <button
              onClick={undo}
              disabled={!canUndo()}
              title="Undo (Ctrl+Z)"
              className="p-1.5 text-gray-600 hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed transition-colors rounded-l"
            >
              <Icon icon="mdi:undo" className="w-4 h-4" />
            </button>
            <button
              onClick={redo}
              disabled={!canRedo()}
              title="Redo (Ctrl+Y)"
              className="p-1.5 text-gray-600 hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed transition-colors rounded-r"
            >
              <Icon icon="mdi:redo" className="w-4 h-4" />
            </button>
          </div>
        </Panel>
        
        <MiniMap
          nodeColor={(node) => {
            if (node.type === 'group') {
              return (node.data as { color?: string })?.color || '#0078D4';
            }
            return '#0078D4';
          }}
          maskColor="rgba(0, 0, 0, 0.1)"
          className="!bg-white !border-gray-300"
        />

        {/* Empty State */}
        {nodes.length === 0 && (
          <Panel position="top-center" className="mt-20">
            <div className="text-center py-12 px-8 bg-white/95 backdrop-blur rounded-xl border border-brand-primary/30 shadow-lg max-w-md">
              <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-brand-primary/10 flex items-center justify-center">
                <svg
                  className="w-8 h-8 text-brand-primary"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={1.5}
                    d="M12 4v16m8-8H4"
                  />
                </svg>
              </div>
              <h3 className="text-lg font-semibold text-gray-900 mb-2">
                Start Building Your Architecture
              </h3>
              <p className="text-sm text-brand-grayLight mb-4">
                Drag Azure services from the left panel onto this canvas. 
                Connect them to define dependencies.
              </p>
              <div className="flex items-center justify-center gap-2 text-xs text-brand-grayMedium">
                <span className="flex items-center gap-1">
                  <kbd className="px-1.5 py-0.5 bg-brand-charcoal rounded text-[10px] text-brand-grayLight">
                    Ctrl
                  </kbd>
                  <span>+ click to multi-select</span>
                </span>
              </div>
            </div>
          </Panel>
        )}
      </ReactFlow>
    </div>
  );
}

export default DiagramCanvas;
