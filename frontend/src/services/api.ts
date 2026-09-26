// API Client Service

import type {
  GenerateIaCRequest,
  GenerateIaCResponse,
  ValidateIaCRequest,
  ValidateIaCResponse,
  ComplianceReport,
} from '@/types';

import { API_BASE } from '@/lib/apiConfig';

export class ApiError extends Error {
  status: number;
  details?: Record<string, unknown>;

  constructor(
    status: number,
    message: string,
    details?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.details = details;
  }
}

class ApiClient {
  private baseUrl = API_BASE;
  private token: string | null = null;

  setToken(token: string | null) {
    this.token = token;
  }

  getToken(): string | null {
    return this.token;
  }

  private async request<T>(
    path: string,
    options: RequestInit = {}
  ): Promise<T> {
    const headers: HeadersInit = {
      'Content-Type': 'application/json',
      ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}),
      ...options.headers,
    };

    const response = await fetch(`${API_BASE}${path}`, {
      ...options,
      headers,
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new ApiError(
        response.status,
        error.message || error.detail || 'Request failed',
        error
      );
    }

    // Handle empty responses
    const text = await response.text();
    if (!text) return {} as T;
    
    return JSON.parse(text);
  }

  // Health check
  async health(): Promise<{ status: string; version: string }> {
    return this.request('/health');
  }

  // ==================== Architecture Advisor ====================
  
  /**
   * Chat with the Architecture Advisor (Azure Docs Agent with MCP)
   * Provides enterprise-grade architecture recommendations based on Microsoft best practices
   */
  async architectureAdvisor(
    message: string,
    diagramContext?: { nodes: unknown[]; edges: unknown[] },
    conversationHistory?: Array<{ role: string; content: string }>
  ): Promise<{
    response: string;
    sources: string[] | null;
    agent_name: string;
    duration_ms: number;
  }> {
    return this.request('/api/chat/advisor', {
      method: 'POST',
      body: JSON.stringify({
        message,
        diagram_context: diagramContext,
        conversation_history: conversationHistory || [],
      }),
    });
  }

  /**
   * Stream Architecture Advisor responses for real-time feedback
   */
  streamArchitectureAdvisor(
    message: string,
    diagramContext: { nodes: unknown[]; edges: unknown[] } | undefined,
    conversationHistory: Array<{ role: string; content: string }>,
    onChunk: (content: string) => void,
    onComplete: (sources: string[] | null, agentName: string) => void,
    onError: (error: string) => void
  ): () => void {
    const controller = new AbortController();
    
    const runStream = async () => {
      try {
        const response = await fetch(`${this.baseUrl}/api/chat/advisor/stream`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            message,
            diagram_context: diagramContext,
            conversation_history: conversationHistory,
          }),
          signal: controller.signal,
        });

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const reader = response.body?.getReader();
        if (!reader) {
          throw new Error('No response body');
        }

        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          let eventType = '';
          let eventData = '';

          for (const line of lines) {
            if (line.startsWith('event: ')) {
              eventType = line.slice(7).trim();
            } else if (line.startsWith('data: ')) {
              eventData = line.slice(6);
              
              if (eventType && eventData) {
                try {
                  const data = JSON.parse(eventData);
                  
                  if (eventType === 'message') {
                    if (data.done) {
                      onComplete(data.sources, data.agent_name);
                    } else {
                      onChunk(data.content);
                    }
                  } else if (eventType === 'error') {
                    onError(data.error);
                  }
                } catch (e) {
                  console.error('Failed to parse SSE data:', e);
                }
              }
              eventType = '';
              eventData = '';
            }
          }
        }
      } catch (error) {
        if ((error as Error).name !== 'AbortError') {
          onError(error instanceof Error ? error.message : 'Stream failed');
        }
      }
    };

    runStream();
    return () => controller.abort();
  }

  // IaC Generation (Local - uses AzureArchitectAgent)
  async generateIaC(request: GenerateIaCRequest): Promise<GenerateIaCResponse> {
    return this.request('/api/iac/generate', {
      method: 'POST',
      body: JSON.stringify(request),
    });
  }

  // IaC Generation via Azure AI Foundry Agents
  async generateIaCWithFoundry(
    architecture: { nodes: unknown[]; edges: unknown[] },
    format: 'bicep' | 'terraform' = 'bicep',
    modular: boolean = false
  ): Promise<{ template: string; format: string; agent_name: string; duration_ms: number; compliance?: ComplianceReport | null }> {
    return this.request('/api/agents/iac/generate', {
      method: 'POST',
      body: JSON.stringify({ architecture, format, modular }),
    });
  }

  // Modular IaC Generation via Azure AI Foundry Agents
  async generateModularIaCWithFoundry(
    architecture: { nodes: unknown[]; edges: unknown[] },
    format: 'bicep' | 'terraform' = 'bicep'
  ): Promise<{
    files: Array<{ path: string; content: string; description: string }>;
    format: string;
    agent_name: string;
    duration_ms: number;
    structure_summary: string;
    compliance?: ComplianceReport | null;
  }> {
    return this.request('/api/agents/iac/generate', {
      method: 'POST',
      body: JSON.stringify({ architecture, format, modular: true }),
    });
  }

  // IaC Validation
  async validateIaC(request: ValidateIaCRequest): Promise<ValidateIaCResponse> {
    return this.request('/api/iac/validate', {
      method: 'POST',
      body: JSON.stringify(request),
    });
  }

  // ==================== Deploy API (uses Azure CLI) ====================

  /**
   * Check Azure CLI authentication status
   */
  async getDeployStatus(): Promise<{
    authenticated: boolean;
    subscription_id?: string;
    subscription_name?: string;
    user?: string;
    tenant_id?: string;
    error?: string;
  }> {
    return this.request('/api/deploy/status');
  }

  /**
   * Sign out from Azure CLI
   */
  async logoutDeploy(): Promise<{ success: boolean; message: string }> {
    return this.request('/api/deploy/logout', {
      method: 'POST',
    });
  }

  /**
   * List available resource groups
   */
  async listResourceGroups(subscriptionId?: string): Promise<{
    resource_groups: Array<{ name: string; location: string; id: string }>;
    subscription_id: string;
  }> {
    const query = subscriptionId ? `?subscription_id=${subscriptionId}` : '';
    return this.request(`/api/deploy/resource-groups${query}`);
  }

  /**
   * List the Azure subscriptions the signed-in user can access (via `az account list`).
   * Never throws for the caller's decision-making: returns an empty list on any failure
   * so the UI can fall back to manual entry.
   */
  async listSubscriptions(): Promise<{
    subscriptions: Array<{
      subscription_id: string;
      name: string;
      tenant_id?: string;
      is_default?: boolean;
      state?: string;
    }>;
    authenticated?: boolean;
    default_subscription_id?: string;
    error?: string;
  }> {
    try {
      return await this.request('/api/deploy/subscriptions');
    } catch {
      return { subscriptions: [], authenticated: false };
    }
  }

  /**
   * Validate deployment (what-if)
   */
  async validateDeployment(
    files: Array<{ path: string; content: string }>,
    resourceGroup: string,
    parametersFile?: string,
    subscriptionId?: string
  ): Promise<DeployResultResponse> {
    return this.request('/api/deploy/validate', {
      method: 'POST',
      body: JSON.stringify({
        files,
        resource_group: resourceGroup,
        parameters_file: parametersFile || 'parameters/dev.parameters.json',
        subscription_id: subscriptionId,
        dry_run: true,
      }),
    });
  }

  /**
   * Preview deployment changes (What-If)
   */
  async previewDeployment(
    files: Array<{ path: string; content: string }>,
    resourceGroup: string,
    parametersFile?: string,
    subscriptionId?: string
  ): Promise<WhatIfResponse> {
    return this.request('/api/deploy/what-if', {
      method: 'POST',
      body: JSON.stringify({
        files,
        resource_group: resourceGroup,
        parameters_file: parametersFile || 'parameters/dev.parameters.json',
        subscription_id: subscriptionId,
      }),
    });
  }

  /**
   * Stream What-If preview with live logs
   */
  streamPreviewDeployment(
    files: Array<{ path: string; content: string }>,
    resourceGroup: string,
    onLog: (message: string, step: string) => void,
    onChange: (change: WhatIfChange) => void,
    onComplete: (result: WhatIfResponse) => void,
    onError: (error: string) => void,
    parametersFile?: string,
    subscriptionId?: string
  ): () => void {
    const controller = new AbortController();
    
    const runStream = async () => {
      try {
        const response = await fetch(`${this.baseUrl}/api/deploy/what-if/stream`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            files,
            resource_group: resourceGroup,
            parameters_file: parametersFile || 'parameters/dev.parameters.json',
            subscription_id: subscriptionId,
          }),
          signal: controller.signal,
        });

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const reader = response.body?.getReader();
        if (!reader) {
          throw new Error('No response body');
        }

        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          let eventType = '';
          let eventData = '';

          for (const line of lines) {
            if (line.startsWith('event: ')) {
              eventType = line.slice(7).trim();
            } else if (line.startsWith('data: ')) {
              eventData = line.slice(6);
              
              if (eventType && eventData) {
                try {
                  const data = JSON.parse(eventData);
                  
                  if (eventType === 'log') {
                    onLog(data.message, data.step);
                  } else if (eventType === 'change') {
                    onChange(data as WhatIfChange);
                  } else if (eventType === 'complete') {
                    onComplete({
                      success: data.success,
                      changes: data.changes || [],
                      summary: data.summary || {},
                      duration_seconds: data.duration || 0,
                      error: data.error,
                      warnings: []
                    });
                  } else if (eventType === 'error') {
                    onError(data.message);
                  }
                } catch (e) {
                  console.error('Failed to parse SSE data:', e);
                }
              }
              eventType = '';
              eventData = '';
            }
          }
        }
      } catch (error) {
        if ((error as Error).name !== 'AbortError') {
          onError(error instanceof Error ? error.message : 'Stream failed');
        }
      }
    };

    runStream();

    // Return abort function
    return () => controller.abort();
  }

  /**
   * Deploy Bicep templates to Azure
   */
  async deployToAzure(
    files: Array<{ path: string; content: string }>,
    resourceGroup: string,
    parametersFile?: string,
    subscriptionId?: string
  ): Promise<DeployResultResponse> {
    return this.request('/api/deploy/', {
      method: 'POST',
      body: JSON.stringify({
        files,
        resource_group: resourceGroup,
        parameters_file: parametersFile || 'parameters/dev.parameters.json',
        subscription_id: subscriptionId,
        dry_run: false,
      }),
    });
  }
}

// Type for deploy result
interface DeployResultResponse {
  success: boolean;
  deployment_name: string;
  provisioning_state: string;
  duration_seconds: number;
  outputs: Record<string, unknown>;
  resources: Array<{ id: string; resource_group: string }>;
  correlation_id?: string;
  error?: string;
  warnings: string[];
}

// Type for What-If change
interface WhatIfChange {
  resource_id: string;
  resource_type: string;
  resource_name: string;
  change_type: 'Create' | 'Modify' | 'Delete' | 'NoChange' | 'Ignore';
  icon?: string;
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
  delta?: Array<Record<string, unknown>>;
}

// Type for What-If response
interface WhatIfResponse {
  success: boolean;
  changes: WhatIfChange[];
  summary: Record<string, number>;
  duration_seconds: number;
  error?: string;
  warnings: string[];
}

export type { DeployResultResponse, WhatIfChange, WhatIfResponse };

export const api = new ApiClient();
export default api;
