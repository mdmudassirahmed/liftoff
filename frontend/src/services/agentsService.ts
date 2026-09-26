/**
 * Azure AI Foundry Agents Service
 * 
 * Client for interacting with Azure AI Foundry published agents via the backend.
 * 
 * Published Agents:
 * - orchestrator-agent (v2): Central coordinator
 * - iac-generator-agent (v4): Bicep/Terraform generation
 * - azure-docs-agent (v2): Microsoft Learn search via MCP
 * - security-advisor-agent (v2): Security analysis
 * - validation-agent (v1): IaC validation with Code Interpreter
 */

import { API_BASE } from '@/lib/apiConfig';

// Agent types available
export type AgentType = 
  | 'orchestrator' 
  | 'iac_generator' 
  | 'azure_docs' 
  | 'security_advisor' 
  | 'validation';

// Response types
export interface AgentChatResponse {
  content: string;
  agent_type: string;
  agent_name: string;
  sources?: string[];
  tool_calls?: Record<string, unknown>[];
  duration_ms: number;
}

export interface IaCGenerateResponse {
  template: string;
  format: string;
  agent_name: string;
  validation_result?: Record<string, unknown>;
  duration_ms: number;
}

export interface IaCValidateResponse {
  is_valid: boolean;
  issues: Array<{
    severity: string;
    message: string;
    line?: number;
  }>;
  recommendations: string[];
  agent_name: string;
  duration_ms: number;
}

export interface SecurityAnalyzeResponse {
  findings: Array<{
    severity: string;
    category: string;
    description: string;
    recommendation: string;
  }>;
  summary: string;
  risk_score?: number;
  agent_name: string;
  duration_ms: number;
}

export interface DocSearchResponse {
  results: string;
  agent_name: string;
  sources?: string[];
  duration_ms: number;
}

export interface DiagramFromPromptResponse {
  diagram: {
    nodes: unknown[];
    edges: unknown[];
  };
  agent_name: string;
  duration_ms: number;
}

export interface OrchestrateResponse {
  response: string;
  agent_name: string;
  duration_ms: number;
}

export interface FullWorkflowResponse {
  docs_research: string;
  iac_template: string;
  security_analysis: string;
  validation_result: string;
  success: boolean;
  duration_ms: number;
}

export interface AgentCard {
  name: string;
  agent_type: string;
  version: number;
  description: string;
  capabilities: string[];
}

export interface AgentInfo {
  agent_name: string;
  version: number;
  responses_endpoint: string;
  description?: string;
  capabilities?: string[];
}

export interface AgentsListResponse {
  status: string;
  agents: Record<string, AgentInfo>;
  count: number;
  api_version: string;
}

export interface AgentHealthResponse {
  status: 'healthy' | 'unhealthy' | 'degraded';
  foundry_connected?: boolean;  // Optional for backward compatibility
  agents_discovered?: number;   // Number of agents discovered
  agent_names?: string[];       // List of agent names
  api_version?: string;
  error?: string;
}

class AgentsService {
  private baseUrl: string;

  constructor() {
    this.baseUrl = `${API_BASE}/api/agents`;
  }

  private async request<T>(
    endpoint: string, 
    options: RequestInit = {}
  ): Promise<T> {
    const response = await fetch(`${this.baseUrl}${endpoint}`, {
      headers: {
        'Content-Type': 'application/json',
        ...options.headers,
      },
      ...options,
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ detail: 'Request failed' }));
      throw new Error(error.detail || `HTTP ${response.status}`);
    }

    return response.json();
  }

  /**
   * Chat with a specific agent
   */
  async chat(
    message: string,
    agentType?: AgentType,
    context?: Record<string, unknown>
  ): Promise<AgentChatResponse> {
    return this.request('/chat', {
      method: 'POST',
      body: JSON.stringify({
        message,
        agent_type: agentType,
        context,
      }),
    });
  }

  /**
   * Generate IaC from architecture
   */
  async generateIaC(
    architecture: Record<string, unknown>,
    format: 'bicep' | 'terraform' = 'bicep'
  ): Promise<IaCGenerateResponse> {
    return this.request('/iac/generate', {
      method: 'POST',
      body: JSON.stringify({
        architecture,
        format,
        include_comments: true,
      }),
    });
  }

  /**
   * Validate IaC template
   */
  async validateIaC(
    template: string,
    templateType: 'bicep' | 'terraform' = 'bicep'
  ): Promise<IaCValidateResponse> {
    return this.request('/iac/validate', {
      method: 'POST',
      body: JSON.stringify({
        template,
        template_type: templateType,
      }),
    });
  }

  /**
   * Analyze architecture security
   */
  async analyzeSecurity(
    architecture: Record<string, unknown>,
    complianceFrameworks: string[] = ['asb']
  ): Promise<SecurityAnalyzeResponse> {
    return this.request('/security/analyze', {
      method: 'POST',
      body: JSON.stringify({
        architecture,
        compliance_frameworks: complianceFrameworks,
      }),
    });
  }

  /**
   * Search Microsoft Learn documentation
   */
  async searchDocs(query: string): Promise<DocSearchResponse> {
    return this.request('/docs/search', {
      method: 'POST',
      body: JSON.stringify({ query }),
    });
  }

  /**
   * Generate diagram from natural language prompt.
   * The JSON schema is handled by the backend - users only provide a simple description.
   */
  async generateDiagramFromPrompt(prompt: string, csp?: string): Promise<DiagramFromPromptResponse> {
    return this.request('/diagram/generate', {
      method: 'POST',
      body: JSON.stringify({ prompt, csp: csp || 'azure' }),
    });
  }

  /**
   * List all agents with endpoints
   */
  async listAgents(): Promise<AgentsListResponse> {
    return this.request('/agents');
  }

  /**
   * Initialize agents
   */
  async initialize(): Promise<{
    status: string;
    message: string;
    agents?: string[];
  }> {
    return this.request('/initialize', { method: 'POST' });
  }

  /**
   * Health check
   */
  async health(): Promise<AgentHealthResponse> {
    return this.request('/health');
  }
}

// Singleton instance
export const agentsService = new AgentsService();

export default agentsService;
