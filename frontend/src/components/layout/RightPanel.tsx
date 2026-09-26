// Right Panel - Combined Properties and Issues Panel with Tabs

import { useState, useMemo } from 'react';
import { Icon } from '@iconify/react';
import { cn } from '@/lib/utils';
import { useDiagramStore } from '@/store';
import { validateDiagram } from '@/lib/validationEngine';
import { IssuesPanel } from './IssuesPanel';
import { DynamicBicepPropertiesSection } from '@/components/properties/DynamicBicepPropertiesSection';
import { DynamicCfPropertiesSection } from '@/components/properties/DynamicCfPropertiesSection';
import { useAzureAccount } from '@/hooks';

type TabType = 'properties' | 'issues';

export function RightPanel() {
  // /workspace?panel=issues opens the Issues tab directly (used by README deep links).
  const [activeTab, setActiveTab] = useState<TabType>(() =>
    new URLSearchParams(window.location.search).get('panel') === 'issues' ? 'issues' : 'properties'
  );
  const nodes = useDiagramStore((state) => state.nodes);
  
  // Get validation results for badge count
  const validation = useMemo(() => validateDiagram(nodes), [nodes]);
  const totalIssues = validation.issues.length;
  const hasErrors = validation.errors > 0;

  const tabs = [
    {
      id: 'properties' as TabType,
      label: 'Properties',
      icon: 'mdi:tune',
    },
    {
      id: 'issues' as TabType,
      label: 'Issues',
      icon: hasErrors ? 'mdi:alert-circle' : 'mdi:check-circle',
      badge: totalIssues > 0 ? totalIssues : undefined,
      badgeColor: hasErrors ? 'bg-red-500' : validation.warnings > 0 ? 'bg-amber-500' : 'bg-green-500',
    },
  ];

  return (
    <aside className="w-80 bg-white border-l border-gray-200 flex flex-col h-full">
      {/* Tabs Header */}
      <div className="flex border-b border-gray-200">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={cn(
              'flex-1 flex items-center justify-center gap-1.5 px-3 py-2.5 text-sm font-medium transition-colors relative',
              activeTab === tab.id
                ? 'text-brand-primary border-b-2 border-brand-primary bg-brand-primary/5'
                : 'text-gray-600 hover:text-gray-900 hover:bg-gray-50'
            )}
          >
            <Icon 
              icon={tab.icon} 
              className={cn(
                'w-4 h-4',
                tab.id === 'issues' && hasErrors && activeTab !== tab.id && 'text-red-500'
              )} 
            />
            {tab.label}
            {tab.badge !== undefined && (
              <span className={cn(
                'ml-1 min-w-[18px] h-[18px] flex items-center justify-center text-xs font-bold text-white rounded-full px-1',
                tab.badgeColor
              )}>
                {tab.badge > 99 ? '99+' : tab.badge}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      <div className="flex-1 overflow-hidden">
        {activeTab === 'properties' && <PropertiesContent />}
        {activeTab === 'issues' && <IssuesPanel />}
      </div>
    </aside>
  );
}

// Properties content
function PropertiesContent() {
  const selectedNodeId = useDiagramStore((state) => state.selectedNodeId);
  const nodes = useDiagramStore((state) => state.nodes);
  const updateNodeData = useDiagramStore((state) => state.updateNodeData);
  const removeNode = useDiagramStore((state) => state.removeNode);
  const azureAccount = useAzureAccount();

  const azureLocations = [
    { value: 'eastus', label: 'East US' },
    { value: 'eastus2', label: 'East US 2' },
    { value: 'westus', label: 'West US' },
    { value: 'westus2', label: 'West US 2' },
    { value: 'centralus', label: 'Central US' },
    { value: 'northeurope', label: 'North Europe' },
    { value: 'westeurope', label: 'West Europe' },
    { value: 'uksouth', label: 'UK South' },
    { value: 'ukwest', label: 'UK West' },
    { value: 'southeastasia', label: 'Southeast Asia' },
    { value: 'eastasia', label: 'East Asia' },
    { value: 'japaneast', label: 'Japan East' },
    { value: 'australiaeast', label: 'Australia East' },
  ];

  const awsRegions = [
    { value: 'us-east-1', label: 'US East (N. Virginia)' },
    { value: 'us-east-2', label: 'US East (Ohio)' },
    { value: 'us-west-1', label: 'US West (N. California)' },
    { value: 'us-west-2', label: 'US West (Oregon)' },
    { value: 'eu-west-1', label: 'EU (Ireland)' },
    { value: 'eu-west-2', label: 'EU (London)' },
    { value: 'eu-central-1', label: 'EU (Frankfurt)' },
    { value: 'ap-southeast-1', label: 'Asia Pacific (Singapore)' },
    { value: 'ap-southeast-2', label: 'Asia Pacific (Sydney)' },
    { value: 'ap-northeast-1', label: 'Asia Pacific (Tokyo)' },
    { value: 'ca-central-1', label: 'Canada (Central)' },
    { value: 'sa-east-1', label: 'South America (Sao Paulo)' },
  ];

  const selectedNode = useMemo(
    () => nodes.find((n) => n.id === selectedNodeId),
    [nodes, selectedNodeId]
  );

  if (!selectedNode) {
    return (
      <div className="h-full flex items-center justify-center p-6">
        <div className="text-center">
          <Icon
            icon="mdi:cursor-default-click-outline"
            className="w-12 h-12 text-gray-300 mx-auto mb-3"
          />
          <p className="text-sm text-gray-500">
            Select a node to view and edit its properties
          </p>
        </div>
      </div>
    );
  }

  const isService = selectedNode.type === 'service';
  const data = selectedNode.data as Record<string, unknown>;
  const isAwsNode = (data.csp as string) === 'aws';
  const isAwsGroup = !isService && (
    data.groupType === 'awsAccount' ||
    data.groupType === 'awsRegion' ||
    data.groupType === 'awsVpc' ||
    data.groupType === 'awsSubnet'
  );

  const handleUpdate = (key: string, value: unknown) => {
    updateNodeData(selectedNode.id, { [key]: value });
  };

  // --- Azure mapping helpers (group nodes) ------------------------------------
  const groupType = !isService ? (data.groupType as string | undefined) : undefined;

  // For a resource-group node, find the subscription id set on its nearest
  // subscription ancestor so we can list that subscription's resource groups.
  const resolveAncestorSubscriptionId = (): string | undefined => {
    if (isService) return undefined;
    if (data.subscriptionId) return data.subscriptionId as string;
    const byId = new Map(nodes.map((n) => [n.id, n]));
    let current: (typeof nodes)[number] | undefined = selectedNode;
    let guard = 0;
    while (current?.parentId && guard++ < 20) {
      const parent = byId.get(current.parentId);
      if (!parent) break;
      const pd = parent.data as Record<string, unknown>;
      if (pd?.groupType === 'subscription' && pd.subscriptionId) return pd.subscriptionId as string;
      current = parent;
    }
    return undefined;
  };

  const ancestorSubscriptionId = resolveAncestorSubscriptionId();
  const availableResourceGroups =
    groupType === 'resourceGroup' && azureAccount.authenticated
      ? azureAccount.getResourceGroups(ancestorSubscriptionId)
      : [];

  const handlePropertyUpdate = (key: string, value: unknown) => {
    if (isService) {
      const properties = (data.properties || {}) as Record<string, unknown>;
      updateNodeData(selectedNode.id, {
        properties: { ...properties, [key]: value },
      });
    } else {
      const metadata = (data.metadata || {}) as Record<string, unknown>;
      updateNodeData(selectedNode.id, {
        metadata: { ...metadata, [key]: value },
      });
    }
  };

  const handleTagUpdate = (key: string, value: string) => {
    if (isService) {
      const tags = (data.tags || {}) as Record<string, string>;
      updateNodeData(selectedNode.id, {
        tags: { ...tags, [key]: value },
      });
    }
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="p-4 border-b border-gray-200">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-gray-900">
            {isService ? (data.label as string) || 'Service' : (data.displayName as string) || 'Group'}
          </h2>
          <button
            onClick={() => removeNode(selectedNode.id)}
            className="p-1 text-gray-400 hover:text-red-500 rounded transition-colors"
            title="Delete node"
          >
            <Icon icon="mdi:delete-outline" className="w-4 h-4" />
          </button>
        </div>
        <div className="flex items-center gap-2 mt-2">
          <span
            className={cn(
              'text-xs font-medium px-2 py-0.5 rounded',
              isService
                ? 'bg-azure-blue/20 text-azure-blue'
                : 'bg-brand-accent/20 text-brand-accent'
            )}
          >
            {isService ? 'Service' : 'Group'}
          </span>
          <span className="text-xs text-gray-500 truncate">
            {isService
              ? ((data.resourceType as string) || '').split('/').pop()
              : (data.groupType as string)}
          </span>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* Basic Info */}
        <section>
          <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
            Basic Information
          </h3>
          <div className="space-y-3">
            {/* Display Name */}
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">
                Display Name
              </label>
              <input
                type="text"
                value={(data.displayName as string) || ''}
                onChange={(e) => handleUpdate('displayName', e.target.value)}
                className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-azure-blue focus:border-transparent"
              />
            </div>

            {/* Resource Name */}
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">
                Resource Name
              </label>
              <input
                type="text"
                value={(data.name as string) || ''}
                onChange={(e) => handleUpdate('name', e.target.value)}
                placeholder="my-resource"
                className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-azure-blue focus:border-transparent"
              />
            </div>

            {/* Location */}
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">
                {isAwsNode ? 'AWS Region' : 'Location'}
              </label>
              <select
                value={(data.location as string) || ''}
                onChange={(e) => handleUpdate('location', e.target.value)}
                className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-azure-blue focus:border-transparent"
              >
                <option value="">Select {isAwsNode ? 'region' : 'location'}...</option>
                {(isAwsNode ? awsRegions : azureLocations).map((loc) => (
                  <option key={loc.value} value={loc.value}>
                    {loc.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </section>

        {/* Service-specific properties - Dynamic from Bicep Schema (Azure only) */}
        {isService && !isAwsNode && (
          <DynamicBicepPropertiesSection
            resourceType={(data.resourceType as string) || ''}
            properties={(data.properties || {}) as Record<string, unknown>}
            onPropertyUpdate={handlePropertyUpdate}
          />
        )}

        {/* Service-specific properties - Dynamic from CloudFormation schema (AWS only) */}
        {isService && isAwsNode && (
          <DynamicCfPropertiesSection
            resourceType={(data.resourceType as string) || ''}
            properties={(data.properties || {}) as Record<string, unknown>}
            onPropertyUpdate={handlePropertyUpdate}
          />
        )}

        {/* Azure mapping (subscription / resource group nodes, Azure only) */}
        {!isService && !isAwsGroup && (groupType === 'subscription' || groupType === 'resourceGroup') && (
          <section>
            <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
              Azure Mapping
            </h3>
            <div className="space-y-3">
              {groupType === 'subscription' && (
                azureAccount.authenticated && azureAccount.subscriptions.length > 0 ? (
                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">
                      Subscription (from az login)
                    </label>
                    <select
                      value={(data.subscriptionId as string) || ''}
                      onChange={(e) => {
                        const sub = azureAccount.subscriptions.find(
                          (s) => s.subscription_id === e.target.value
                        );
                        if (sub) {
                          updateNodeData(selectedNode.id, {
                            subscriptionId: sub.subscription_id,
                            displayName: sub.name,
                            name: sub.name,
                          });
                        }
                      }}
                      className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-azure-blue focus:border-transparent"
                    >
                      <option value="">Select subscription...</option>
                      {azureAccount.subscriptions.map((sub) => (
                        <option key={sub.subscription_id} value={sub.subscription_id}>
                          {sub.name}{sub.is_default ? ' (default)' : ''}
                        </option>
                      ))}
                    </select>
                    {(data.subscriptionId as string) && (
                      <p className="mt-1 text-[11px] text-gray-400 font-mono truncate">
                        {data.subscriptionId as string}
                      </p>
                    )}
                  </div>
                ) : (
                  <p className="text-[11px] text-gray-400 flex items-start gap-1">
                    <Icon icon="mdi:information-outline" className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                    Sign in with <code className="bg-gray-100 px-1 rounded">az login</code> to pick a real subscription. Using the name below for now.
                  </p>
                )
              )}

              {groupType === 'resourceGroup' && (
                availableResourceGroups.length > 0 ? (
                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">
                      Resource Group (existing)
                    </label>
                    <select
                      value={
                        availableResourceGroups.some((rg) => rg.name === (data.name as string))
                          ? (data.name as string)
                          : ''
                      }
                      onChange={(e) => {
                        const rg = availableResourceGroups.find((r) => r.name === e.target.value);
                        if (rg) {
                          updateNodeData(selectedNode.id, {
                            name: rg.name,
                            displayName: rg.name,
                            resourceGroupName: rg.name,
                            location: rg.location,
                            regionName: rg.location,
                            ...(ancestorSubscriptionId ? { subscriptionId: ancestorSubscriptionId } : {}),
                          });
                        }
                      }}
                      className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-azure-blue focus:border-transparent"
                    >
                      <option value="">Select resource group...</option>
                      {availableResourceGroups.map((rg) => (
                        <option key={rg.name} value={rg.name}>
                          {rg.name} ({rg.location})
                        </option>
                      ))}
                    </select>
                    <p className="mt-1 text-[11px] text-gray-400">
                      Or type a name in Resource Name above to create a new one.
                    </p>
                  </div>
                ) : (
                  <p className="text-[11px] text-gray-400 flex items-start gap-1">
                    <Icon icon="mdi:information-outline" className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                    {azureAccount.authenticated
                      ? 'No existing resource groups found for this subscription. The name above will be created on deploy.'
                      : <>Sign in with <code className="bg-gray-100 px-1 rounded">az login</code> to pick an existing resource group.</>}
                  </p>
                )
              )}
            </div>
          </section>
        )}

        {/* Group-specific properties */}
        {!isService && (groupType === 'virtualNetwork' || groupType === 'subnet') && (
          <section>
            <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
              Network Configuration
            </h3>
            <div className="space-y-3">
              {(data.groupType as string) === 'virtualNetwork' && (
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">
                    Address Space
                  </label>
                  <input
                    type="text"
                    value={(data.addressSpace as string) || ''}
                    onChange={(e) => handleUpdate('addressSpace', e.target.value)}
                    placeholder="10.0.0.0/16"
                    className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-azure-blue focus:border-transparent"
                  />
                </div>
              )}
              {(data.groupType as string) === 'subnet' && (
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">
                    Address Prefix
                  </label>
                  <input
                    type="text"
                    value={(data.addressPrefix as string) || ''}
                    onChange={(e) => handleUpdate('addressPrefix', e.target.value)}
                    placeholder="10.0.1.0/24"
                    className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-azure-blue focus:border-transparent"
                  />
                </div>
              )}
            </div>
          </section>
        )}

        {/* VNet Integration (Azure services only) - references an existing network */}
        {isService && !isAwsNode && (
          <section>
            <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
              VNet Integration
            </h3>
            <div className="space-y-3">
              <label className="flex items-start gap-2">
                <input
                  type="checkbox"
                  checked={Boolean(data.vnetIntegrationEnabled)}
                  onChange={(e) => handleUpdate('vnetIntegrationEnabled', e.target.checked)}
                  className="mt-0.5 rounded border-gray-300 text-azure-blue focus:ring-azure-blue"
                />
                <span className="text-xs text-gray-600">
                  Integrate with an existing virtual network
                </span>
              </label>

              {Boolean(data.vnetIntegrationEnabled) && (
                <>
                  <div className="flex items-start gap-1.5 p-2 bg-blue-50 border border-blue-200 rounded-md">
                    <Icon icon="mdi:shield-lock-outline" className="w-4 h-4 text-blue-600 mt-0.5 shrink-0" />
                    <p className="text-[11px] text-blue-700 leading-snug">
                      Integrates this service with an existing virtual network (for example a hub-spoke landing zone).
                      These fields reference existing resources: the generated IaC will not create them.
                    </p>
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">
                      Subnet Resource ID
                    </label>
                    <textarea
                      value={(data.subnetResourceId as string) || ''}
                      onChange={(e) => handleUpdate('subnetResourceId', e.target.value)}
                      placeholder="/subscriptions/.../resourceGroups/<network-rg>/providers/Microsoft.Network/virtualNetworks/<vnet>/subnets/<subnet>"
                      rows={3}
                      className="w-full px-3 py-2 text-xs font-mono border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-azure-blue focus:border-transparent resize-y"
                    />
                    <p className="mt-1 text-[11px] text-gray-400">
                      Paste the full resource ID of the existing subnet.
                    </p>
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">
                      Virtual Network Name
                    </label>
                    <input
                      type="text"
                      value={(data.virtualNetworkName as string) || ''}
                      onChange={(e) => handleUpdate('virtualNetworkName', e.target.value)}
                      placeholder="vnet-shared-eun"
                      className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-azure-blue focus:border-transparent"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">
                      Subnet Name
                    </label>
                    <input
                      type="text"
                      value={(data.subnetName as string) || ''}
                      onChange={(e) => handleUpdate('subnetName', e.target.value)}
                      placeholder="snet-app"
                      className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-azure-blue focus:border-transparent"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">
                      Network Resource Group <span className="text-gray-400">(optional)</span>
                    </label>
                    <input
                      type="text"
                      value={(data.networkResourceGroup as string) || ''}
                      onChange={(e) => handleUpdate('networkResourceGroup', e.target.value)}
                      placeholder="rg-network-eastus"
                      className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-azure-blue focus:border-transparent"
                    />
                  </div>
                </>
              )}

              {/* No VNet available: approved public-access exception */}
              {!data.vnetIntegrationEnabled && (
                <div className="pt-3 border-t border-gray-100 space-y-3">
                  <label className="flex items-start gap-2">
                    <input
                      type="checkbox"
                      checked={Boolean(data.networkExceptionEnabled)}
                      onChange={(e) => handleUpdate('networkExceptionEnabled', e.target.checked)}
                      className="mt-0.5 rounded border-gray-300 text-amber-600 focus:ring-amber-500"
                    />
                    <span className="text-xs text-gray-600">
                      Allow public network access (approved exception)
                    </span>
                  </label>

                  {Boolean(data.networkExceptionEnabled) && (
                    <>
                      <div className="flex items-start gap-1.5 p-2 bg-amber-50 border border-amber-200 rounded-md">
                        <Icon icon="mdi:alert-outline" className="w-4 h-4 text-amber-600 mt-0.5 shrink-0" />
                        <p className="text-[11px] text-amber-700 leading-snug">
                          No virtual network selected. This service will keep public network access enabled,
                          deviating from the secure-by-default guardrail baseline. It is logged as an accepted
                          exception in the compliance report.
                        </p>
                      </div>

                      <div>
                        <label className="block text-xs font-medium text-gray-700 mb-1">
                          Justification
                        </label>
                        <textarea
                          value={(data.networkExceptionJustification as string) || ''}
                          onChange={(e) => handleUpdate('networkExceptionJustification', e.target.value)}
                          placeholder="Why public access is required (e.g. no VNet available in this subscription; public endpoint approved by your security team)."
                          rows={3}
                          className="w-full px-3 py-2 text-xs border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-transparent resize-y"
                        />
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>
          </section>
        )}

        {/* Tags (Services only) */}
        {isService && (
          <section>
            <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
              Tags
            </h3>
            <div className="space-y-2">
              {Object.entries((data.tags || {}) as Record<string, string>).map(
                ([key, value]) => (
                  <div key={key} className="flex gap-2">
                    <input
                      type="text"
                      value={key}
                      disabled
                      className="flex-1 px-2 py-1.5 text-xs border border-gray-300 rounded bg-gray-50"
                    />
                    <input
                      type="text"
                      value={value}
                      onChange={(e) => handleTagUpdate(key, e.target.value)}
                      className="flex-1 px-2 py-1.5 text-xs border border-gray-300 rounded bg-white text-gray-900 focus:outline-none focus:ring-1 focus:ring-brand-primary"
                    />
                  </div>
                )
              )}
              <button
                onClick={() => {
                  const tags = (data.tags || {}) as Record<string, string>;
                  const key = `tag${Object.keys(tags).length + 1}`;
                  handleTagUpdate(key, '');
                }}
                className="w-full py-1.5 text-xs text-brand-primary hover:bg-brand-primary/10 rounded border border-dashed border-brand-primary/30"
              >
                + Add Tag
              </button>
            </div>
          </section>
        )}
      </div>

      {/* Footer */}
      <div className="p-4 border-t border-gray-200 bg-gray-50">
        <div className="text-xs text-gray-500">
          <span className="font-medium">Node ID:</span>{' '}
          <code className="bg-gray-200 px-1 rounded text-gray-700">{selectedNode.id}</code>
        </div>
      </div>
    </div>
  );
}

export default RightPanel;
