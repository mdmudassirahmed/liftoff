// Service Palette Component - Left Sidebar

import { useState, useMemo } from 'react';
import { Icon } from '@iconify/react';
import { cn } from '@/lib/utils';
import { getAzureServiceIcon } from '@/lib/azureIcons';
import type { AzureService, AzureServiceCategory, GroupTemplate, DragData, VisualTemplate } from '@/types';
import { groupTemplates, visualTemplates } from '@/data/groupTemplates';
import type { GroupTemplateWithCSP } from '@/data/groupTemplates';
import { useServiceCatalog } from '@/hooks/useServiceCatalog';
import { useAwsServiceCatalog } from '@/hooks/useAwsServiceCatalog';
import { useCspStore } from '@/store/cspStore';
import type { CSP } from '@/types';

// Cap how many services render inside a single category so "Browse all" over the
// full live catalog (thousands of types) can never jank the demo. Curated
// categories are well under this, so the default view is unaffected.
const MAX_PER_CATEGORY = 100;

const categoryIcons: Record<string, string> = {
  Compute: 'mdi:server',
  Networking: 'mdi:lan',
  Storage: 'mdi:database',
  Databases: 'mdi:database-search',
  AI: 'mdi:robot-outline',
  Analytics: 'mdi:chart-line',
  Security: 'mdi:shield-check',
  Integration: 'mdi:connection',
  Containers: 'mdi:docker',
  Web: 'mdi:web',
  DevOps: 'mdi:infinity',
  Identity: 'mdi:badge-account',
  Management: 'mdi:cog',
  Monitor: 'mdi:chart-areaspline',
  IoT: 'mdi:chip',
  Mobile: 'mdi:cellphone',
  Hybrid: 'mdi:cloud-sync',
};

