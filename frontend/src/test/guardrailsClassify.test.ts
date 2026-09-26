// Contract test: fixtures are real reports produced by the backend guardrail
// service (see backend/tests). If a field is renamed on either side, this fails.
import { describe, expect, it } from 'vitest';
import type { ComplianceReport } from '@/types';
import { bucketize, classify, layerKey, matchesLayer, SEVERITY_STYLES, shortType } from '@/lib/guardrailsClassify';
import good from './fixtures/compliance-report-good.json';
import bad from './fixtures/compliance-report-bad.json';

const goodReport = good as unknown as ComplianceReport;
const badReport = bad as unknown as ComplianceReport;

describe('compliance report contract', () => {
  it('exposes the fields the UI renders', () => {
    const row = goodReport.by_resource[0].guardrails[0];
    expect(row.control_id).toMatch(/^LFT-/);
    expect(row.benchmark).toMatch(/^MCSB /);
    expect(typeof row.azure_policy).toBe('string');
    expect(['Resource', 'Platform']).toContain(row.layer);
  });

  it('uses severities the badge styles know about', () => {
    const rows = [...goodReport.by_resource.flatMap((g) => g.guardrails), ...goodReport.environment];
    for (const row of rows) expect(SEVERITY_STYLES[row.severity]).toBeDefined();
  });
});

describe('bucketize', () => {
  it('reports full confidence when every enforceable control passes', () => {
    const b = bucketize(goodReport);
    expect(b.controlsTotal).toBeGreaterThan(0);
    expect(b.controlsFailed).toBe(0);
    expect(b.allEnforced).toBe(true);
    expect(b.confidence).toBe(100);
  });

  it('flags failing controls in an insecure template', () => {
    const b = bucketize(badReport);
    expect(b.controlsFailed).toBeGreaterThan(0);
    expect(b.allEnforced).toBe(false);
    expect(b.confidence).toBeLessThan(100);
  });

  it('puts every row in exactly one bucket', () => {
    const b = bucketize(goodReport);
    expect(b.controls.length + b.guidance.length + b.vulnerabilities.length).toBe(b.all.length);
  });
});

describe('helpers', () => {
  it('classifies by status with a CVE fallback', () => {
    const base = { control_id: 'x', service: 's', layer: 'Resource', severity: 'high', recommendation: '' } as const;
    expect(classify({ ...base, status: 'pass' })).toBe('control');
    expect(classify({ ...base, status: 'advisory', recommendation: 'Patch CVE-2024-1234' })).toBe('vulnerability');
    expect(classify({ ...base, status: 'advisory' })).toBe('guidance');
  });

  it('maps layers and filters by them', () => {
    expect(layerKey('resource')).toBe('Resource');
    expect(layerKey('Platform')).toBe('Platform');
    expect(layerKey('')).toBe('Other');
    const row = goodReport.environment[0];
    expect(matchesLayer(row, 'All')).toBe(true);
    expect(matchesLayer(row, 'Platform')).toBe(true);
    expect(matchesLayer(row, 'Resource')).toBe(false);
  });

  it('shortens resource types', () => {
    expect(shortType('Microsoft.Storage/storageAccounts')).toBe('storageAccounts');
    expect(shortType(null)).toBe('Environment');
  });
});
