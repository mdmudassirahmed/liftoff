// IaC Generation Types

export type IaCFormat = 'bicep' | 'arm' | 'terraform' | 'cloudformation';
export type TargetScope = 'resourceGroup' | 'subscription' | 'managementGroup' | 'tenant';

export interface GenerateIaCRequest {
  diagram: {
    nodes: DiagramNodePayload[];
    edges: DiagramEdgePayload[];
  };
  options: IaCGenerationOptions;
  csp?: string;
}

export interface DiagramNodePayload {
  id: string;
  type: 'service' | 'group';
  data: Record<string, unknown>;
  position: { x: number; y: number };
  parentId?: string;
}

export interface DiagramEdgePayload {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string;
  targetHandle?: string;
  data?: { connectionType: string };
}

export interface IaCGenerationOptions {
  format: IaCFormat;
  useMcp: boolean;
  targetScope?: TargetScope;
  includeParameters?: boolean;
  includeOutputs?: boolean;
  moduleize?: boolean;
}

export interface GenerateIaCResponse {
  success: boolean;
  code: string;
  format: IaCFormat;
  validationErrors: ValidationMessage[];
  validationWarnings: ValidationMessage[];
  metadata?: IaCMetadata;
}

export interface ValidationMessage {
  path: string;
  message: string;
  code?: string;
  severity?: 'error' | 'warning' | 'info';
  line?: number;
  column?: number;
}

export interface IaCMetadata {
  resourceCount: number;
  estimatedCost?: CostEstimate;
  resources?: ResourceInfo[];
  apiVersions?: Record<string, string>;
}

export interface CostEstimate {
  monthly: number;
  currency: string;
  breakdown?: CostBreakdownItem[];
}

export interface CostBreakdownItem {
  resourceName: string;
  resourceType: string;
  monthlyCost: number;
}

export interface ResourceInfo {
  name: string;
  type: string;
  apiVersion: string;
}

export interface ValidateIaCRequest {
  code: string;
  format: IaCFormat;
}

export interface ValidateIaCResponse {
  valid: boolean;
  errors: ValidationMessage[];
  warnings: ValidationMessage[];
  schema?: {
    resources: ResourceInfo[];
  };
}

export interface IaCState {
  generatedCode: string;
  format: IaCFormat;
  isGenerating: boolean;
  validationErrors: ValidationMessage[];
  validationWarnings: ValidationMessage[];
  metadata: IaCMetadata | null;
  lastGeneratedAt: string | null;
}

// Security guardrail compliance. Optional on every IaC response:
// when absent (null/undefined) the UI behaves exactly as before.
export type GuardrailSeverity =
  | 'critical'
  | 'high'
  | 'medium'
  | 'low'
  | 'informational'
  | 'none';

export type GuardrailStatus = 'pass' | 'warn' | 'advisory';

// Backend classification of a guardrail row (single source of truth). Optional:
// when absent the UI derives it from status + a CVE regex fallback.
export type GuardrailCategory = 'control' | 'vulnerability' | 'guidance';

export interface ComplianceGuardrail {
  control_id: string;
  service: string;
  layer: string;
  severity: GuardrailSeverity;
  status: GuardrailStatus;
  recommendation: string;
  risk?: string;
  benchmark?: string;
  /** Built-in Azure Policy (Azure) or AWS Config managed rule (AWS) that audits the control. */
  policy?: string;
  category?: GuardrailCategory;
}

export interface ComplianceCheck {
  id: string;
  resource_type: string;
  title: string;
  severity: GuardrailSeverity;
  status: GuardrailStatus;
}

export interface ComplianceResourceGroup {
  resource_type: string;
  guardrails: ComplianceGuardrail[];
}

export interface ComplianceSummary {
  guardrails_total: number;
  resource_guardrails: number;
  environment_guardrails: number;
  by_severity: Partial<Record<GuardrailSeverity, number>>;
  checks_passed: number;
  checks_failed: number;
}

// A per-service, documented exception to the public-network-access baseline
// (e.g. no VNet available). Surfaced as an accepted advisory, never a failure.
export interface NetworkException {
  name: string;
  resource_type: string;
  justification?: string;
}

export interface ComplianceReport {
  enabled: boolean;
  format: string;
  summary: ComplianceSummary;
  checks: ComplianceCheck[];
  by_resource: ComplianceResourceGroup[];
  environment: ComplianceGuardrail[];
  // Absent/empty on older responses; the UI guards on presence.
  exceptions?: NetworkException[];
}
