// Hooks exports
export { useDiagram } from './useDiagram';
export { useIaCGeneration } from './useIaCGeneration';
export { useDependencies, type ResolvedDependency, type UseDependenciesResult } from './useDependencies';
export { 
  useAzureSchema, 
  prefetchCommonSchemas, 
  fetchAzureSchema,
  type AzureProperty,
  type AzureResourceSchemaDetails,
} from './useAzureSchema';
export {
  useBicepSchema,
  formatPropertyName,
  formatTypeName,
  type UseBicepSchemaResult,
} from './useBicepSchema';
export {
  useAzureAccount,
  type AzureSubscription,
  type AzureResourceGroup,
  type UseAzureAccountResult,
} from './useAzureAccount';
