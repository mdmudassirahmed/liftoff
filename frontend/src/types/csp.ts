// CSP (Cloud Service Provider) types

export type CSP = 'azure' | 'aws';

export type IaCFormatForCSP = {
  azure: 'bicep' | 'terraform' | 'arm';
  aws: 'cloudformation';
};

// Per-CSP canvas state snapshot (for cspStore)
export interface CSPCanvasSnapshot {
  nodes: unknown[];
  edges: unknown[];
}

// Map of CSP -> canvas snapshot
export type CSPCanvasMap = Partial<Record<CSP, CSPCanvasSnapshot>>;
