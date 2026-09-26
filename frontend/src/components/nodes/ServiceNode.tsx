// Service Node Component for React Flow

import { memo, useState, useCallback, useRef, useEffect } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { Icon } from '@iconify/react';
import { cn } from '@/lib/utils';
import { getAzureServiceIcon } from '@/lib/azureIcons';
import { useDiagramStore } from '@/store';
import type { ServiceNodeData, NodeStatus } from '@/types';

const statusColors: Record<NodeStatus, string> = {
  draft: 'border-gray-300 bg-white',
  valid: 'border-green-400 bg-green-50',
  error: 'border-red-400 bg-red-50',
  deploying: 'border-blue-400 bg-blue-50 animate-pulse',
  deployed: 'border-green-500 bg-green-100',
};

const statusIcons: Record<NodeStatus, string> = {
  draft: 'mdi:pencil-outline',
  valid: 'mdi:check-circle-outline',
  error: 'mdi:alert-circle-outline',
  deploying: 'mdi:loading',
  deployed: 'mdi:check-circle',
};

function ServiceNodeComponent({ data, selected, id }: NodeProps) {
  const nodeData = data as ServiceNodeData;
  const { displayName, name, iconPath, status, resourceType, isVisualOnly } = nodeData;
  const [showContextMenu, setShowContextMenu] = useState(false);
  const [contextMenuPos, setContextMenuPos] = useState({ x: 0, y: 0 });
  const contextMenuRef = useRef<HTMLDivElement>(null);
  
  const { bringToFront, sendToBack, removeNode } = useDiagramStore();

  // Adjust context menu position to stay within viewport
  useEffect(() => {
    if (showContextMenu && contextMenuRef.current) {
      const menu = contextMenuRef.current;
      const rect = menu.getBoundingClientRect();
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;
      
      let newX = contextMenuPos.x;
      let newY = contextMenuPos.y;
      
      // Adjust if menu goes off right edge
      if (contextMenuPos.x + rect.width > viewportWidth) {
        newX = viewportWidth - rect.width - 10;
      }
      // Adjust if menu goes off bottom edge
      if (contextMenuPos.y + rect.height > viewportHeight) {
        newY = viewportHeight - rect.height - 10;
      }
      // Ensure not negative
      newX = Math.max(10, newX);
      newY = Math.max(10, newY);
      
      if (newX !== contextMenuPos.x || newY !== contextMenuPos.y) {
        // Repositioning after measuring the rendered menu is the intended use of this effect.
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setContextMenuPos({ x: newX, y: newY });
      }
    }
  }, [showContextMenu, contextMenuPos]);

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    // Use pageX/pageY for absolute positioning that accounts for scroll
    setContextMenuPos({ x: e.pageX, y: e.pageY });
    setShowContextMenu(true);
  }, []);

  const handleCloseContextMenu = useCallback(() => {
    setShowContextMenu(false);
  }, []);

  const handleBringToFront = useCallback(() => {
    bringToFront(id);
    setShowContextMenu(false);
  }, [bringToFront, id]);

  const handleSendToBack = useCallback(() => {
    sendToBack(id);
    setShowContextMenu(false);
  }, [sendToBack, id]);

  const handleDelete = useCallback(() => {
    removeNode(id);
    setShowContextMenu(false);
  }, [removeNode, id]);

  return (
    <>
      {isVisualOnly ? (
        /* Visual-only element - circular with prominent icon */
        <div
          onContextMenu={handleContextMenu}
          className={cn(
            'flex flex-col items-center gap-2 p-3 transition-all service-node-wrapper',
            selected && 'ring-2 ring-indigo-500 ring-offset-2 rounded-full'
          )}
        >
          {/* Left Handle */}
          <Handle
            type="source"
            position={Position.Left}
            id="left"
            className="w-3 h-3 !bg-indigo-500 border-2 border-white"
          />

          {/* Circular Icon Container */}
          <div className="w-16 h-16 rounded-full bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center shadow-lg">
            <Icon 
              icon={getAzureServiceIcon(iconPath)} 
              className="w-9 h-9 text-white" 
            />
          </div>

          {/* Label */}
          <span className="text-sm font-medium text-gray-700 text-center max-w-[100px] truncate">
            {displayName}
          </span>

          {/* Right Handle */}
          <Handle
            type="source"
            position={Position.Right}
            id="right"
            className="w-3 h-3 !bg-indigo-500 border-2 border-white"
          />
        </div>
      ) : (
        /* Regular Azure service node */
        <div
          onContextMenu={handleContextMenu}
          className={cn(
            'px-4 py-3 rounded-lg border-2 shadow-md min-w-[180px] transition-all service-node-wrapper',
            statusColors[status],
            selected && 'ring-2 ring-brand-primary ring-offset-2'
          )}
      >
        {/* Left Handle - Source type so we can drag FROM this side */}
        <Handle
          type="source"
          position={Position.Left}
          id="left"
          className={cn('w-3 h-3 border-2 border-white', nodeData.csp === 'aws' ? '!bg-[#FF9900]' : '!bg-azure-blue')}
        />

        {/* Node Content */}
        <div className="flex items-start gap-3">
          {/* Icon - Uses Iconify */}
          <div className={cn('flex-shrink-0 w-10 h-10 rounded-md flex items-center justify-center', nodeData.csp === 'aws' ? 'bg-[#FF9900]/10' : 'bg-azure-blue/10')}>
            <Icon
              icon={nodeData.csp === 'aws' ? (iconPath || 'mdi:aws') : getAzureServiceIcon(iconPath)}
              className={cn('w-6 h-6', nodeData.csp === 'aws' ? 'text-[#FF9900]' : 'text-azure-blue')}
            />
          </div>

          {/* Text Content */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <h3 className="font-semibold text-sm text-gray-900 truncate">
                {displayName}
              </h3>
              <Icon
                icon={statusIcons[status]}
                className={cn(
                  'w-4 h-4 flex-shrink-0',
                  status === 'error' && 'text-red-500',
                  status === 'valid' && 'text-green-500',
                  status === 'deployed' && 'text-green-600',
                  status === 'deploying' && 'text-blue-500 animate-spin',
                  status === 'draft' && 'text-gray-400'
                )}
              />
            </div>
            <p className="text-xs text-gray-500 truncate">{name}</p>
            <p className="text-xs text-gray-400 truncate mt-0.5">
              {resourceType.split('/').pop()}
            </p>
          </div>
        </div>

        {/* Right Handle - Source type so we can drag FROM this side */}
        <Handle
          type="source"
          position={Position.Right}
          id="right"
          className={cn('w-3 h-3 border-2 border-white', nodeData.csp === 'aws' ? '!bg-[#FF9900]' : '!bg-azure-blue')}
        />
      </div>
      )}

      {/* Context Menu */}
      {showContextMenu && (
        <>
          <div 
            className="fixed inset-0" 
            style={{ zIndex: 9998 }}
            onClick={handleCloseContextMenu}
          />
          <div
            ref={contextMenuRef}
            className="fixed bg-white rounded-lg shadow-lg border border-gray-200 py-1 min-w-[160px]"
            style={{ left: contextMenuPos.x, top: contextMenuPos.y, zIndex: 9999 }}
          >
            <button
              onClick={handleBringToFront}
              className="w-full px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-100 flex items-center gap-2"
            >
              <Icon icon="mdi:arrange-bring-to-front" className="w-4 h-4" />
              Bring to Front
            </button>
            <button
              onClick={handleSendToBack}
              className="w-full px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-100 flex items-center gap-2"
            >
              <Icon icon="mdi:arrange-send-to-back" className="w-4 h-4" />
              Send to Back
            </button>
            <hr className="my-1 border-gray-200" />
            <button
              onClick={handleDelete}
              className="w-full px-4 py-2 text-left text-sm text-red-600 hover:bg-red-50 flex items-center gap-2"
            >
              <Icon icon="mdi:delete-outline" className="w-4 h-4" />
              Delete
            </button>
          </div>
        </>
      )}
    </>
  );
}

export const ServiceNode = memo(ServiceNodeComponent);
export default ServiceNode;
