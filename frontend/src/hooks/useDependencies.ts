/**
 * useDependencies Hook
 * 
 * Provides dynamic dependency information for Azure resources.
 * Fetches dependencies from schema service and matches them with canvas nodes.
 */

import { useState, useEffect, useCallback } from 'react';
import { useDiagramStore } from '@/store';
import { getResourceDependencies, type DependencyInfo } from '@/services';
import type { DiagramNode, ServiceNodeData } from '@/types';

export interface ResolvedDependency extends DependencyInfo {
  /** Available nodes on canvas that can satisfy this dependency */
  availableNodes: DiagramNode[];
  /** Currently linked node ID (if any) */
  linkedNodeId: string | null;
  /** Whether this dependency is satisfied */
  isSatisfied: boolean;
}

export interface UseDependenciesResult {
  dependencies: ResolvedDependency[];
  isLoading: boolean;
  error: string | null;
  linkDependency: (dependency: DependencyInfo, targetNodeId: string) => void;
  unlinkDependency: (dependency: DependencyInfo) => void;
}

export function useDependencies(nodeId: string | null): UseDependenciesResult {
  const [dependencies, setDependencies] = useState<ResolvedDependency[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const nodes = useDiagramStore((state) => state.nodes);
  const edges = useDiagramStore((state) => state.edges);
  const addDependencyEdge = useDiagramStore((state) => state.addDependencyEdge);
  const removeEdge = useDiagramStore((state) => state.removeEdge);

  // Get the selected node
  const selectedNode = nodes.find((n) => n.id === nodeId);
  const resourceType = selectedNode?.type === 'service' 
    ? (selectedNode.data as ServiceNodeData).resourceType 
    : null;

  // Fetch dependencies when node changes
  useEffect(() => {
    if (!resourceType || !nodeId) {
      setDependencies([]);
      return;
    }

    let cancelled = false;
    setIsLoading(true);
    setError(null);

    async function loadDependencies() {
      try {
        const deps = await getResourceDependencies(resourceType!);
        
        if (cancelled) return;

        // Resolve each dependency with available nodes
        const resolved: ResolvedDependency[] = deps.map((dep) => {
          // Find nodes that match this dependency's resource type
          const availableNodes = nodes.filter((n) => {
            if (n.type !== 'service') return false;
            const nodeData = n.data as ServiceNodeData;
            // Match by resource type (handle both exact and partial matches)
            return nodeData.resourceType === dep.resourceType ||
              nodeData.resourceType.startsWith(dep.resourceType.split('/')[0]);
          });

          // Check if there's already an edge linking this dependency
          const existingEdge = edges.find((e) => {
            if (e.source !== nodeId) return false;
            const targetNode = nodes.find((n) => n.id === e.target);
            if (!targetNode || targetNode.type !== 'service') return false;
            const targetData = targetNode.data as ServiceNodeData;
            return targetData.resourceType === dep.resourceType;
          });

          return {
            ...dep,
            availableNodes,
            linkedNodeId: existingEdge?.target || null,
            isSatisfied: !!existingEdge || availableNodes.length > 0,
          };
        });

        setDependencies(resolved);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load dependencies');
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    }

    loadDependencies();
    return () => { cancelled = true; };
  }, [resourceType, nodeId, nodes, edges]);

  // Link a dependency to a target node
  const linkDependency = useCallback((dependency: DependencyInfo, targetNodeId: string) => {
    if (!nodeId) return;

    // First, remove any existing edge for this dependency
    const existingEdge = edges.find((e) => {
      if (e.source !== nodeId) return false;
      const targetNode = nodes.find((n) => n.id === e.target);
      if (!targetNode || targetNode.type !== 'service') return false;
      const targetData = targetNode.data as ServiceNodeData;
      return targetData.resourceType === dependency.resourceType;
    });

    if (existingEdge) {
      removeEdge(existingEdge.id);
    }

    // Create new edge
    addDependencyEdge(nodeId, targetNodeId, dependency.propertyPath);

    // Update local state
    setDependencies((prev) =>
      prev.map((d) =>
        d.resourceType === dependency.resourceType
          ? { ...d, linkedNodeId: targetNodeId, isSatisfied: true }
          : d
      )
    );
  }, [nodeId, edges, nodes, addDependencyEdge, removeEdge]);

  // Unlink a dependency
  const unlinkDependency = useCallback((dependency: DependencyInfo) => {
    if (!nodeId) return;

    const existingEdge = edges.find((e) => {
      if (e.source !== nodeId) return false;
      const targetNode = nodes.find((n) => n.id === e.target);
      if (!targetNode || targetNode.type !== 'service') return false;
      const targetData = targetNode.data as ServiceNodeData;
      return targetData.resourceType === dependency.resourceType;
    });

    if (existingEdge) {
      removeEdge(existingEdge.id);
    }

    // Update local state
    setDependencies((prev) =>
      prev.map((d) =>
        d.resourceType === dependency.resourceType
          ? { ...d, linkedNodeId: null, isSatisfied: false }
          : d
      )
    );
  }, [nodeId, edges, nodes, removeEdge]);

  return {
    dependencies,
    isLoading,
    error,
    linkDependency,
    unlinkDependency,
  };
}

export default useDependencies;
