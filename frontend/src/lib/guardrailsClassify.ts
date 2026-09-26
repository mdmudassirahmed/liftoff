// Shared security guardrail classification + presentation helpers.
//
// Single source of truth for how the compact summary card and the full report
// modal read a ComplianceReport. Category comes from the backend when present
// (g.category), with a defensive fallback so older responses still render.

import type {
  ComplianceReport,
  ComplianceGuardrail,
  GuardrailCategory,
  GuardrailSeverity,
  GuardrailStatus,
} from '@/types';

// A guardrail plus the resource it matched (null = environment/identity scope).
export interface FlatGuardrail {
  resource_type: string | null;
  g: ComplianceGuardrail;
}

export const SEVERITY_ORDER: GuardrailSeverity[] = [
  'critical',
  'high',
  'medium',
  'low',
  'informational',
  'none',
];

export const SEVERITY_STYLES: Record<GuardrailSeverity, string> = {
  critical: 'bg-red-100 text-red-700 border-red-200',
  high: 'bg-orange-100 text-orange-700 border-orange-200',
  medium: 'bg-amber-100 text-amber-700 border-amber-200',
  low: 'bg-blue-100 text-blue-700 border-blue-200',
  informational: 'bg-gray-100 text-gray-600 border-gray-200',
  none: 'bg-gray-100 text-gray-500 border-gray-200',
};

export const SEVERITY_DOT: Record<GuardrailSeverity, string> = {
  critical: 'bg-red-500',
  high: 'bg-orange-500',
  medium: 'bg-amber-500',
  low: 'bg-blue-500',
  informational: 'bg-gray-400',
  none: 'bg-gray-300',
};

export const STATUS_META: Record<
  GuardrailStatus,
  { icon: string; className: string; label: string }
> = {
  pass: { icon: 'mdi:check-circle', className: 'text-emerald-600', label: 'Enforced' },
  warn: { icon: 'mdi:close-circle', className: 'text-red-600', label: 'Not met' },
  advisory: { icon: 'mdi:information-outline', className: 'text-gray-500', label: 'Recommended' },
};

// Matches CVE/patch-remediation guardrails (e.g. "Upgrade ... to remediate CVE-2021-22118").
// Deliberately specific so it can never hide a genuine control (controls are status-based).
const CVE_RE = /\bCVE-\d/i;

export function severityLabel(sev: GuardrailSeverity): string {
  return (sev || 'none').charAt(0).toUpperCase() + (sev || 'none').slice(1);
}

// Short, readable resource label (e.g. "Microsoft.Storage/storageAccounts" -> "storageAccounts").
export function shortType(resourceType: string | null): string {
  if (!resourceType) return 'Environment';
  return resourceType.split('/').pop() || resourceType;
}

// Layer label for filter chips: "Resource" (attached to a diagram node) or
// "Platform" (subscription / identity scope). Unknown values pass through.
export function layerKey(layer: string): string {
  const l = (layer || '').trim().toLowerCase();
  if (l === 'resource') return 'Resource';
  if (l === 'platform') return 'Platform';
  return layer || 'Other';
}

// Classify a guardrail. Trust the backend category first; fall back to a
// status + CVE heuristic so responses that predate the category field still work.
export function classify(g: ComplianceGuardrail): GuardrailCategory {
  if (g.category === 'control' || g.category === 'vulnerability' || g.category === 'guidance') {
    return g.category;
  }
  if (g.status === 'pass' || g.status === 'warn') return 'control';
  if (CVE_RE.test(g.recommendation || '') || CVE_RE.test(g.risk || '')) return 'vulnerability';
  return 'guidance';
}

export interface GuardrailBuckets {
  controls: FlatGuardrail[];
  guidance: FlatGuardrail[];
  vulnerabilities: FlatGuardrail[];
  all: FlatGuardrail[];
  controlsPassed: number;
  controlsTotal: number;
  controlsFailed: number;
  allEnforced: boolean;
  // 0-100 confidence: share of enforceable controls the template satisfies.
  confidence: number;
}

// Flatten a report into the three category buckets plus derived counts.
export function bucketize(report: ComplianceReport): GuardrailBuckets {
  const all: FlatGuardrail[] = [];
  report.by_resource.forEach((grp) =>
    grp.guardrails.forEach((g) => all.push({ resource_type: grp.resource_type, g }))
  );
  report.environment.forEach((g) => all.push({ resource_type: null, g }));

  const controls = all.filter((f) => classify(f.g) === 'control');
  const vulnerabilities = all.filter((f) => classify(f.g) === 'vulnerability');
  const guidance = all.filter((f) => classify(f.g) === 'guidance');

  const controlsPassed = controls.filter((f) => f.g.status === 'pass').length;
  const controlsTotal = controls.length;
  const controlsFailed = controlsTotal - controlsPassed;
  const allEnforced = controlsTotal > 0 && controlsFailed === 0;
  const confidence = controlsTotal > 0 ? Math.round((controlsPassed / controlsTotal) * 100) : 100;

  return {
    controls,
    guidance,
    vulnerabilities,
    all,
    controlsPassed,
    controlsTotal,
    controlsFailed,
    allEnforced,
    confidence,
  };
}

export function matchesLayer(guardrail: ComplianceGuardrail, activeLayer: string): boolean {
  if (activeLayer === 'All') return true;
  return layerKey(guardrail.layer) === activeLayer;
}
