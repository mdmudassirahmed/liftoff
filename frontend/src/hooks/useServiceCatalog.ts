/**
 * useServiceCatalog - dynamic Azure service catalog (R1)
 *
 * Returns the curated static services instantly so the palette paints with
 * zero latency and works fully offline (demo-safe baseline). In the background
 * it fetches the live Azure resource-type index (Azure/bicep-types-az) and
 * merges every live resource type that is not already curated, so brand-new
 * Azure services become discoverable through search and "Browse all" with no
 * code edit.
 *
 * Prime directive: this is purely additive. On any failure (offline, upstream
 * change, parse error) it silently stays on the curated baseline and the
 * default browse view is byte-for-byte identical to before.
 */

import { useEffect, useMemo, useState } from 'react';
import { fetchResourceTypesIndex } from '@/services/azureSchemaService';
import type { AzureService, AzureServiceCategory } from '@/types';
import azureServicesData from '@/data/azureServices.json';

const CURATED_SERVICES = azureServicesData.services as AzureService[];
const CURATED_CATEGORIES = azureServicesData.categories as AzureServiceCategory[];

// Provider -> palette category. Values are constrained to the AzureServiceCategory
// union so live services group cleanly next to curated ones. Unknown providers
// fall back to 'Other'.
const PROVIDER_CATEGORY: Record<string, AzureServiceCategory> = {
  'Microsoft.Compute': 'Compute',
  'Microsoft.Web': 'Web',
  'Microsoft.ContainerService': 'Containers',
  'Microsoft.App': 'Containers',
  'Microsoft.ContainerRegistry': 'Containers',
  'Microsoft.ContainerInstance': 'Containers',
  'Microsoft.Kubernetes': 'Containers',
  'Microsoft.Sql': 'Databases',
  'Microsoft.DocumentDB': 'Databases',
  'Microsoft.DBforMySQL': 'Databases',
  'Microsoft.DBforPostgreSQL': 'Databases',
  'Microsoft.DBforMariaDB': 'Databases',
  'Microsoft.Cache': 'Databases',
  'Microsoft.Network': 'Networking',
  'Microsoft.Storage': 'Storage',
  'Microsoft.KeyVault': 'Security',
  'Microsoft.Security': 'Security',
  'Microsoft.ManagedIdentity': 'Identity',
  'Microsoft.AAD': 'Identity',
  'Microsoft.Authorization': 'Security',
  'Microsoft.Insights': 'Monitor',
  'Microsoft.OperationalInsights': 'Monitor',
  'Microsoft.AlertsManagement': 'Monitor',
  'Microsoft.Logic': 'Integration',
  'Microsoft.EventHub': 'Integration',
  'Microsoft.ServiceBus': 'Integration',
  'Microsoft.EventGrid': 'Integration',
  'Microsoft.ApiManagement': 'Integration',
  'Microsoft.CognitiveServices': 'AI',
  'Microsoft.MachineLearningServices': 'AI',
  'Microsoft.Search': 'AI',
  'Microsoft.DataFactory': 'Analytics',
  'Microsoft.Synapse': 'Analytics',
  'Microsoft.Databricks': 'Analytics',
  'Microsoft.StreamAnalytics': 'Analytics',
  'Microsoft.Kusto': 'Analytics',
  'Microsoft.Devices': 'IoT',
  'Microsoft.DigitalTwins': 'IoT',
  'Microsoft.IoTCentral': 'IoT',
  'Microsoft.SignalRService': 'Web',
  'Microsoft.Media': 'Media',
  'Microsoft.Migrate': 'Migration',
  'Microsoft.DevOps': 'DevOps',
  'Microsoft.Resources': 'Management',
  'Microsoft.Management': 'Management',
};

function providerCategory(resourceType: string): AzureServiceCategory {
  const provider = resourceType.split('/')[0];
  return PROVIDER_CATEGORY[provider] ?? 'Other';
}

// Best-effort human-readable name from a resource type's last segment.
// The live index keys are lower-cased, so this mostly title-cases a single word;
// it still splits any camelCase that survives.
function humanize(resourceType: string): string {
  const seg = resourceType.split('/').pop() ?? resourceType;
  return seg
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .replace(/^./, (c) => c.toUpperCase())
    .trim();
}

export interface ServiceCatalog {
  /** Curated static services - the default browse view (unchanged, offline-safe). */
  services: AzureService[];
  /** Curated category order for the default browse view. */
  categories: AzureServiceCategory[];
  /** Curated + live-only services, for search and the optional "Browse all" view. */
  allServices: AzureService[];
  /** True once the live index has been merged in. */
  isLive: boolean;
  /** True while the background index fetch is in flight. */
  loading: boolean;
  /** Count of live-only resource types discovered beyond the curated set. */
  liveCount: number;
}

export function useServiceCatalog(): ServiceCatalog {
  const [liveServices, setLiveServices] = useState<AzureService[]>([]);
  const [isLive, setIsLive] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    fetchResourceTypesIndex()
      .then((index) => {
        if (cancelled || !index || index.size === 0) return;

        const curatedTypes = new Set(
          CURATED_SERVICES.map((s) => s.resourceType.toLowerCase())
        );

        const live: AzureService[] = [];
        for (const [resourceType, versions] of index) {
          if (curatedTypes.has(resourceType.toLowerCase())) continue;
          const name = humanize(resourceType);
          const latest = Array.isArray(versions) && versions.length
            ? [...versions].sort().reverse()[0]
            : undefined;
          live.push({
            id: 'live-' + resourceType.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
            name,
            resourceType,
            category: providerCategory(resourceType),
            iconPath: '',
            defaultProperties: {},
            description: latest
              ? `Azure ${name} (${resourceType}, api ${latest})`
              : `Azure ${name} (${resourceType})`,
          });
        }

        if (!cancelled) {
          setLiveServices(live);
          setIsLive(true);
        }
      })
      .catch(() => {
        // Stay on the curated baseline; the palette behaves exactly as before.
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const allServices = useMemo(
    () =>
      liveServices.length
        ? [...CURATED_SERVICES, ...liveServices]
        : CURATED_SERVICES,
    [liveServices]
  );

  return {
    services: CURATED_SERVICES,
    categories: CURATED_CATEGORIES,
    allServices,
    isLive,
    loading,
    liveCount: liveServices.length,
  };
}

export default useServiceCatalog;
