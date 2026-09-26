// Issues Panel Component - Shows validation issues for the current diagram
// Uses dynamic validation from Azure schema service

import { useMemo, useEffect, useState, useCallback } from 'react';
import { Icon } from '@iconify/react';
import { cn } from '@/lib/utils';
import { useDiagramStore } from '@/store';
import { 
  validateDiagram, 
  getResourceDependencies,
  getIconifyIcon,
  type ValidationIssue, 
  type ValidationResult,
  type DependencyInfo
} from '@/services';

interface IssueCardProps {
  issue: ValidationIssue;
  onNavigate: (nodeId: string) => void;
}

function IssueCard({ issue, onNavigate }: IssueCardProps) {
  const severityConfig = {
    error: {
      icon: 'mdi:alert-circle',
      bg: 'bg-red-50',
      border: 'border-red-200',
      iconColor: 'text-red-500',
      badge: 'bg-red-100 text-red-700',
    },
    warning: {
      icon: 'mdi:alert',
      bg: 'bg-amber-50',
      border: 'border-amber-200',
      iconColor: 'text-amber-500',
      badge: 'bg-amber-100 text-amber-700',
    },
    info: {
      icon: 'mdi:information',
      bg: 'bg-blue-50',
      border: 'border-blue-200',
      iconColor: 'text-blue-500',
      badge: 'bg-blue-100 text-blue-700',
    },
  };

  const config = severityConfig[issue.severity];

  return (
    <div className={cn('rounded-lg border p-3', config.bg, config.border)}>
      <div className="flex items-start gap-2">
        <Icon icon={config.icon} className={cn('w-5 h-5 flex-shrink-0 mt-0.5', config.iconColor)} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className={cn('text-xs font-medium px-1.5 py-0.5 rounded', config.badge)}>
              {issue.severity.toUpperCase()}
            </span>
            <span className="text-xs text-gray-500 truncate">{issue.nodeName}</span>
          </div>
          <h4 className="text-sm font-medium text-gray-900 mb-1">{issue.title}</h4>
          <p className="text-xs text-gray-600 mb-2">{issue.message}</p>
          {issue.suggestion && (
            <div className="text-xs text-gray-500 mb-2">
              <span className="font-medium">Suggestion:</span> {issue.suggestion}
            </div>
          )}
          {issue.dependencies && issue.dependencies.length > 0 && (
            <div className="flex flex-wrap gap-1 mb-2">
              {issue.dependencies.map(dep => (
                <span 
                  key={dep.resourceType}
                  className="inline-flex items-center gap-1 px-2 py-0.5 text-xs rounded-full bg-gray-100 border border-gray-200"
                >
                  <Icon icon={getIconifyIcon(dep.resourceType)} className="w-3 h-3" />
                  {dep.name}
                </span>
              ))}
            </div>
          )}
          <div className="flex gap-2 mt-2">
            <button
              onClick={() => onNavigate(issue.nodeId)}
              className="text-xs text-brand-primary hover:underline flex items-center gap-1"
            >
              <Icon icon="mdi:cursor-default-click" className="w-3 h-3" />
              Select Node
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

interface DependencyInfoProps {
  resourceType: string;
  nodeId: string;
}

interface ResolvedDep extends DependencyInfo {
  isSatisfied: boolean;
}

function DependencyInfoPanel({ resourceType, nodeId }: DependencyInfoProps) {
  const [dependencies, setDependencies] = useState<ResolvedDep[]>([]);
  const [loading, setLoading] = useState(true);
  const nodes = useDiagramStore((state) => state.nodes);
  const edges = useDiagramStore((state) => state.edges);

  useEffect(() => {
    let cancelled = false;
    
    async function loadDependencies() {
      setLoading(true);
      try {
        const deps = await getResourceDependencies(resourceType);
        if (!cancelled) {
          // Check which dependencies are satisfied
          const resolved: ResolvedDep[] = deps.map(dep => {
            // Check if there's a node of this type in the diagram
            const matchingNodes = nodes.filter(n => 
              n.type === 'service' && 
              (n.data as { resourceType?: string })?.resourceType === dep.resourceType
            );
            
            // Check if connected via edge
            const hasConnection = edges.some(e => {
              const isConnected = e.source === nodeId || e.target === nodeId;
              if (!isConnected) return false;
              const otherId = e.source === nodeId ? e.target : e.source;
              const otherNode = nodes.find(n => n.id === otherId);
              return otherNode && (otherNode.data as { resourceType?: string })?.resourceType === dep.resourceType;
            });
            
            // Check if in same scope (same parent)
            const currentNode = nodes.find(n => n.id === nodeId);
            const inSameScope = matchingNodes.some(n => n.parentId === currentNode?.parentId);
            
            return {
              ...dep,
              isSatisfied: hasConnection || inSameScope || matchingNodes.length > 0,
            };
          });
          setDependencies(resolved);
        }
      } catch (error) {
        console.error('Failed to load dependencies:', error);
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    loadDependencies();
    return () => { cancelled = true; };
  }, [resourceType, nodeId, nodes, edges]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-2 text-xs text-gray-500">
        <Icon icon="mdi:loading" className="w-4 h-4 animate-spin" />
        Loading dependencies...
      </div>
    );
  }

  const required = dependencies.filter(d => d.type === 'required');
  const recommended = dependencies.filter(d => d.type === 'recommended');
  const optional = dependencies.filter(d => d.type === 'optional');
  
  // Check satisfaction status
  const allRequiredSatisfied = required.every(d => d.isSatisfied);

  const hasAnyDeps = required.length > 0 || recommended.length > 0 || optional.length > 0;

  if (!hasAnyDeps) {
    return (
      <div className="text-xs text-gray-500 py-2">
        No dependency information available for this service.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {required.length > 0 && (
        <div>
          <h4 className={cn(
            "text-xs font-medium mb-1 flex items-center gap-1",
            allRequiredSatisfied ? "text-green-600" : "text-red-600"
          )}>
            <Icon 
              icon={allRequiredSatisfied ? "mdi:check-circle" : "mdi:alert-circle"} 
              className="w-3.5 h-3.5" 
            />
            Required Dependencies
            {allRequiredSatisfied && <span className="text-[10px] text-green-500 ml-1">(All satisfied)</span>}
          </h4>
          <div className="flex flex-wrap gap-1">
            {required.map(dep => (
              <DependencyBadge key={dep.resourceType} dependency={dep} variant="required" satisfied={dep.isSatisfied} />
            ))}
          </div>
        </div>
      )}
      {recommended.length > 0 && (
        <div>
          <h4 className="text-xs font-medium text-amber-600 mb-1 flex items-center gap-1">
            <Icon icon="mdi:alert" className="w-3.5 h-3.5" />
            Recommended
          </h4>
          <div className="flex flex-wrap gap-1">
            {recommended.map(dep => (
              <DependencyBadge key={dep.resourceType} dependency={dep} variant="recommended" satisfied={dep.isSatisfied} />
            ))}
          </div>
        </div>
      )}
      {optional.length > 0 && (
        <div>
          <h4 className="text-xs font-medium text-blue-600 mb-1 flex items-center gap-1">
            <Icon icon="mdi:information" className="w-3.5 h-3.5" />
            Optional
          </h4>
          <div className="flex flex-wrap gap-1">
            {optional.map(dep => (
              <DependencyBadge key={dep.resourceType} dependency={dep} variant="optional" satisfied={dep.isSatisfied} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

interface DependencyBadgeProps {
  dependency: DependencyInfo;
  variant: 'required' | 'recommended' | 'optional';
  satisfied?: boolean;
}

function DependencyBadge({ dependency, variant, satisfied = false }: DependencyBadgeProps) {
  // If satisfied, always show green regardless of variant
  if (satisfied) {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs rounded-full border bg-green-100 text-green-700 border-green-200">
        <Icon icon="mdi:check-circle" className="w-3 h-3" />
        <Icon icon={getIconifyIcon(dependency.resourceType)} className="w-3 h-3" />
        {dependency.name}
      </span>
    );
  }
  
  const variantStyles = {
    required: 'bg-red-100 text-red-700 border-red-200',
    recommended: 'bg-amber-100 text-amber-700 border-amber-200',
    optional: 'bg-blue-100 text-blue-700 border-blue-200',
  };

  return (
    <span className={cn(
      'inline-flex items-center gap-1 px-2 py-0.5 text-xs rounded-full border',
      variantStyles[variant]
    )}>
      <Icon icon={getIconifyIcon(dependency.resourceType)} className="w-3 h-3" />
      {dependency.name}
    </span>
  );
}

export function IssuesPanel() {
  const nodes = useDiagramStore((state) => state.nodes);
  const edges = useDiagramStore((state) => state.edges);
  const selectNode = useDiagramStore((state) => state.selectNode);
  const selectedNodeId = useDiagramStore((state) => state.selectedNodeId);
  
  const [validation, setValidation] = useState<ValidationResult>({
    isValid: true,
    issues: [],
    checkedAt: new Date(),
    nodeCount: 0,
    edgeCount: 0,
  });
  const [isValidating, setIsValidating] = useState(false);

  // Debounced validation
  useEffect(() => {
    let cancelled = false;
    const timeoutId = setTimeout(async () => {
      setIsValidating(true);
      try {
        const result = await validateDiagram(nodes, edges);
        if (!cancelled) {
          setValidation(result);
        }
      } catch (error) {
        console.error('Validation failed:', error);
      } finally {
        if (!cancelled) {
          setIsValidating(false);
        }
      }
    }, 300); // Debounce 300ms

    return () => {
      cancelled = true;
      clearTimeout(timeoutId);
    };
  }, [nodes, edges]);

  const selectedNode = useMemo(
    () => nodes.find(n => n.id === selectedNodeId),
    [nodes, selectedNodeId]
  );

  const selectedResourceType = selectedNode?.data?.resourceType as string | undefined;

  const handleNavigate = useCallback((nodeId: string) => {
    selectNode(nodeId);
  }, [selectNode]);

  // Group issues by severity
  const errorIssues = validation.issues.filter(i => i.severity === 'error');
  const warningIssues = validation.issues.filter(i => i.severity === 'warning');
  const infoIssues = validation.issues.filter(i => i.severity === 'info');

  return (
    <div className="flex-1 overflow-y-auto">
      {/* Summary Banner */}
      <div className={cn(
        'p-3 border-b',
        validation.isValid ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200'
      )}>
        <div className="flex items-center gap-2">
          {isValidating ? (
            <Icon icon="mdi:loading" className="w-5 h-5 text-gray-500 animate-spin" />
          ) : (
            <Icon 
              icon={validation.isValid ? 'mdi:check-circle' : 'mdi:alert-circle'} 
              className={cn('w-5 h-5', validation.isValid ? 'text-green-500' : 'text-red-500')}
            />
          )}
          <div>
            <h3 className={cn(
              'text-sm font-medium',
              validation.isValid ? 'text-green-800' : 'text-red-800'
            )}>
              {isValidating ? 'Validating...' : validation.isValid ? 'Architecture Validated' : 'Issues Found'}
            </h3>
            <p className="text-xs text-brand-grayMedium">
              {errorIssues.length} errors, {warningIssues.length} warnings, {infoIssues.length} info
            </p>
          </div>
        </div>
      </div>

      {/* Selected Node Dependencies */}
      {selectedResourceType && selectedNodeId && (
        <div className="p-3 border-b border-brand-charcoal bg-brand-charcoal">
          <h3 className="text-xs font-semibold text-brand-grayMedium uppercase tracking-wider mb-2 flex items-center gap-1">
            <Icon icon="mdi:sitemap" className="w-3.5 h-3.5" />
            Dependencies
          </h3>
          <DependencyInfoPanel resourceType={selectedResourceType} nodeId={selectedNodeId} />
        </div>
      )}

      {/* Issues List */}
      <div className="p-3 space-y-3">
        {validation.issues.length === 0 ? (
          <div className="text-center py-8">
            <Icon 
              icon="mdi:check-decagram" 
              className="w-12 h-12 text-brand-primary mx-auto mb-3"
            />
            <p className="text-sm text-brand-grayLight">
              No issues found in your architecture
            </p>
            <p className="text-xs text-brand-grayMedium mt-1">
              Add services to see dependency validation
            </p>
          </div>
        ) : (
          <>
            {/* Errors */}
            {errorIssues.length > 0 && (
              <div className="space-y-2">
                <h4 className="text-xs font-semibold text-red-600 flex items-center gap-1">
                  <Icon icon="mdi:alert-circle" className="w-3.5 h-3.5" />
                  Errors ({errorIssues.length})
                </h4>
                {errorIssues.map(issue => (
                  <IssueCard 
                    key={issue.id} 
                    issue={issue} 
                    onNavigate={handleNavigate}
                  />
                ))}
              </div>
            )}

            {/* Warnings */}
            {warningIssues.length > 0 && (
              <div className="space-y-2">
                <h4 className="text-xs font-semibold text-amber-600 flex items-center gap-1">
                  <Icon icon="mdi:alert" className="w-3.5 h-3.5" />
                  Warnings ({warningIssues.length})
                </h4>
                {warningIssues.map(issue => (
                  <IssueCard 
                    key={issue.id} 
                    issue={issue} 
                    onNavigate={handleNavigate}
                  />
                ))}
              </div>
            )}

            {/* Info */}
            {infoIssues.length > 0 && (
              <div className="space-y-2">
                <h4 className="text-xs font-semibold text-blue-600 flex items-center gap-1">
                  <Icon icon="mdi:information" className="w-3.5 h-3.5" />
                  Info ({infoIssues.length})
                </h4>
                {infoIssues.map(issue => (
                  <IssueCard 
                    key={issue.id} 
                    issue={issue} 
                    onNavigate={handleNavigate}
                  />
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

export default IssuesPanel;
