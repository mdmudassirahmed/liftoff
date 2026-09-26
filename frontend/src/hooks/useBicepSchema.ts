/**
 * useBicepSchema - React hook for fetching Azure Bicep schemas dynamically
 * 
 * Uses the BicepSchemaFetcher to get real-time property definitions
 * from the Azure Bicep Types repository.
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import { getResourceSchema } from '@/services/bicepSchemaFetcher';
import type { BicepResourceSchema, BicepProperty } from '@/services/bicepSchemaFetcher';

export interface UseBicepSchemaResult {
  /** The fetched schema, or null if not yet loaded */
  schema: BicepResourceSchema | null;
  /** Whether the schema is currently being fetched */
  loading: boolean;
  /** Any error that occurred during fetching */
  error: string | null;
  /** Required properties at the top level */
  requiredProps: BicepProperty[];
  /** Optional properties at the top level */
  optionalProps: BicepProperty[];
  /** Nested properties (typically under 'properties') */
  nestedProps: BicepProperty[];
  /** All properties combined (nested required + nested optional) */
  allNestedProps: BicepProperty[];
  /** Refetch the schema */
  refetch: () => Promise<void>;
  /** Get enum values for a property name */
  getEnumValues: (propName: string) => string[] | null;
  /** Get property info by name */
  getPropertyInfo: (propName: string) => BicepProperty | undefined;
  /** Check if a property is required */
  isRequired: (propName: string) => boolean;
}

/**
 * Hook to fetch and use Azure Bicep schema for a resource type
 * 
 * @param resourceType - The Azure resource type (e.g., "Microsoft.Sql/servers")
 * @param apiVersion - Optional specific API version
 */
export function useBicepSchema(
  resourceType: string | undefined,
  apiVersion?: string
): UseBicepSchemaResult {
  const [schema, setSchema] = useState<BicepResourceSchema | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchSchema = useCallback(async () => {
    if (!resourceType) {
      setSchema(null);
      setLoading(false);
      setError(null);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const result = await getResourceSchema(resourceType, apiVersion);
      if (result) {
        setSchema(result);
      } else {
        setError(`Schema not found for ${resourceType}`);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      setError(message);
      console.error(`[useBicepSchema] Failed to fetch schema for ${resourceType}:`, err);
    } finally {
      setLoading(false);
    }
  }, [resourceType, apiVersion]);

  // Fetch on mount and when resourceType changes
  useEffect(() => {
    fetchSchema();
  }, [fetchSchema]);

  // Derived data
  const requiredProps = useMemo(() => schema?.required || [], [schema]);
  const optionalProps = useMemo(() => schema?.optional || [], [schema]);
  const nestedProps = useMemo(() => schema?.nested?.properties || [], [schema]);
  
  // Combine all nested properties - required first
  const nestedRequired = nestedProps.filter(p => p.required);
  const nestedOptional = nestedProps.filter(p => !p.required);
  const allNestedProps = [...nestedRequired, ...nestedOptional];

  // Helper to find enum values for a property
  const getEnumValues = useCallback((propName: string): string[] | null => {
    // Check top-level first
    const topLevel = [...requiredProps, ...optionalProps].find(p => p.name === propName);
    if (topLevel?.enumValues) return topLevel.enumValues;
    
    // Check nested properties
    const nested = nestedProps.find(p => p.name === propName);
    if (nested?.enumValues) return nested.enumValues;
    
    return null;
  }, [requiredProps, optionalProps, nestedProps]);

  // Helper to get property info
  const getPropertyInfo = useCallback((propName: string): BicepProperty | undefined => {
    // Check top-level
    const topLevel = [...requiredProps, ...optionalProps].find(p => p.name === propName);
    if (topLevel) return topLevel;
    
    // Check nested
    return nestedProps.find(p => p.name === propName);
  }, [requiredProps, optionalProps, nestedProps]);

  // Helper to check if property is required
  const isRequired = useCallback((propName: string): boolean => {
    // Check top-level required
    if (requiredProps.some(p => p.name === propName)) return true;
    
    // Check nested required
    if (nestedProps.some(p => p.name === propName && p.required)) return true;
    
    return false;
  }, [requiredProps, nestedProps]);

  return {
    schema,
    loading,
    error,
    requiredProps,
    optionalProps,
    nestedProps,
    allNestedProps,
    refetch: fetchSchema,
    getEnumValues,
    getPropertyInfo,
    isRequired,
  };
}

/**
 * Format a property name for display (camelCase to Title Case)
 */
export function formatPropertyName(name: string): string {
  return name
    .replace(/([A-Z])/g, ' $1')
    .replace(/^./, str => str.toUpperCase())
    .trim();
}

/**
 * Format a type string for display
 */
export function formatTypeName(type: string): string {
  // Clean up complex type names
  if (type.startsWith('"') && type.endsWith('"')) {
    return type.slice(1, -1); // Remove quotes from literal types
  }
  if (type.includes(' | ')) {
    return 'enum'; // Union types are enums
  }
  return type;
}

export default useBicepSchema;
