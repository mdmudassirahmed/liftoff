// IaC Generation Service

import { api } from './api';
import type {
  SerializedDiagram,
  IaCFormat,
  TargetScope,
  GenerateIaCResponse,
  ValidateIaCResponse,
} from '@/types';

export interface IaCGenerationOptions {
  format: IaCFormat;
  useMcp?: boolean;
  targetScope?: TargetScope;
  includeParameters?: boolean;
  includeOutputs?: boolean;
  csp?: 'azure' | 'aws';
}

class IaCService {
  async generateBicep(
    diagram: SerializedDiagram,
    options: Partial<IaCGenerationOptions> = {}
  ): Promise<GenerateIaCResponse> {
    return api.generateIaC({
      diagram: {
        nodes: diagram.nodes.map((node) => ({
          id: node.id,
          type: node.type,
          data: node.data as Record<string, unknown>,
          position: node.position,
          parentId: node.parentId,
        })),
        edges: diagram.edges.map((edge) => ({
          id: edge.id,
          source: edge.source,
          target: edge.target,
          sourceHandle: edge.sourceHandle || undefined,
          targetHandle: edge.targetHandle || undefined,
          data: edge.data ? { connectionType: edge.data.connectionType } : undefined,
        })),
      },
      options: {
        format: options.format || 'bicep',
        useMcp: options.useMcp ?? true,
        targetScope: options.targetScope || 'resourceGroup',
        includeParameters: options.includeParameters ?? true,
        includeOutputs: options.includeOutputs ?? true,
      },
      csp: options.csp || 'azure',
    });
  }

  async generateTerraform(
    diagram: SerializedDiagram,
    options: Partial<IaCGenerationOptions> = {}
  ): Promise<GenerateIaCResponse> {
    return this.generateBicep(diagram, { ...options, format: 'terraform' });
  }

  async generateARM(
    diagram: SerializedDiagram,
    options: Partial<IaCGenerationOptions> = {}
  ): Promise<GenerateIaCResponse> {
    return this.generateBicep(diagram, { ...options, format: 'arm' });
  }

  async validate(code: string, format: IaCFormat): Promise<ValidateIaCResponse> {
    return api.validateIaC({ code, format });
  }

  async validateBicep(code: string): Promise<ValidateIaCResponse> {
    return this.validate(code, 'bicep');
  }

  formatFileName(format: IaCFormat, name: string = 'main'): string {
    switch (format) {
      case 'bicep':
        return `${name}.bicep`;
      case 'arm':
        return `${name}.json`;
      case 'terraform':
        return `${name}.tf`;
      case 'cloudformation':
        return `${name}.yaml`;
      default:
        return `${name}.txt`;
    }
  }

  getLanguageId(format: IaCFormat): string {
    switch (format) {
      case 'bicep':
        return 'bicep';
      case 'arm':
        return 'json';
      case 'terraform':
        return 'hcl';
      case 'cloudformation':
        return 'yaml';
      default:
        return 'plaintext';
    }
  }
}

export const iacService = new IaCService();
export default iacService;
