/**
 * DynamicBicepProperties - Properties panel that fetches schema dynamically
 * from the Azure Bicep Types repository
 * 
 * FULLY DYNAMIC - No hardcoded property lists
 * All properties come from Azure Bicep Types repo
 * New properties added by Azure automatically appear
 */

import { useState } from 'react';
import { Icon } from '@iconify/react';
import { cn } from '@/lib/utils';
import { useBicepSchema, formatPropertyName } from '@/hooks/useBicepSchema';
import type { BicepProperty } from '@/services/bicepSchemaFetcher';

// ===== FALLBACK OPTIONS FOR COMMON PROPERTIES =====
// Only used when schema doesn't provide enum values (e.g., location)
const FALLBACK_OPTIONS: Record<string, { value: string; label: string }[]> = {
  // Azure Regions
  location: [
    { value: 'eastus', label: 'East US' },
    { value: 'eastus2', label: 'East US 2' },
    { value: 'westus', label: 'West US' },
    { value: 'westus2', label: 'West US 2' },
    { value: 'westus3', label: 'West US 3' },
    { value: 'centralus', label: 'Central US' },
    { value: 'northcentralus', label: 'North Central US' },
    { value: 'southcentralus', label: 'South Central US' },
    { value: 'westeurope', label: 'West Europe' },
    { value: 'northeurope', label: 'North Europe' },
    { value: 'uksouth', label: 'UK South' },
    { value: 'ukwest', label: 'UK West' },
    { value: 'australiaeast', label: 'Australia East' },
    { value: 'southeastasia', label: 'Southeast Asia' },
    { value: 'japaneast', label: 'Japan East' },
    { value: 'canadacentral', label: 'Canada Central' },
    { value: 'brazilsouth', label: 'Brazil South' },
    { value: 'indiacentral', label: 'Central India' },
  ],
  // SKU Names for common services
  'sku.name': [
    { value: 'F1', label: 'F1 (Free)' },
    { value: 'D1', label: 'D1 (Shared)' },
    { value: 'B1', label: 'B1 (Basic Small)' },
    { value: 'B2', label: 'B2 (Basic Medium)' },
    { value: 'B3', label: 'B3 (Basic Large)' },
    { value: 'S1', label: 'S1 (Standard Small)' },
    { value: 'S2', label: 'S2 (Standard Medium)' },
    { value: 'S3', label: 'S3 (Standard Large)' },
    { value: 'P1v2', label: 'P1v2 (Premium v2 Small)' },
    { value: 'P2v2', label: 'P2v2 (Premium v2 Medium)' },
    { value: 'P3v2', label: 'P3v2 (Premium v2 Large)' },
    { value: 'P1v3', label: 'P1v3 (Premium v3 Small)' },
    { value: 'P2v3', label: 'P2v3 (Premium v3 Medium)' },
    { value: 'P3v3', label: 'P3v3 (Premium v3 Large)' },
  ],
  // SKU Tiers
  'sku.tier': [
    { value: 'Free', label: 'Free' },
    { value: 'Shared', label: 'Shared' },
    { value: 'Basic', label: 'Basic' },
    { value: 'Standard', label: 'Standard' },
    { value: 'Premium', label: 'Premium' },
    { value: 'PremiumV2', label: 'Premium V2' },
    { value: 'PremiumV3', label: 'Premium V3' },
  ],
  // Boolean-like string options
  httpsOnly: [
    { value: 'true', label: 'Yes - HTTPS Only (Recommended)' },
    { value: 'false', label: 'No - Allow HTTP' },
  ],
  clientAffinityEnabled: [
    { value: 'true', label: 'Yes - Enable Client Affinity' },
    { value: 'false', label: 'No - Disable (Recommended for stateless)' },
  ],
  alwaysOn: [
    { value: 'true', label: 'Yes - Always On (Recommended for production)' },
    { value: 'false', label: 'No - Allow idle shutdown' },
  ],
  // TLS Versions
  minimalTlsVersion: [
    { value: '1.2', label: 'TLS 1.2 (Recommended)' },
    { value: '1.1', label: 'TLS 1.1 (Legacy)' },
    { value: '1.0', label: 'TLS 1.0 (Not Recommended)' },
  ],
  minTlsVersion: [
    { value: '1.2', label: 'TLS 1.2 (Recommended)' },
    { value: '1.1', label: 'TLS 1.1 (Legacy)' },
    { value: '1.0', label: 'TLS 1.0 (Not Recommended)' },
  ],
  // Public Network Access
  publicNetworkAccess: [
    { value: 'Enabled', label: 'Enabled (Public Access)' },
    { value: 'Disabled', label: 'Disabled (Private Only)' },
  ],
  // SQL Collation
  collation: [
    { value: 'SQL_Latin1_General_CP1_CI_AS', label: 'SQL_Latin1_General_CP1_CI_AS (Default)' },
    { value: 'Latin1_General_CI_AS', label: 'Latin1_General_CI_AS' },
    { value: 'Latin1_General_CS_AS', label: 'Latin1_General_CS_AS (Case Sensitive)' },
  ],
  // SQL Database Create Mode
  createMode: [
    { value: 'Default', label: 'Default (New Database)' },
    { value: 'Copy', label: 'Copy (From existing)' },
    { value: 'Secondary', label: 'Secondary (Geo-replication)' },
    { value: 'PointInTimeRestore', label: 'Point In Time Restore' },
    { value: 'Restore', label: 'Restore (From backup)' },
  ],
  // Backup Storage Redundancy
  requestedBackupStorageRedundancy: [
    { value: 'Local', label: 'Locally Redundant (LRS)' },
    { value: 'Zone', label: 'Zone Redundant (ZRS)' },
    { value: 'Geo', label: 'Geo Redundant (GRS)' },
    { value: 'GeoZone', label: 'Geo-Zone Redundant (GZRS)' },
  ],
  // License Type
  licenseType: [
    { value: 'LicenseIncluded', label: 'License Included' },
    { value: 'BasePrice', label: 'Azure Hybrid Benefit' },
  ],
  // Application Type (App Insights)
  Application_Type: [
    { value: 'web', label: 'Web Application' },
    { value: 'other', label: 'Other' },
  ],
  // Kind (Various services)
  kind: [
    { value: 'app', label: 'Web App' },
    { value: 'app,linux', label: 'Web App (Linux)' },
    { value: 'functionapp', label: 'Function App' },
    { value: 'functionapp,linux', label: 'Function App (Linux)' },
    { value: 'linux', label: 'Linux' },
    { value: 'elastic', label: 'Elastic Premium' },
    { value: 'StorageV2', label: 'Storage V2' },
    { value: 'BlobStorage', label: 'Blob Storage' },
    { value: 'BlockBlobStorage', label: 'Block Blob Storage' },
    { value: 'FileStorage', label: 'File Storage' },
  ],
  // Storage Access Tier
  accessTier: [
    { value: 'Hot', label: 'Hot (Frequently accessed)' },
    { value: 'Cool', label: 'Cool (Infrequently accessed)' },
    { value: 'Archive', label: 'Archive (Rarely accessed)' },
  ],
  // Identity Type
  'identity.type': [
    { value: 'SystemAssigned', label: 'System Assigned' },
    { value: 'UserAssigned', label: 'User Assigned' },
    { value: 'SystemAssigned,UserAssigned', label: 'Both' },
    { value: 'None', label: 'None' },
  ],
  // Container Registry SKU
  'sku': [
    { value: 'Basic', label: 'Basic' },
    { value: 'Standard', label: 'Standard' },
    { value: 'Premium', label: 'Premium' },
  ],
  // Retention in Days (Log Analytics)
  retentionInDays: [
    { value: '30', label: '30 Days' },
    { value: '60', label: '60 Days' },
    { value: '90', label: '90 Days' },
    { value: '120', label: '120 Days' },
    { value: '180', label: '180 Days' },
    { value: '365', label: '365 Days (1 Year)' },
    { value: '730', label: '730 Days (2 Years)' },
  ],
  // Zone Redundant
  zoneRedundant: [
    { value: 'true', label: 'Yes - Zone Redundant' },
    { value: 'false', label: 'No - Single Zone' },
  ],
  // Read Scale
  readScale: [
    { value: 'Enabled', label: 'Enabled' },
    { value: 'Disabled', label: 'Disabled' },
  ],
  // Version (SQL Server)
  version: [
    { value: '12.0', label: '12.0 (SQL Server 2014+)' },
  ],
  // Reserved (App Service Plan Linux)
  reserved: [
    { value: 'true', label: 'Yes - Linux' },
    { value: 'false', label: 'No - Windows' },
  ],
  // Admin User Enabled (Container Registry)
  adminUserEnabled: [
    { value: 'true', label: 'Yes - Enable Admin User' },
    { value: 'false', label: 'No - Disable Admin User' },
  ],
};

