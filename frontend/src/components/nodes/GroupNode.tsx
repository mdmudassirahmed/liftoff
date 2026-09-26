// Group Node Component for React Flow

import { memo, useState, useCallback, useRef, useEffect } from 'react';
import { NodeResizer, type NodeProps } from '@xyflow/react';
import { Icon } from '@iconify/react';
import { cn } from '@/lib/utils';
import { useDiagramStore } from '@/store';
import type { GroupNodeData, GroupNodeType } from '@/types';
import { getGroupLabel } from '@/data/groupTemplates';

const groupIcons: Record<GroupNodeType, string> = {
  resourceGroup: 'mdi:folder-outline',
  virtualNetwork: 'mdi:lan',
  subnet: 'mdi:lan-pending',
  region: 'mdi:earth',
  subscription: 'mdi:card-account-details-outline',
  availabilityZone: 'mdi:shield-check-outline',
  awsAccount: 'mdi:cloud-outline',
  awsRegion: 'mdi:map-marker-outline',
  awsVpc: 'mdi:network-outline',
  awsSubnet: 'mdi:lan-connect',
};

function GroupNodeComponent({ data, selected, id }: NodeProps) {
  const nodeData = data as GroupNodeData;
  const { groupType, displayName, name, color, location, addressSpace } = nodeData;
  const [showContextMenu, setShowContextMenu] = useState(false);
  const [contextMenuPos, setContextMenuPos] = useState({ x: 0, y: 0 });
  const contextMenuRef = useRef<HTMLDivElement>(null);
  
  const { bringToFront, sendToBack, removeNode } = useDiagramStore();
  
  const borderColor = color || '#0078D4';

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
      <NodeResizer
        minWidth={200}
        minHeight={150}
        isVisible={selected}
        lineClassName="!border-brand-primary"
        handleClassName="!w-3 !h-3 !bg-brand-primary !border-white"
      />
      
      <div
        onContextMenu={handleContextMenu}
        className={cn(
          'w-full h-full rounded-lg border-2 border-dashed group-node-container',
          selected && 'ring-2 ring-brand-primary ring-offset-2'
        )}
        style={{ 
          borderColor,
          // Use transparent background to prevent stacking opacity issues
          // Only the header will have a colored background
          backgroundColor: 'transparent',
        }}
      >
        {/* Header - needs pointer events for context menu */}
        <div
          className="flex items-center gap-2 px-3 py-2 rounded-t-md group-node-header"
          style={{ backgroundColor: `${borderColor}15` }}
          onContextMenu={handleContextMenu}
        >
          <Icon
            icon={groupIcons[groupType]}
            className="w-5 h-5"
            style={{ color: borderColor }}
          />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span
                className="text-xs font-medium px-1.5 py-0.5 rounded"
                style={{ 
                  backgroundColor: borderColor,
                  color: 'white',
                }}
              >
                {getGroupLabel(groupType)}
              </span>
              <span className="text-sm font-semibold text-gray-800 truncate">
                {displayName || name}
              </span>
            </div>
            {(location || addressSpace) && (
              <div className="flex items-center gap-2 mt-1 text-xs text-gray-500">
                {location && (
                  <span className="flex items-center gap-1">
                    <Icon icon="mdi:map-marker" className="w-3 h-3" />
                    {location}
                  </span>
                )}
                {addressSpace && (
                  <span className="flex items-center gap-1">
                    <Icon icon="mdi:ip-network" className="w-3 h-3" />
                    {addressSpace}
                  </span>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Content Area (for child nodes) - pointer events handled by CSS */}
        <div className="p-2 min-h-[100px]">
          {/* Child nodes will be rendered here by React Flow */}
        </div>
      </div>

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

export const GroupNode = memo(GroupNodeComponent);
export default GroupNode;