export function ServicePalette() {
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(
    new Set()
  );
  const [activeTab, setActiveTab] = useState<'services' | 'groups'>('services');
  const [browseAll, setBrowseAll] = useState(false);

  // CSP selection (persisted in cspStore)
  const { activeCsp, setActiveCsp } = useCspStore();

  // Azure catalog: curated baseline + live background merge
  const { services: azureServices, categories: azureCategories, allServices: allAzureServices, isLive, loading, liveCount } =
    useServiceCatalog();

  // AWS catalog: static curated list
  const { services: awsServices, categories: awsCategories } = useAwsServiceCatalog();

  // Active catalog based on CSP
  const services = activeCsp === 'aws' ? (awsServices as unknown as AzureService[]) : azureServices;
  const categories = activeCsp === 'aws' ? (awsCategories as unknown as AzureServiceCategory[]) : azureCategories;
  const allServices = activeCsp === 'aws' ? (awsServices as unknown as AzureService[]) : allAzureServices;

  const searching = searchQuery.trim().length > 0;

  // Default browse (no search, browse-all off) is exactly the curated set, so
  // the demo view is unchanged. Search and "Browse all" span the full live
  // catalog, proving new services appear with no code edit.
  const filteredServices = useMemo(() => {
    if (searching) {
      const query = searchQuery.toLowerCase();
      return allServices.filter(
        (s) =>
          s.name.toLowerCase().includes(query) ||
          s.category.toLowerCase().includes(query) ||
          s.resourceType.toLowerCase().includes(query)
      );
    }
    return browseAll ? allServices : services;
  }, [searching, browseAll, allServices, services, searchQuery]);

  // Group services by category
  const servicesByCategory = useMemo(() => {
    const grouped: Record<string, AzureService[]> = {};
    for (const service of filteredServices) {
      if (!grouped[service.category]) {
        grouped[service.category] = [];
      }
      grouped[service.category].push(service);
    }
    return grouped;
  }, [filteredServices]);

  // Render curated categories in their canonical order first, then append any
  // extra categories that only appear via live/search results.
  const renderCategories = useMemo(() => {
    const extra = Object.keys(servicesByCategory).filter(
      (c) => !categories.includes(c as AzureServiceCategory)
    );
    extra.sort();
    return [...categories, ...extra];
  }, [servicesByCategory, categories]);

  // While searching, auto-expand every category that has a match so results are
  // visible without a manual click; otherwise honor the user's expand state.
  const effectiveExpanded = useMemo(() => {
    if (searching) return new Set(Object.keys(servicesByCategory));
    return expandedCategories;
  }, [searching, servicesByCategory, expandedCategories]);

  const toggleCategory = (category: string) => {
    if (searching) return; // categories are auto-expanded during search
    setExpandedCategories((prev) => {
      const next = new Set(prev);
      if (next.has(category)) {
        next.delete(category);
      } else {
        next.add(category);
      }
      return next;
    });
  };

  const visibleCategories = renderCategories.filter(
    (c) => servicesByCategory[c]?.length
  );
  const allExpanded =
    visibleCategories.length > 0 &&
    visibleCategories.every((c) => effectiveExpanded.has(c));

  const toggleAll = () => {
    if (searching) return; // already auto-expanded
    if (allExpanded) {
      setExpandedCategories(new Set());
    } else {
      setExpandedCategories(new Set(visibleCategories));
    }
  };

  const handleDragStart = (
    event: React.DragEvent,
    type: 'service' | 'group' | 'visual',
    payload: AzureService | GroupTemplate | VisualTemplate
  ) => {
    const dragData: DragData = { type, payload };
    event.dataTransfer.setData('application/json', JSON.stringify(dragData));
    event.dataTransfer.effectAllowed = 'move';
  };

  return (
    <aside className="w-64 bg-white border-r border-gray-200 flex flex-col h-full">
      {/* Header */}
      <div className="p-4 border-b border-gray-200">
        <h2 className="text-sm font-semibold text-gray-900 mb-2">Components</h2>

        {/* CSP Toggle */}
        <div className="flex gap-1 p-0.5 bg-gray-100 rounded-md mb-3">
          {(['azure', 'aws'] as CSP[]).map((csp) => (
            <button
              key={csp}
              onClick={() => { setActiveCsp(csp); setSearchQuery(''); setBrowseAll(false); }}
              className={cn(
                'flex-1 flex items-center justify-center gap-1 py-1 text-[11px] font-semibold rounded transition-colors',
                activeCsp === csp
                  ? csp === 'aws'
                    ? 'bg-[#FF9900] text-white shadow-sm'
                    : 'bg-[#0078D4] text-white shadow-sm'
                  : 'text-gray-500 hover:text-gray-800'
              )}
            >
              <Icon icon={csp === 'aws' ? 'mdi:aws' : 'mdi:microsoft-azure'} className="w-3 h-3" />
              {csp.toUpperCase()}
            </button>
          ))}
        </div>

        {/* Tabs */}
        <div className="flex gap-1 p-1 bg-gray-100 rounded-lg mb-3">
          <button
            onClick={() => setActiveTab('services')}
            className={cn(
              'flex-1 py-1.5 text-xs font-medium rounded-md transition-colors',
              activeTab === 'services'
                ? 'bg-brand-primary text-white shadow-sm'
                : 'text-gray-600 hover:text-gray-900'
            )}
          >
            Services
          </button>
          <button
            onClick={() => setActiveTab('groups')}
            className={cn(
              'flex-1 py-1.5 text-xs font-medium rounded-md transition-colors',
              activeTab === 'groups'
                ? 'bg-brand-primary text-white shadow-sm'
                : 'text-gray-600 hover:text-gray-900'
            )}
          >
            Groups
          </button>
        </div>

        {/* Search with expand/collapse buttons */}
        <div className="flex items-center gap-1">
          <div className="relative flex-1">
            <Icon
              icon="mdi:magnify"
              className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400"
            />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search..."
              className="w-full pl-9 pr-3 py-2 text-sm border border-gray-300 rounded-lg bg-white text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-brand-primary focus:border-transparent"
            />
          </div>
          {/* Expand/Collapse toggle */}
          <button
            onClick={toggleAll}
            title={allExpanded ? "Collapse all" : "Expand all"}
            className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded transition-colors"
          >
            <Icon
              icon={allExpanded ? "mdi:unfold-less-horizontal" : "mdi:unfold-more-horizontal"}
              className="w-4 h-4"
            />
          </button>
        </div>

        {/* Live catalog status + Browse all (services tab only) */}
        {activeTab === 'services' && (
          <div className="flex items-center justify-between mt-2 min-h-[20px]">
            <span className="text-[10px] text-gray-500 flex items-center gap-1">
              {activeCsp === 'aws' ? (
                <span className="text-gray-400">{services.length} AWS services</span>
              ) : loading && !isLive ? (
                <>
                  <Icon icon="mdi:loading" className="w-3 h-3 animate-spin text-gray-400" />
                  Syncing latest Azure services...
                </>
              ) : isLive ? (
                <>
                  <span className="w-1.5 h-1.5 rounded-full bg-brand-primary inline-block" />
                  Live catalog: {services.length + liveCount} services
                </>
              ) : (
                <span className="text-gray-400">{services.length} services</span>
              )}
            </span>
            {activeCsp !== 'aws' && isLive && !searching && (
              <button
                onClick={() => setBrowseAll((v) => !v)}
                className={cn(
                  'text-[10px] font-medium px-1.5 py-0.5 rounded transition-colors',
                  browseAll
                    ? 'bg-brand-primary/10 text-brand-primary'
                    : 'text-gray-500 hover:text-gray-700 hover:bg-gray-100'
                )}
                title={browseAll ? 'Show curated services' : 'Browse the full live Azure catalog'}
              >
                {browseAll ? 'Curated' : 'Browse all'}
              </button>
            )}
          </div>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {activeTab === 'services' ? (
          <div className="p-2">
            {renderCategories.map((category) => {
              const categoryServices = servicesByCategory[category];
              if (!categoryServices?.length) return null;

              const isExpanded = effectiveExpanded.has(category);
              const shownServices = categoryServices.slice(0, MAX_PER_CATEGORY);
              const hiddenCount = categoryServices.length - shownServices.length;

              return (
                <div key={category} className="mb-1">
                  {/* Category Header */}
                  <button
                    onClick={() => toggleCategory(category)}
                    className="w-full flex items-center gap-2 px-2 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-100 rounded-md"
                  >
                    <Icon
                      icon={isExpanded ? 'mdi:chevron-down' : 'mdi:chevron-right'}
                      className="w-4 h-4 text-gray-400"
                    />
                    <Icon
                      icon={categoryIcons[category] || 'mdi:cube-outline'}
                      className={cn('w-4 h-4', activeCsp === 'aws' ? 'text-[#FF9900]' : 'text-azure-blue')}
                    />
                    <span>{category}</span>
                    <span className="ml-auto text-xs text-gray-400">
                      {categoryServices.length}
                    </span>
                  </button>

                  {/* Services List */}
                  {isExpanded && (
                    <div className="ml-4 mt-1 space-y-1">
                      {shownServices.map((service) => (
                        <div
                          key={service.id}
                          draggable
                          onDragStart={(e) => handleDragStart(e, 'service', service)}
                          title={service.resourceType}
                          className={cn(
                            'flex items-center gap-2 px-2 py-2 rounded-md',
                            'bg-gray-50 hover:bg-brand-primary/10 cursor-grab active:cursor-grabbing',
                            'border border-transparent hover:border-brand-primary/30',
                            'transition-colors'
                          )}
                        >
                          <div className="w-6 h-6 rounded bg-white border border-gray-200 flex items-center justify-center flex-shrink-0">
                            <Icon
                              icon={activeCsp === 'aws' ? (service.iconPath || 'mdi:cloud') : getAzureServiceIcon(service.iconPath)}
                              className={cn('w-4 h-4', activeCsp === 'aws' ? 'text-[#FF9900]' : 'text-azure-blue')}
                            />
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="text-xs font-medium text-gray-700 truncate">
                              {service.name}
                            </p>
                          </div>
                          <Icon
                            icon="mdi:drag"
                            className="w-4 h-4 text-gray-400"
                          />
                        </div>
                      ))}
                      {hiddenCount > 0 && (
                        <p className="px-2 py-1 text-[10px] text-gray-400 italic">
                          +{hiddenCount} more. Search to narrow.
                        </p>
                      )}
                    </div>
                  )}
                </div>
              );
            })}

            {/* Empty search state */}
            {searching && filteredServices.length === 0 && (
              <p className="px-3 py-6 text-xs text-gray-400 text-center">
                No services match "{searchQuery}".
              </p>
            )}
          </div>
        ) : (
          <div className="p-2 space-y-4">
            {/* Visual Elements Section */}
            <div>
              <p className="px-2 text-xs font-semibold text-gray-600 mb-2 flex items-center gap-1">
                <Icon icon="mdi:eye-outline" className="w-3 h-3" />
                Visual Elements
                <span className="ml-1 text-[10px] text-gray-400 font-normal">(diagram only)</span>
              </p>
              <div className="grid grid-cols-2 gap-2">
                {visualTemplates.map((template) => (
                  <div
                    key={template.id}
                    draggable
                    onDragStart={(e) => handleDragStart(e, 'visual', template)}
                    className={cn(
                      'flex flex-col items-center gap-1 p-3 rounded-lg',
                      'bg-gray-50 hover:bg-gray-100 cursor-grab active:cursor-grabbing',
                      'border border-dashed border-gray-300 hover:border-gray-400',
                      'transition-all'
                    )}
                  >
                    <div
                      className="w-10 h-10 rounded-full flex items-center justify-center"
                      style={{ backgroundColor: `${template.color}20` }}
                    >
                      <Icon
                        icon={template.iconPath}
                        className="w-6 h-6"
                        style={{ color: template.color }}
                      />
                    </div>
                    <p className="text-xs font-medium text-gray-700 text-center">
                      {template.name}
                    </p>
                  </div>
                ))}
              </div>
              <p className="px-2 mt-2 text-[10px] text-amber-600 bg-amber-50 rounded p-1.5 flex items-start gap-1">
                <Icon icon="mdi:information-outline" className="w-3 h-3 mt-0.5 flex-shrink-0" />
                <span>These are for visualization only and will NOT be included in generated IaC code.</span>
              </p>
            </div>

            {/* Divider */}
            <div className="border-t border-gray-200" />

            {/* Group Containers Section (CSP-filtered) */}
            <div>
              <p className="px-2 text-xs font-semibold text-gray-600 mb-2 flex items-center gap-1">
                <Icon icon="mdi:folder-multiple-outline" className="w-3 h-3" />
                {activeCsp === 'aws' ? 'AWS Containers' : 'Azure Containers'}
              </p>
              <div className="space-y-2">
                {(groupTemplates as GroupTemplateWithCSP[])
                  .filter((t) => !t.csp || t.csp === activeCsp)
                  .map((template) => (
                  <div
                    key={template.id}
                    draggable
                    onDragStart={(e) => handleDragStart(e, 'group', template)}
                    className={cn(
                      'flex items-center gap-3 px-3 py-3 rounded-lg',
                      'bg-gray-50 hover:bg-gray-100 cursor-grab active:cursor-grabbing',
                      'border-2 border-dashed hover:border-solid',
                      'transition-all'
                    )}
                    style={{ borderColor: template.color }}
                  >
                    <div
                      className="w-8 h-8 rounded-md flex items-center justify-center"
                      style={{ backgroundColor: `${template.color}20` }}
                    >
                      <Icon
                        icon="mdi:folder-outline"
                        className="w-5 h-5"
                        style={{ color: template.color }}
                      />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-700">
                        {template.name}
                      </p>
                      <p className="text-xs text-gray-500 truncate">
                        {template.description}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="p-3 border-t border-gray-200 bg-gray-50">
        <p className="text-xs text-gray-500 text-center">
          Drag items onto the canvas
        </p>
      </div>
    </aside>
  );
}

export default ServicePalette;
