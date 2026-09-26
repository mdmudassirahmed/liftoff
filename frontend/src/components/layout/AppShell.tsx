// Main App Shell Layout

import { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { ReactFlowProvider } from '@xyflow/react';
import { TopBar } from './TopBar';
import { TabBar } from './TabBar';
import { ServicePalette } from './ServicePalette';
import { DiagramCanvas } from './DiagramCanvas';
import { RightPanel } from './RightPanel';
import { IaCPreviewModal } from '@/components/modals/IaCPreviewModal';
import { AuthModal } from '@/components/modals/AuthModal';
import { ImportDiagramModal } from '@/components/modals/ImportDiagramModal';
import { PromptDiagramModal } from '@/components/modals/PromptDiagramModal';
import { ChatContainer } from '@/components/Chat';
import { useDiagramStore } from '@/store/diagramStore';
import { useTabsStore } from '@/store/tabsStore';
import { getExample } from '@/lib/examples';
import { useCspStore } from '@/store/cspStore';
import type { CSP } from '@/types/csp';
import agentsService from '@/services/agentsService';
import { api } from '@/services/api';

// Map Azure resource type to icon path
function getIconForResourceType(resourceType: string): string {
  const resourceTypeIcons: Record<string, string> = {
    'Microsoft.Web/serverfarms': 'azure:app-service-plan',
    'Microsoft.Web/sites': 'azure:app-service',
    'Microsoft.KeyVault/vaults': 'azure:key-vault',
    'Microsoft.Storage/storageAccounts': 'azure:storage-account',
    'Microsoft.ManagedIdentity/userAssignedIdentities': 'azure:managed-identity',
    'Microsoft.Compute/virtualMachines': 'azure:virtual-machine',
    'Microsoft.Network/virtualNetworks': 'azure:virtual-network',
    'Microsoft.Sql/servers': 'azure:sql-database',
    'Microsoft.DocumentDB/databaseAccounts': 'azure:cosmos-db',
    'Microsoft.CognitiveServices/accounts': 'azure:cognitive-services',
    'Microsoft.ContainerService/managedClusters': 'azure:kubernetes',
    'Microsoft.ContainerRegistry/registries': 'azure:container-registry',
    'Microsoft.Cache/Redis': 'azure:redis-cache',
    'Microsoft.EventHub/namespaces': 'azure:event-hub',
    'Microsoft.ServiceBus/namespaces': 'azure:service-bus',
    'Microsoft.Insights/components': 'azure:application-insights',
    'Microsoft.ApiManagement/service': 'azure:api-management',
    'Microsoft.Network/applicationGateways': 'azure:application-gateway',
    'Microsoft.Network/loadBalancers': 'azure:load-balancer',
    'Microsoft.Network/publicIPAddresses': 'azure:public-ip',
    'Microsoft.Network/networkSecurityGroups': 'azure:network-security-group',
    'Microsoft.DBforPostgreSQL/flexibleServers': 'azure:postgresql',
    'Microsoft.DBforMySQL/flexibleServers': 'azure:mysql',
  };

  // Try exact match
  if (resourceTypeIcons[resourceType]) {
    return resourceTypeIcons[resourceType];
  }

  // Try partial match based on provider
  const provider = resourceType.split('/')[0];
  if (provider === 'Microsoft.Web') return 'azure:app-service';
  if (provider === 'Microsoft.Compute') return 'azure:virtual-machine';
  if (provider === 'Microsoft.Storage') return 'azure:storage-account';
  if (provider === 'Microsoft.Network') return 'azure:virtual-network';
  if (provider === 'Microsoft.Sql') return 'azure:sql-database';

  // Default fallback
  return 'azure:resource';
}

// Map AWS CloudFormation resource type to MDI icon path (matches awsServices.json catalog exactly)
function getAwsIconForResourceType(resourceType: string): string {
  const awsTypeIcons: Record<string, string> = {
    'AWS::Lambda::Function': 'mdi:function',
    'AWS::EC2::Instance': 'mdi:server',
    'AWS::AutoScaling::AutoScalingGroup': 'mdi:auto-fix',
    'AWS::ECS::Cluster': 'mdi:docker',
    'AWS::ECS::TaskDefinition': 'mdi:clipboard-list',
    'AWS::EKS::Cluster': 'mdi:kubernetes',
    'AWS::S3::Bucket': 'mdi:bucket',
    'AWS::EFS::FileSystem': 'mdi:folder-network',
    'AWS::RDS::DBInstance': 'mdi:database',
    'AWS::RDS::DBCluster': 'mdi:database-check',
    'AWS::DynamoDB::Table': 'mdi:table',
    'AWS::DynamoDB::GlobalTable': 'mdi:table-sync',
    'AWS::ElastiCache::CacheCluster': 'mdi:memory',
    'AWS::Redshift::Cluster': 'mdi:warehouse',
    'AWS::Bedrock::Agent': 'mdi:brain',
    'AWS::SageMaker::NotebookInstance': 'mdi:robot',
    'AWS::IAM::Role': 'mdi:account-key',
    'AWS::SecretsManager::Secret': 'mdi:safe',
    'AWS::KMS::Key': 'mdi:key',
    'AWS::SQS::Queue': 'mdi:tray-full',
    'AWS::SNS::Topic': 'mdi:bell-ring',
    'AWS::Events::Rule': 'mdi:calendar-clock',
    'AWS::StepFunctions::StateMachine': 'mdi:state-machine',
    'AWS::ApiGateway::RestApi': 'mdi:api',
    'AWS::ApiGatewayV2::Api': 'mdi:web',
    'AWS::Glue::Job': 'mdi:puzzle',
    'AWS::Kinesis::Stream': 'mdi:waves',
    'AWS::Athena::WorkGroup': 'mdi:magnify',
    'AWS::Logs::LogGroup': 'mdi:chart-line',
    'AWS::ElasticLoadBalancingV2::LoadBalancer': 'mdi:scale-balance',
    'AWS::CloudFront::Distribution': 'mdi:cloud-outline',
    'AWS::Cognito::UserPool': 'mdi:account-check',
  };
  return awsTypeIcons[resourceType] || 'mdi:aws';
}

export function AppShell() {
  const [isIaCPreviewOpen, setIsIaCPreviewOpen] = useState(false);
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  const [isPromptModalOpen, setIsPromptModalOpen] = useState(false);
  const [isPromptGenerating, setIsPromptGenerating] = useState(false);
  const [promptError, setPromptError] = useState<string | null>(null);
  // Cloud requested by a deep link (?prompt=1&cloud=aws); otherwise the dialog uses the active cloud.
  const [promptCloud, setPromptCloud] = useState<CSP | null>(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [authInfo, setAuthInfo] = useState<{
    user?: string;
    subscriptionName?: string;
    subscriptionId?: string;
    tenantId?: string;
    error?: string;
  }>({});
  
  // Track previous tab to save its content before switching
  const previousTabIdRef = useRef<string | null>(null);
  // Flag to prevent auto-save during tab switch
  const isSwitchingTabRef = useRef(false);
  
  const getDiagramForExport = useDiagramStore((state) => state.getDiagramForExport);
  const saveCurrentToTab = useDiagramStore((state) => state.saveCurrentToTab);
  const loadFromTab = useDiagramStore((state) => state.loadFromTab);
  const loadDiagram = useDiagramStore((state) => state.loadDiagram);
  const currentTabId = useDiagramStore((state) => state.currentTabId);
  const setCurrentTabId = useDiagramStore((state) => state.setCurrentTabId);
  const nodes = useDiagramStore((state) => state.nodes);
  const edges = useDiagramStore((state) => state.edges);
  const { activeCsp } = useCspStore();
  
  const tabs = useTabsStore((state) => state.tabs);
  const activeTabId = useTabsStore((state) => state.activeTabId);
  const createTab = useTabsStore((state) => state.createTab);
  const switchTab = useTabsStore((state) => state.switchTab);

  const refreshAzureAuth = useCallback(async () => {
    const status = await api.getDeployStatus();
    setIsAuthenticated(status.authenticated);
    setAuthInfo({
      user: status.user,
      subscriptionName: status.subscription_name,
      subscriptionId: status.subscription_id,
      tenantId: status.tenant_id,
      error: status.error,
    });
  }, []);

  const handleSignOut = useCallback(async () => {
    await api.logoutDeploy();
    await refreshAzureAuth();
  }, [refreshAzureAuth]);

  // Note: JSON schema for diagram generation is now embedded in the backend
  // Users can provide simple natural-language prompts without schema details
  
  // Debounce timer ref for auto-save
  const saveTimerRef = useRef<NodeJS.Timeout | null>(null);
  
  // Save current diagram content whenever nodes/edges change
  // Use debounce to avoid rapid saves during tab switching
  useEffect(() => {
    // Clear any pending save
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    
    // Don't auto-save during tab switch
    if (isSwitchingTabRef.current) return;
    
    // Don't save if no tab ID
    if (!currentTabId) return;
    
    // Debounce the save to allow tab switching to complete
    saveTimerRef.current = setTimeout(() => {
      // Double-check we're not switching tabs
      if (isSwitchingTabRef.current) return;

      const content = saveCurrentToTab();
      // Use getState() to ensure we're using the latest store state
      useTabsStore.getState().saveTabContent(currentTabId, content);
    }, 200); // 200ms debounce
    
    return () => {
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
      }
    };
  }, [nodes, edges, currentTabId, saveCurrentToTab]);
  
  // Initialize tabs on first load
  useEffect(() => {
    // Read the live store: React StrictMode runs this effect twice on mount and the
    // closure's `tabs.length` would still be 0 the second time.
    if (useTabsStore.getState().tabs.length === 0) {
      // Create initial tab
      const newTabId = createTab('My Project');
      setCurrentTabId(newTabId);
      previousTabIdRef.current = newTabId;
    } else if (!activeTabId && tabs.length > 0) {
      // If no active tab, activate the first one
      switchTab(tabs[0].id);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabs.length, activeTabId]);
  
  // Sync diagram with active tab on tab switch
  useEffect(() => {
    if (!activeTabId) return;
    
    // Get fresh references to store functions
    const { saveTabContent, getTabContent } = useTabsStore.getState();
    
    // If switching to a different tab
    if (previousTabIdRef.current && previousTabIdRef.current !== activeTabId) {
      // Set flag to prevent auto-save from firing during tab switch
      isSwitchingTabRef.current = true;

      // Cancel any pending autosave from the previous tab
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }
      
      // Save current diagram to the previous tab before switching
      const currentContent = saveCurrentToTab();
      saveTabContent(previousTabIdRef.current, currentContent);
      
      // Load the new tab's content - get fresh state
      const newContent = useTabsStore.getState().getTabContent(activeTabId);
      console.log('[TabSwitch] Switching to tab:', activeTabId, 'Content:', newContent ? `${newContent.nodes.length} nodes` : 'empty');
      
      if (newContent && (newContent.nodes.length > 0 || newContent.edges.length > 0)) {
        loadFromTab(newContent, activeTabId);
      } else {
        // New tab with no content - clear the diagram
        loadFromTab({ nodes: [], edges: [], history: [], historyIndex: -1 }, activeTabId);
      }
      
      // Update the ref to current tab
      previousTabIdRef.current = activeTabId;
      setCurrentTabId(activeTabId);
      
      // Clear the flag immediately after the switch completes
      setTimeout(() => {
        isSwitchingTabRef.current = false;
      }, 0);
    } else if (!previousTabIdRef.current) {
      // First time - set the current tab
      previousTabIdRef.current = activeTabId;
      setCurrentTabId(activeTabId);
      
      // Load existing content if available
      const existingContent = getTabContent(activeTabId);
      if (existingContent && existingContent.nodes.length > 0) {
        loadFromTab(existingContent, activeTabId);
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTabId]);
  
  // Save on unmount or browser close. Runs once and reads the live store: a cleanup
  // tied to currentTabId would fire on every tab switch, after the canvas already
  // holds the new tab, and write that diagram into the tab being left.
  useEffect(() => {
    const handleBeforeUnload = () => {
      const { currentTabId: tabId, saveCurrentToTab: snapshot } = useDiagramStore.getState();
      if (tabId) useTabsStore.getState().saveTabContent(tabId, snapshot());
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => {
      handleBeforeUnload();
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, []);
  
  // Handle tab change from TabBar
  const handleTabChange = useCallback((tabId: string) => {
    // Save current content before switching
    if (currentTabId) {
      const content = saveCurrentToTab();
      useTabsStore.getState().saveTabContent(currentTabId, content);
    }
    switchTab(tabId);
  }, [switchTab, currentTabId, saveCurrentToTab]);

  // Handle importing a diagram from JSON
  const handleImportDiagram = useCallback((diagram: { nodes: unknown[]; edges: unknown[] }, projectName: string) => {
    // Save current tab content first
    if (currentTabId) {
      const content = saveCurrentToTab();
      useTabsStore.getState().saveTabContent(currentTabId, content);
    }

    // Create a new tab with the project name
    const newTabId = createTab(projectName);
    
    // Set switching flag to prevent auto-save conflicts
    isSwitchingTabRef.current = true;
    
    // Update refs and current tab
    previousTabIdRef.current = newTabId;
    setCurrentTabId(newTabId);
    
    // Color mapping for group types (Azure + AWS)
    const groupColors: Record<string, string> = {
      resourceGroup: '#0078D4',
      virtualNetwork: '#3B82F6',
      subnet: '#6366F1',
      region: '#10B981',
      subscription: '#F59E0B',
      availabilityZone: '#8B5CF6',
      awsAccount: '#232F3E',
      awsRegion: '#FF9900',
      awsVpc: '#8C4FFF',
      awsSubnet: '#00A1C9',
    };

    // Default sizes for group types (nested groups need proper sizing)
    const groupSizes: Record<string, { width: number; height: number }> = {
      region: { width: 900, height: 700 },
      subscription: { width: 800, height: 600 },
      resourceGroup: { width: 700, height: 500 },
      virtualNetwork: { width: 600, height: 400 },
      subnet: { width: 500, height: 300 },
      availabilityZone: { width: 500, height: 300 },
      awsAccount: { width: 1200, height: 900 },
      awsRegion: { width: 1000, height: 720 },
      awsVpc: { width: 700, height: 450 },
      awsSubnet: { width: 450, height: 280 },
    };
    
    // Import node interface
    interface ImportNode {
      id: string;
      type: string;
      position: { x: number; y: number };
      data: {
        title?: string;
        label?: string;
        groupType?: string;
        resourceType?: string;
        region?: string;
        properties?: Record<string, unknown>;
        [key: string]: unknown;
      };
      parentId?: string;
      extent?: string;
      width?: number;
      height?: number;
    }
    
    const importedNodes = diagram.nodes as ImportNode[];
    
    // First pass: identify all groups and their nesting level
    const nodeMap = new Map<string, ImportNode>();
    importedNodes.forEach(node => nodeMap.set(node.id, node));
    
    // Calculate nesting level for each node
    const getNestingLevel = (nodeId: string, visited = new Set<string>()): number => {
      if (visited.has(nodeId)) return 0; // Prevent circular refs
      visited.add(nodeId);
      const node = nodeMap.get(nodeId);
      if (!node?.parentId) return 0;
      return 1 + getNestingLevel(node.parentId, visited);
    };
    
    // Sort nodes by nesting level (parents first)
    const sortedNodes = [...importedNodes].sort((a, b) => {
      return getNestingLevel(a.id) - getNestingLevel(b.id);
    });
    
    const SERVICE_SIZE = { width: 220, height: 120 };
    const GROUP_PADDING = 40;
    const GROUP_HEADER_PADDING = 80;

    // Transform nodes with proper data structure
    const normalizedNodes = sortedNodes.map(node => {
      const isGroup = node.type === 'azure.group' || node.type === 'group' || node.type === 'aws.group';
      const isService = node.type === 'azure.service' || node.type === 'service' || node.type === 'aws.service';
      const isAwsType = node.type === 'aws.group' || node.type === 'aws.service' || (node.data as Record<string, unknown>).csp === 'aws';
      const groupType = node.data.groupType as string || 'resourceGroup';

      // For AWS nodes: trust the AI-generated positions (the schema specifies proper spacing).
      // For Azure nodes: apply the existing override to keep backwards-compat.
      let adjustedPosition = { ...node.position };
      const nestingLevel = getNestingLevel(node.id);
      if (!isAwsType) {
        if (isGroup) {
          adjustedPosition = {
            x: 40 + (nestingLevel * 50),
            y: 60 + (nestingLevel * 50),
          };
        } else if (isService) {
          adjustedPosition = {
            x: Math.max(40, node.position.x),
            y: Math.max(80, node.position.y),
          };
        }
      }

      if (isGroup) {
        const size = groupSizes[groupType] || { width: 500, height: 350 };
        return {
          id: node.id,
          type: 'group' as const,
          position: adjustedPosition,
          parentId: node.parentId,
          extent: node.parentId ? 'parent' as const : undefined,
          width: size.width,
          height: size.height,
          data: {
            groupType: groupType,
            name: node.data.label || node.data.title || 'Unnamed Group',
            displayName: node.data.title || node.data.label || 'Group',
            location: node.data.region as string || undefined,
            color: groupColors[groupType] || '#0078D4',
            regionName: node.data.region as string || undefined,
            metadata: node.data.properties as Record<string, unknown> || undefined,
            csp: isAwsType ? 'aws' : undefined,
          },
        };
      } else if (isService) {
        return {
          id: node.id,
          type: 'service' as const,
          position: adjustedPosition,
          parentId: node.parentId,
          extent: node.parentId ? 'parent' as const : undefined,
          data: {
            serviceId: node.id,
            name: node.data.label || node.data.title || 'Unnamed Service',
            displayName: node.data.title || node.data.label || 'Service',
            resourceType: node.data.resourceType as string || 'Microsoft.Unknown/resources',
            iconPath: isAwsType
              ? getAwsIconForResourceType(node.data.resourceType as string)
              : getIconForResourceType(node.data.resourceType as string),
            status: 'draft' as const,
            properties: node.data.properties as Record<string, unknown> || {},
            location: node.data.region as string || undefined,
            resourceGroupName: (node.data.resourceGroup as string) || (node.data.properties as Record<string, unknown>)?.resourceGroupName as string || undefined,
            csp: isAwsType ? 'aws' : undefined,
          },
        };
      }
      
      // Fallback for other node types
      return {
        ...node,
        type: (node.type === 'azure.group' || node.type === 'aws.group') ? 'group'
            : (node.type === 'azure.service' || node.type === 'aws.service') ? 'service'
            : node.type,
      };
    });
    
    // Build lookup maps for layout adjustments
    const nodeById = new Map(normalizedNodes.map((node) => [node.id, node]));
    const resourceGroupByName = new Map<string, string>();
    normalizedNodes.forEach((node) => {
      if (node.type === 'group' && (node.data as { groupType?: string }).groupType === 'resourceGroup') {
        const groupData = node.data as { name?: string; displayName?: string };
        if (groupData.name) resourceGroupByName.set(groupData.name, node.id);
        if (groupData.displayName) resourceGroupByName.set(groupData.displayName, node.id);
      }
    });

    // Ensure services are parented to their Resource Group when possible
    normalizedNodes.forEach((node) => {
      if (node.type === 'service' && !node.parentId) {
        const serviceData = node.data as { resourceGroupName?: string };
        const rgName = serviceData.resourceGroupName;
        if (rgName && resourceGroupByName.has(rgName)) {
          node.parentId = resourceGroupByName.get(rgName);
          node.extent = 'parent';
        }
      }
    });

    // Helper to get node size (used for layout bounds)
    const getNodeSize = (node: typeof normalizedNodes[number]) => {
      if (node.type === 'group') {
        return {
          width: node.width ?? groupSizes[(node.data as { groupType?: string }).groupType || 'resourceGroup']?.width ?? 500,
          height: node.height ?? groupSizes[(node.data as { groupType?: string }).groupType || 'resourceGroup']?.height ?? 350,
        };
      }
      return SERVICE_SIZE;
    };

    // Compute nesting depth for groups (children first)
    const getDepth = (nodeId: string, visited = new Set<string>()): number => {
      if (visited.has(nodeId)) return 0;
      visited.add(nodeId);
      const node = nodeById.get(nodeId);
      if (!node?.parentId) return 0;
      return 1 + getDepth(node.parentId, visited);
    };

    const groupNodes = normalizedNodes.filter((node) => node.type === 'group');
    const groupsByDepth = [...groupNodes].sort((a, b) => getDepth(b.id) - getDepth(a.id));

    // Resize groups to fit children and clamp child positions within parent
    groupsByDepth.forEach((group) => {
      const children = normalizedNodes.filter((node) => node.parentId === group.id);
      if (children.length === 0) return;

      let minX = Number.POSITIVE_INFINITY;
      let minY = Number.POSITIVE_INFINITY;
      let maxX = 0;
      let maxY = 0;

      children.forEach((child) => {
        const size = getNodeSize(child);
        const clampedX = Math.max(GROUP_PADDING, child.position.x);
        const clampedY = Math.max(GROUP_HEADER_PADDING, child.position.y);
        child.position = { x: clampedX, y: clampedY };

        minX = Math.min(minX, clampedX);
        minY = Math.min(minY, clampedY);
        maxX = Math.max(maxX, clampedX + size.width);
        maxY = Math.max(maxY, clampedY + size.height);
      });

      const requiredWidth = Math.max(maxX + GROUP_PADDING, (group.width ?? 0));
      const requiredHeight = Math.max(maxY + GROUP_PADDING, (group.height ?? 0));
      group.width = requiredWidth;
      group.height = requiredHeight;
    });

    // Load the imported diagram with properly transformed nodes
    loadDiagram({
      nodes: normalizedNodes as Parameters<typeof loadDiagram>[0]['nodes'],
      edges: diagram.edges as Parameters<typeof loadDiagram>[0]['edges'],
    });
    
    // Save the imported content to the new tab
    setTimeout(() => {
      const importedContent = saveCurrentToTab();
      useTabsStore.getState().saveTabContent(newTabId, importedContent);
      isSwitchingTabRef.current = false;
    }, 100);
    
  }, [currentTabId, saveCurrentToTab, createTab, setCurrentTabId, loadDiagram]);

  const handleGenerateFromPrompt = useCallback(async (prompt: string, projectName: string, cloud: CSP) => {
    setPromptError(null);
    setIsPromptGenerating(true);

    try {
      const response = await agentsService.generateDiagramFromPrompt(prompt, cloud);
      const diagram = response.diagram;

      if (!diagram.nodes || !Array.isArray(diagram.nodes) || !diagram.edges || !Array.isArray(diagram.edges)) {
        throw new Error('Invalid diagram JSON returned by agent.');
      }

      useCspStore.getState().setActiveCsp(cloud);
      handleImportDiagram(diagram, projectName || 'AI Project');
      setIsPromptModalOpen(false);
      setPromptCloud(null);
    } catch (error) {
      setPromptError(error instanceof Error ? error.message : 'Failed to generate diagram');
    } finally {
      setIsPromptGenerating(false);
    }
  }, [handleImportDiagram]);
  
  // Get diagram context for chat - both string and object versions
  const { diagramContext, architecture } = useMemo(() => {
    try {
      const exportData = getDiagramForExport();
      // Create a detailed architecture object for IaC generation
      const arch = {
        nodes: exportData.nodes.map(n => ({
          id: n.id,
          type: n.type,
          label: n.data?.label,
          resourceType: n.data?.resourceType,
          parentId: n.parentId,
          // Include full data for IaC generation
          data: n.data
        })),
        edges: exportData.edges.map(e => ({
          id: e.id,
          source: e.source,
          target: e.target,
          sourceHandle: e.sourceHandle,
          targetHandle: e.targetHandle,
          label: e.label,
          data: e.data
        })),
        // Include metadata
        metadata: {
          exportedAt: new Date().toISOString(),
          nodeCount: exportData.nodes.length,
          edgeCount: exportData.edges.length
        }
      };
      return {
        diagramContext: JSON.stringify(arch, null, 2),
        architecture: arch
      };
    } catch {
      return { diagramContext: undefined, architecture: undefined };
    }
    // nodes/edges are deliberate: getDiagramForExport is a stable store getter, so
    // they are what makes this memo recompute when the diagram changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [getDiagramForExport, nodes, edges]);

  useEffect(() => {
    refreshAzureAuth().catch(() => {
      setIsAuthenticated(false);
    });
  }, [refreshAzureAuth]);

  useEffect(() => {
    if (isAuthModalOpen) {
      refreshAzureAuth().catch(() => {
        setIsAuthenticated(false);
      });
    }
  }, [isAuthModalOpen, refreshAzureAuth]);

  // The diagram decides the cloud: once the canvas holds services, the active cloud
  // (palette, prompt target, IaC format) follows them. Covers imports, prompt results
  // and tab switches; an empty canvas leaves the toggle to the user.
  useEffect(() => {
    let aws = 0;
    let azure = 0;
    for (const n of nodes) {
      if (n.type !== 'service') continue;
      const data = n.data as { csp?: string; resourceType?: string };
      if (data.csp === 'aws' || data.resourceType?.startsWith('AWS::')) aws += 1;
      else if (data.resourceType?.startsWith('Microsoft.')) azure += 1;
    }
    if (aws === 0 && azure === 0) return;
    const cloud = aws > azure ? 'aws' : 'azure';
    if (useCspStore.getState().activeCsp !== cloud) useCspStore.getState().setActiveCsp(cloud);
  }, [nodes]);

  // Deep links, e.g. /workspace?example=web-app-sql&select=web or /workspace?prompt=1&cloud=aws.
  // Handled once per page load (the ref guards StrictMode's double invocation).
  const deepLinkHandled = useRef(false);
  useEffect(() => {
    if (deepLinkHandled.current) return;
    deepLinkHandled.current = true;
    const params = new URLSearchParams(window.location.search);
    const cloud = params.get('cloud');
    if (cloud === 'aws' || cloud === 'azure') {
      useCspStore.getState().setActiveCsp(cloud);
      setPromptCloud(cloud);
    }
    const exampleName = params.get('example');
    if (exampleName) {
      const example = getExample(exampleName);
      if (example) {
        handleImportDiagram(example.diagram, example.title);
        const select = params.get('select');
        if (select) {
          setTimeout(() => useDiagramStore.getState().selectNode(select), 250);
        }
      } else {
        console.warn(`Unknown example "${exampleName}"`);
      }
    }
    if (params.get('prompt') === '1') setIsPromptModalOpen(true);
  }, [handleImportDiagram]);

  return (
    <ReactFlowProvider>
      <div className="h-screen w-screen flex flex-col overflow-hidden bg-gradient-to-b from-brand-primary/5 via-white to-gray-100">
        <div className="h-1 bg-gradient-to-r from-brand-primary via-brand-accent to-brand-blue" />
        {/* Top Bar */}
        <TopBar
          onOpenIaCPreview={() => setIsIaCPreviewOpen(true)}
          onOpenDeployModal={() => setIsIaCPreviewOpen(true)}
          onOpenAuthModal={() => setIsAuthModalOpen(true)}
          isAuthenticated={isAuthenticated}
        />

        {/* Tab Bar for multiple projects */}
        <TabBar 
          onTabChange={handleTabChange} 
          onOpenImportModal={() => setIsImportModalOpen(true)}
          onOpenPromptModal={() => setIsPromptModalOpen(true)}
        />

        {/* Main Content */}
        <div className="flex-1 flex overflow-hidden">
          {/* Left Sidebar - Service Palette */}
          <ServicePalette />

          {/* Center - Diagram Canvas */}
          <DiagramCanvas />

          {/* Right Sidebar - Properties & Issues Panel */}
          <RightPanel />
        </div>

        {/* Modals */}
        <IaCPreviewModal
          isOpen={isIaCPreviewOpen}
          onClose={() => setIsIaCPreviewOpen(false)}
        />

        <AuthModal
          isOpen={isAuthModalOpen}
          onClose={() => setIsAuthModalOpen(false)}
          onRefresh={refreshAzureAuth}
          onSignOut={handleSignOut}
          isAuthenticated={isAuthenticated}
          authInfo={authInfo}
        />

        <ImportDiagramModal
          isOpen={isImportModalOpen}
          onClose={() => setIsImportModalOpen(false)}
          onImport={handleImportDiagram}
        />

        {isPromptModalOpen && (
        <PromptDiagramModal
          isOpen
          isLoading={isPromptGenerating}
          error={promptError}
          defaultCloud={promptCloud ?? activeCsp}
          onClose={() => {
            setPromptError(null);
            setIsPromptModalOpen(false);
            setPromptCloud(null);
          }}
          onGenerate={handleGenerateFromPrompt}
        />
        )}

        {/* Chat Panel */}
        <ChatContainer diagramContext={diagramContext} architecture={architecture} />
      </div>
    </ReactFlowProvider>
  );
}

export default AppShell;
