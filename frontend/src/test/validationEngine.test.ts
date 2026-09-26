import { describe, expect, it } from 'vitest';
import type { Node } from '@xyflow/react';
import type { GroupNodeData, ServiceNodeData } from '@/types/diagram';
import { validateDiagram } from '@/lib/validationEngine';
import { getRequiredDependencies } from '@/lib/serviceDependencies';

type AnyNode = Node<ServiceNodeData | GroupNodeData>;

function service(id: string, serviceId: string, x = 50, y = 50): AnyNode {
  return {
    id,
    type: 'service',
    position: { x, y },
    data: { serviceId, name: id, displayName: id, resourceType: '', properties: {} } as unknown as ServiceNodeData,
  };
}

const resourceGroup: AnyNode = {
  id: 'rg',
  type: 'group',
  position: { x: 0, y: 0 },
  width: 1000,
  height: 1000,
  data: { groupType: 'resourceGroup', label: 'rg', title: 'rg' } as unknown as GroupNodeData,
};

describe('validateDiagram', () => {
  it('knows that an App Service needs an App Service Plan', () => {
    expect(getRequiredDependencies('app-service').map((d) => d.targetServiceId)).toContain('app-service-plan');
  });

  it('reports a missing required dependency as an error', () => {
    const result = validateDiagram([resourceGroup, service('web', 'app-service')]);
    expect(result.isValid).toBe(false);
    expect(result.issues.some((i) => i.severity === 'error' && i.nodeId === 'web')).toBe(true);
  });

  it('clears the error once the dependency is on the canvas', () => {
    const result = validateDiagram([resourceGroup, service('web', 'app-service'), service('plan', 'app-service-plan', 60, 60)]);
    const webErrors = result.issues.filter((i) => i.nodeId === 'web' && i.severity === 'error');
    expect(webErrors.map((i) => i.title).join(' ')).not.toMatch(/App Service Plan/i);
  });

  it('ignores services without rules', () => {
    expect(validateDiagram([service('x', 'does-not-exist')]).issues).toEqual([]);
  });
});
