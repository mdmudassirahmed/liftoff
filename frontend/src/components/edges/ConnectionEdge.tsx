// Connection Edge Component

import { memo } from 'react';
import {
  BaseEdge,
  EdgeLabelRenderer,
  getSmoothStepPath,
  type EdgeProps,
  MarkerType,
} from '@xyflow/react';
import { Icon } from '@iconify/react';
import { cn } from '@/lib/utils';
import type { ConnectionEdgeData, ConnectionType } from '@/types';

const connectionColors: Record<ConnectionType, string> = {
  dependency: '#0078D4',
  dataflow: '#10B981',
  network: '#6366F1',
  reference: '#8B5CF6',
};

// Direction-aware icons
const getDirectionIcon = (connectionType: ConnectionType, isLeftward: boolean): string => {
  if (connectionType === 'network') return 'mdi:lan-connect';
  if (connectionType === 'reference') return 'mdi:link-variant';
  
  // For dependency and dataflow, show direction-aware arrows
  if (isLeftward) {
    return connectionType === 'dataflow' ? 'mdi:database-arrow-left' : 'mdi:arrow-left-bold';
  }
  return connectionType === 'dataflow' ? 'mdi:database-arrow-right' : 'mdi:arrow-right-bold';
};

function ConnectionEdgeComponent({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
  selected,
}: EdgeProps) {
  const edgeData = data as ConnectionEdgeData | undefined;
  const connectionType = edgeData?.connectionType || 'dependency';
  const label = edgeData?.label;
  const animated = edgeData?.animated ?? true;
  
  const color = connectionColors[connectionType];
  
  // Determine if the edge flows leftward (target is to the left of source)
  const isLeftward = targetX < sourceX;

  const [edgePath, labelX, labelY] = getSmoothStepPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
    borderRadius: 8,
  });

  return (
    <>
      <BaseEdge
        id={id}
        path={edgePath}
        style={{
          stroke: color,
          strokeWidth: selected ? 3 : 2,
        }}
        // BaseEdge types markerEnd as string; keep the existing runtime value unchanged.
        markerEnd={{
          type: MarkerType.ArrowClosed,
          color: color,
          width: 20,
          height: 20,
        } as unknown as string}
        className={cn(animated && 'animated-edge')}
      />
      
      <EdgeLabelRenderer>
        <div
          className={cn(
            'absolute transform -translate-x-1/2 -translate-y-1/2 pointer-events-all',
            'flex items-center gap-1 px-2 py-1 rounded-md bg-white shadow-sm border',
            'text-xs font-medium transition-opacity',
            selected ? 'opacity-100' : 'opacity-70 hover:opacity-100'
          )}
          style={{
            left: labelX,
            top: labelY,
            borderColor: color,
          }}
        >
          <Icon
            icon={getDirectionIcon(connectionType, isLeftward)}
            className="w-3.5 h-3.5"
            style={{ color }}
          />
          {label && <span style={{ color }}>{label}</span>}
        </div>
      </EdgeLabelRenderer>
    </>
  );
}

export const ConnectionEdge = memo(ConnectionEdgeComponent);
export default ConnectionEdge;