// ===== PROPERTY HINTS FOR USER GUIDANCE =====
const PROPERTY_HINTS: Record<string, string> = {
  name: 'Unique name (lowercase, alphanumeric, hyphens)',
  administratorLogin: 'SQL admin username (e.g., sqladmin)',
  administratorLoginPassword: 'Min 8 chars: uppercase, lowercase, number',
  parent: 'Auto-filled when connected to parent resource',
  serverFarmId: 'Auto-filled when connected to App Service Plan',
  maxSizeBytes: 'e.g., 268435456000 = 250GB',
  minCapacity: 'Min vCores for serverless (e.g., 0.5, 1, 2)',
  autoPauseDelay: 'Minutes before auto-pause (-1 = disabled)',
  tags: 'JSON object, e.g., {"env": "prod"}',
};

// Number of optional properties to show initially
const INITIAL_OPTIONAL_COUNT = 10;

// ===== COMPONENT PROPS =====
interface DynamicBicepPropertiesSectionProps {
  resourceType: string;
  properties: Record<string, unknown>;
  onPropertyUpdate: (key: string, value: unknown) => void;
}

export function DynamicBicepPropertiesSection({
  resourceType,
  properties,
  onPropertyUpdate,
}: DynamicBicepPropertiesSectionProps) {
  const {
    loading,
    error,
    allNestedProps,
    isRequired,
    schema,
  } = useBicepSchema(resourceType);

  // State for UI controls
  const [searchQuery, setSearchQuery] = useState('');
  const [showAllOptional, setShowAllOptional] = useState(false);
  const [showRequired, setShowRequired] = useState(false);

  // Check if a property is sensitive (password, secret, key)
  const isSensitive = (key: string): boolean => {
    const sensitivePatterns = ['password', 'secret', 'key', 'token', 'credential'];
    const lowerKey = key.toLowerCase();
    return sensitivePatterns.some(p => lowerKey.includes(p));
  };

  // Get current value for a property
  const getValue = (key: string): unknown => {
    // Check direct key first
    if (properties[key] !== undefined) return properties[key];
    // Check with 'properties.' prefix (for backwards compatibility)
    if (properties[`properties.${key}`] !== undefined) return properties[`properties.${key}`];
    return '';
  };

  // Best-effort resolution of a (possibly dotted) required path against the node's
  // property bag. Lenient by design: used only for read-only coverage display, so it
  // never marks a field "missing" that is actually set via a nested object.
  const resolvePathValue = (path: string): unknown => {
    if (properties[path] !== undefined) return properties[path];
    if (properties[`properties.${path}`] !== undefined) return properties[`properties.${path}`];
    const segments = path.split('.');
    const roots: unknown[] = [properties, properties['properties']];
    for (const root of roots) {
      if (!root || typeof root !== 'object') continue;
      let cur: unknown = root;
      let ok = true;
      for (const seg of segments) {
        if (cur && typeof cur === 'object' && seg in (cur as Record<string, unknown>)) {
          cur = (cur as Record<string, unknown>)[seg];
        } else {
          ok = false;
          break;
        }
      }
      if (ok && cur !== undefined) return cur;
    }
    return undefined;
  };

  // Check if value is filled
  const isFilled = (value: unknown): boolean => {
    if (value === undefined || value === null || value === '') return false;
    if (typeof value === 'object') return Object.keys(value).length > 0;
    return true;
  };

  // Get hint for property
  const getHint = (key: string): string | undefined => {
    return PROPERTY_HINTS[key];
  };

  // Determine if a property should be a dropdown
  const getDropdownOptions = (prop: BicepProperty): { value: string; label: string }[] | null => {
    // First check if schema provides enum values
    if (prop.enumValues && prop.enumValues.length > 0) {
      return prop.enumValues.map(v => ({
        value: v,
        label: formatEnumLabel(prop.name, v),
      }));
    }
    
    // Check fallback options by exact name
    if (FALLBACK_OPTIONS[prop.name]) {
      return FALLBACK_OPTIONS[prop.name];
    }

    // Check fallback options by nested path (e.g., "sku.name" -> "name" if parent is "sku")
    const nameParts = prop.name.split('.');
    const fullPath = nameParts.join('.');
    if (FALLBACK_OPTIONS[fullPath]) {
      return FALLBACK_OPTIONS[fullPath];
    }

    // Smart detection for boolean-type properties
    if (prop.type === 'boolean') {
      return [
        { value: 'true', label: 'Yes' },
        { value: 'false', label: 'No' },
      ];
    }

    // Smart detection for property names that are commonly boolean-like strings
    const booleanLikePatterns = [
      /enabled$/i,
      /disabled$/i,
      /only$/i,
      /redundant$/i,
      /encrypted$/i,
    ];
    if (booleanLikePatterns.some(pattern => pattern.test(prop.name))) {
      return [
        { value: 'true', label: 'Yes - Enabled' },
        { value: 'false', label: 'No - Disabled' },
      ];
    }

    // Smart detection for Enabled/Disabled type properties
    const enabledDisabledPatterns = [
      /access$/i,
      /scale$/i,
      /authentication$/i,
      /mode$/i,
    ];
    if (enabledDisabledPatterns.some(pattern => pattern.test(prop.name))) {
      // Only suggest if type is string (not complex object)
      if (prop.type === 'string') {
        return [
          { value: 'Enabled', label: 'Enabled' },
          { value: 'Disabled', label: 'Disabled' },
        ];
      }
    }
    
    return null;
  };

  // Format enum value as a label
  const formatEnumLabel = (propName: string, value: string): string => {
    // Add helpful descriptions for known values
    const knownLabels: Record<string, Record<string, string>> = {
      minimalTlsVersion: {
        '1.0': 'TLS 1.0',
        '1.1': 'TLS 1.1',
        '1.2': 'TLS 1.2 (Recommended)',
        '1.3': 'TLS 1.3',
        'None': 'None (Not Recommended)',
      },
      publicNetworkAccess: {
        'Enabled': 'Enabled (Public)',
        'Disabled': 'Disabled (Private)',
      },
      readScale: {
        'Enabled': 'Enabled',
        'Disabled': 'Disabled',
      },
      requestedBackupStorageRedundancy: {
        'Local': 'Locally Redundant (LRS)',
        'Zone': 'Zone Redundant (ZRS)',
        'Geo': 'Geo Redundant (GRS)',
        'GeoZone': 'Geo-Zone Redundant (GZRS)',
      },
      licenseType: {
        'LicenseIncluded': 'License Included',
        'BasePrice': 'Azure Hybrid Benefit',
      },
    };
    
    if (knownLabels[propName]?.[value]) {
      return knownLabels[propName][value];
    }
    
    // Default: capitalize and space out
    return value
      .replace(/([A-Z])/g, ' $1')
      .replace(/^./, str => str.toUpperCase())
      .trim();
  };

  // Check if property type suggests a boolean
  const isBoolean = (prop: BicepProperty): boolean => {
    if (prop.type === 'boolean') return true;
    if (prop.name.startsWith('is') || prop.name.startsWith('enable') || prop.name.endsWith('Enabled')) {
      return true;
    }
    return false;
  };

  // Check if property type suggests an object/JSON
  const isObject = (prop: BicepProperty): boolean => {
    return prop.type === 'object' || prop.type.includes('object');
  };

  // Render a single property field
  const renderField = (prop: BicepProperty) => {
    const value = getValue(prop.name);
    const sensitive = isSensitive(prop.name);
    const filled = isFilled(value);
    const required = isRequired(prop.name);
    const options = getDropdownOptions(prop);
    const hint = getHint(prop.name) || prop.description;
    const readonly = prop.readonly;

    // Skip readonly properties
    if (readonly) return null;

    return (
      <div key={prop.name} className="group">
        <label className="flex items-center gap-1.5 text-xs font-medium text-gray-700 mb-1">
          {formatPropertyName(prop.name)}
          {required && (
            <span
              className={cn(
                'text-lg leading-none transition-colors',
                filled ? 'text-green-500' : 'text-orange-500'
              )}
              title={filled ? 'Required field - filled' : 'Required field - please fill'}
            >
              *
            </span>
          )}
          {prop.type && !options && (
            <span className="text-[10px] text-gray-400 font-normal ml-auto">
              {prop.type.split(' | ')[0]}
            </span>
          )}
        </label>

        {/* Dropdown for properties with enum values */}
        {options ? (
          <select
            value={String(value)}
            onChange={(e) => onPropertyUpdate(prop.name, e.target.value)}
            className={cn(
              'w-full px-3 py-2 text-sm border rounded-md focus:outline-none focus:ring-2 focus:ring-azure-blue focus:border-transparent bg-white',
              required && !filled ? 'border-orange-300' : 'border-gray-300'
            )}
          >
            <option value="">Select {formatPropertyName(prop.name)}...</option>
            {options.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        ) : isBoolean(prop) ? (
          // Boolean toggle
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={Boolean(value)}
              onChange={(e) => onPropertyUpdate(prop.name, e.target.checked)}
              className="rounded border-gray-300 text-azure-blue focus:ring-azure-blue w-4 h-4"
            />
            <span className="text-sm text-gray-600">{value ? 'Yes' : 'No'}</span>
          </label>
        ) : isObject(prop) ? (
          // Object/JSON editor
          <textarea
            value={typeof value === 'object' ? JSON.stringify(value, null, 2) : String(value)}
            onChange={(e) => {
              try {
                onPropertyUpdate(prop.name, JSON.parse(e.target.value));
              } catch {
                // Invalid JSON, store as string
                onPropertyUpdate(prop.name, e.target.value);
              }
            }}
            rows={3}
            placeholder={hint || '{ }'}
            className={cn(
              'w-full px-3 py-2 text-sm font-mono border rounded-md focus:outline-none focus:ring-2 focus:ring-azure-blue focus:border-transparent',
              required && !filled ? 'border-orange-300' : 'border-gray-300'
            )}
          />
        ) : (
          // Text/Password input
          <input
            type={sensitive ? 'password' : 'text'}
            value={String(value)}
            onChange={(e) => onPropertyUpdate(prop.name, e.target.value)}
            placeholder={hint || (sensitive ? '••••••••' : `Enter ${formatPropertyName(prop.name)}`)}
            className={cn(
              'w-full px-3 py-2 text-sm border rounded-md focus:outline-none focus:ring-2 focus:ring-azure-blue focus:border-transparent',
              required && !filled ? 'border-orange-300' : 'border-gray-300'
            )}
          />
        )}

        {/* Hint text */}
        {hint && !options && (
          <p className="text-[10px] text-gray-400 mt-0.5 italic line-clamp-2">{hint}</p>
        )}
      </div>
    );
  };

  // Loading state
  if (loading) {
    return (
      <section>
        <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
          Configuration
        </h3>
        <div className="flex items-center gap-2 text-sm text-gray-500 py-4">
          <Icon icon="mdi:loading" className="w-4 h-4 animate-spin" />
          <span>Loading schema from Azure...</span>
        </div>
      </section>
    );
  }

  // Error state - fall back to showing existing properties
  if (error) {
    return (
      <section>
        <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
          Configuration
        </h3>
        <div className="text-xs text-amber-600 bg-amber-50 px-2 py-1 rounded mb-3">
          <Icon icon="mdi:alert" className="inline w-3 h-3 mr-1" />
          Using local schema (API unavailable)
        </div>
        {/* Show existing properties if schema fetch failed */}
        <ExistingPropertiesEditor properties={properties} onPropertyUpdate={onPropertyUpdate} />
      </section>
    );
  }

  // No properties found
  if (allNestedProps.length === 0) {
    return (
      <section>
        <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
          Configuration
        </h3>
        <p className="text-xs text-gray-400 italic">No configurable properties found</p>
        {/* Still show existing properties if user added some */}
        {Object.keys(properties).length > 0 && (
          <ExistingPropertiesEditor properties={properties} onPropertyUpdate={onPropertyUpdate} />
        )}
      </section>
    );
  }

  // Separate required and optional
  const requiredProps = allNestedProps.filter((p) => p.required && !p.readonly);
  const optionalProps = allNestedProps.filter((p) => !p.required && !p.readonly);

  // Filter by search query
  const filterBySearch = (props: BicepProperty[]) => {
    if (!searchQuery.trim()) return props;
    const query = searchQuery.toLowerCase();
    return props.filter(
      (p) =>
        p.name.toLowerCase().includes(query) ||
        (p.description && p.description.toLowerCase().includes(query))
    );
  };

  const filteredRequired = filterBySearch(requiredProps);
  const filteredOptional = filterBySearch(optionalProps);

  // Determine how many optional to show
  const visibleOptional = showAllOptional
    ? filteredOptional
    : filteredOptional.slice(0, INITIAL_OPTIONAL_COUNT);
  const hiddenOptionalCount = filteredOptional.length - visibleOptional.length;

  // Find properties in user's data that aren't in schema
  const schemaKeys = new Set(allNestedProps.map((p) => p.name));
  const extraProps = Object.keys(properties).filter((k) => !schemaKeys.has(k));

  // Full set of required fields Azure expects (including nested), from the live schema.
  const requiredPaths = schema?.requiredPaths ?? [];
  const providedRequiredCount = requiredPaths.filter((p) => isFilled(resolvePathValue(p.name))).length;

  return (
    <section>
      {/* Header */}
      <div className="bg-gradient-to-r from-brand-primary/10 to-brand-accent/5 -mx-4 px-4 py-2 mb-3 border-b border-brand-primary/20">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-semibold text-brand-dark uppercase tracking-wider">
            Configuration
          </h3>
          {schema && (
            <span className="text-[10px] text-brand-accent font-medium" title={`API Version: ${schema.apiVersion}`}>
              v{schema.apiVersion?.split('-')[0]}
            </span>
          )}
        </div>

        {/* Schema info badge */}
        <div className="flex items-center gap-1.5 text-[10px] text-brand-gray mt-1">
          <Icon icon="mdi:cloud-check" className="w-3 h-3 text-brand-primary" />
          <span>Live schema • <strong className="text-brand-accent">{allNestedProps.length}</strong> properties</span>
        </div>
      </div>

      {/* Required-field coverage (read-only, from the live Azure schema). Proves every
          required field - including nested ones - is known. Collapsed by default. */}
      {requiredPaths.length > 0 && (
        <div className="mb-3 rounded-md border border-brand-accent/30 bg-brand-accent/5">
          <button
            onClick={() => setShowRequired((v) => !v)}
            className="w-full flex items-center justify-between px-2.5 py-1.5 text-[11px] font-medium text-brand-dark hover:bg-brand-accent/5 transition-colors rounded-md"
          >
            <span className="flex items-center gap-1.5">
              <Icon icon="mdi:clipboard-check-outline" className="w-3.5 h-3.5 text-brand-accent" />
              Azure requires {requiredPaths.length} field{requiredPaths.length === 1 ? '' : 's'}
              <span className="text-brand-accent">({providedRequiredCount} provided)</span>
            </span>
            <Icon
              icon={showRequired ? 'mdi:chevron-up' : 'mdi:chevron-down'}
              className="w-4 h-4 text-brand-gray"
            />
          </button>
          {showRequired && (
            <ul className="px-2.5 pb-2 pt-0.5 space-y-1">
              {requiredPaths.map((p) => {
                const provided = isFilled(resolvePathValue(p.name));
                return (
                  <li key={p.name} className="flex items-center gap-1.5 text-[11px]">
                    <Icon
                      icon={provided ? 'mdi:check-circle' : 'mdi:circle-outline'}
                      className={cn('w-3.5 h-3.5 shrink-0', provided ? 'text-green-500' : 'text-brand-gray/50')}
                    />
                    <span className="font-mono text-brand-dark truncate" title={p.name}>{p.name}</span>
                    {p.type && (
                      <span className="text-[10px] text-brand-gray ml-auto shrink-0">{p.type.split(' | ')[0]}</span>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}

      {/* Search bar (shown when there are many properties) */}
      {allNestedProps.length > 5 && (
        <div className="relative mb-3">
          <Icon
            icon="mdi:magnify"
            className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-brand-primary"
          />
          <input
            type="text"
            placeholder="Search properties..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-8 py-2 text-xs border border-brand-grayLight rounded-md bg-brand-primary/5 focus:outline-none focus:ring-2 focus:ring-brand-primary/30 focus:border-brand-primary/50 placeholder:text-brand-gray/60 transition-colors"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-brand-gray hover:text-brand-dark transition-colors"
            >
              <Icon icon="mdi:close" className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      )}

      {/* All Properties - Required first, then Optional */}
      <div className="space-y-3">
        {/* Required Properties */}
        {filteredRequired.map((prop) => renderField(prop))}

        {/* Divider if we have both required and optional */}
        {filteredRequired.length > 0 && filteredOptional.length > 0 && (
          <div className="border-t border-gray-200 pt-3 mt-3">
            <p className="text-[10px] text-gray-400 uppercase tracking-wider mb-2">
              Optional ({filteredOptional.length})
            </p>
          </div>
        )}

        {/* Optional Properties */}
        {visibleOptional.map((prop) => renderField(prop))}

        {/* Show more/less toggle */}
        {hiddenOptionalCount > 0 && (
          <button
            onClick={() => setShowAllOptional(true)}
            className="w-full text-xs text-brand-accent hover:text-brand-accentDark py-2 flex items-center justify-center gap-1 border border-dashed border-brand-accent/40 rounded-md hover:bg-brand-accent/5 transition-colors"
          >
            <Icon icon="mdi:chevron-down" className="w-4 h-4" />
            Show {hiddenOptionalCount} more properties
          </button>
        )}
        {showAllOptional && filteredOptional.length > INITIAL_OPTIONAL_COUNT && (
          <button
            onClick={() => setShowAllOptional(false)}
            className="w-full text-xs text-brand-gray hover:text-brand-dark py-1 flex items-center justify-center gap-1 transition-colors"
          >
            <Icon icon="mdi:chevron-up" className="w-4 h-4" />
            Show less
          </button>
        )}

        {/* No results from search */}
        {searchQuery && filteredRequired.length === 0 && filteredOptional.length === 0 && (
          <p className="text-xs text-gray-400 text-center py-2 italic">
            No properties match "{searchQuery}"
          </p>
        )}
      </div>

      {/* Extra properties not in schema */}
      {extraProps.length > 0 && (
        <div className="mt-4 pt-4 border-t border-gray-200">
          <h4 className="text-xs font-medium text-gray-400 mb-2">Custom Properties</h4>
          <div className="space-y-3">
            {extraProps.map((key) => (
              <div key={key}>
                <label className="block text-xs font-medium text-gray-700 mb-1 capitalize">
                  {formatPropertyName(key)}
                </label>
                <input
                  type={isSensitive(key) ? 'password' : 'text'}
                  value={String(properties[key] ?? '')}
                  onChange={(e) => onPropertyUpdate(key, e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-azure-blue focus:border-transparent"
                />
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

// ===== FALLBACK EDITOR FOR EXISTING PROPERTIES =====
interface ExistingPropertiesEditorProps {
  properties: Record<string, unknown>;
  onPropertyUpdate: (key: string, value: unknown) => void;
}

function ExistingPropertiesEditor({
  properties,
  onPropertyUpdate,
}: ExistingPropertiesEditorProps) {
  if (Object.keys(properties).length === 0) {
    return null;
  }

  return (
    <div className="space-y-3">
      {Object.entries(properties).map(([key, value]) => (
        <div key={key}>
          <label className="block text-xs font-medium text-gray-700 mb-1 capitalize">
            {formatPropertyName(key)}
          </label>
          {typeof value === 'boolean' ? (
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={value}
                onChange={(e) => onPropertyUpdate(key, e.target.checked)}
                className="rounded border-gray-300 text-azure-blue focus:ring-azure-blue"
              />
              <span className="text-sm text-gray-600">{value ? 'Yes' : 'No'}</span>
            </label>
          ) : typeof value === 'object' && value !== null ? (
            <textarea
              value={JSON.stringify(value, null, 2)}
              onChange={(e) => {
                try {
                  onPropertyUpdate(key, JSON.parse(e.target.value));
                } catch {
                  // Invalid JSON
                }
              }}
              rows={3}
              className="w-full px-3 py-2 text-sm font-mono border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-azure-blue focus:border-transparent"
            />
          ) : (
            <input
              type="text"
              value={String(value)}
              onChange={(e) => onPropertyUpdate(key, e.target.value)}
              className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-azure-blue focus:border-transparent"
            />
          )}
        </div>
      ))}
    </div>
  );
}

export default DynamicBicepPropertiesSection;
