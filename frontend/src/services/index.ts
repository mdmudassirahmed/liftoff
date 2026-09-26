// Services exports
export { api as apiClient } from './api';
export { iacService } from './iacService';

// Azure AI Foundry Agents Service
export {
  agentsService,
  type AgentType,
  type AgentChatResponse,
  type IaCGenerateResponse,
  type IaCValidateResponse,
  type SecurityAnalyzeResponse,
  type DocSearchResponse,
  type OrchestrateResponse,
  type FullWorkflowResponse,
  type AgentCard,
  type AgentInfo,
  type AgentsListResponse,
  type AgentHealthResponse,
} from './agentsService';

// Azure Services - Dynamic data fetching
// Schema Service - Fetches Azure resource schemas from Bicep Types
export {
  fetchResourceTypesIndex,
  fetchResourceSchema,
  getResourceDependencies,
  prefetchCommonSchemas,
  clearSchemaCache,
  type AzureResourceSchema,
  type DependencyInfo,
} from './azureSchemaService';

// Service Catalog - Dynamic catalog of Azure services
export {
  fetchServiceCatalog,
  getServiceByResourceType,
  searchServices,
  getServicesByCategory,
  loadServiceProperties,
  clearServiceCatalogCache,
  type AzureService,
  type ServiceCategory,
  type PropertyDefinition,
} from './serviceCatalog';

// Icon Service - Dynamic icon fetching
export {
  getResourceIcon,
  getResourceIcons,
  preloadCommonIcons,
  getIconifyIcon,
  type IconResult,
} from './azureIconService';

// Validation Engine - Dynamic validation based on schemas
export {
  validateDiagram,
  validateNode,
  getIssuesForNode,
  getIssueCounts,
  type ValidationIssue,
  type ValidationResult,
  type IssueSeverity,
  type IssueType,
} from './dynamicValidationEngine';

// Bicep Schema Fetcher - Dynamic schema fetching from Azure Bicep Types repo
export {
  getResourceSchema as getBicepResourceSchema,
  getIndex as getBicepIndex,
  listAvailableResources,
  getApiVersions,
  clearSchemaCache as clearBicepSchemaCache,
  prefetchCommonSchemas as prefetchBicepSchemas,
  type BicepProperty,
  type BicepResourceSchema,
} from './bicepSchemaFetcher';

// Bicep Schema Validator - Validates Azure resources against live Bicep schemas
export {
  validateArchitecture,
  isArchitectureValid,
  getValidationSummary,
  type SchemaValidationIssue,
  type SchemaValidationResult,
  type ValidationSeverity,
} from './bicepSchemaValidator';
