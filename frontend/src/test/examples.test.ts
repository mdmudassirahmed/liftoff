// The diagrams in /examples are what new users import first - keep them valid.
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const EXAMPLES_DIR = resolve(__dirname, '../../../examples');
const files = readdirSync(EXAMPLES_DIR).filter((f) => f.endsWith('.json'));

describe.each(files)('examples/%s', (file) => {
  const diagram = JSON.parse(readFileSync(join(EXAMPLES_DIR, file), 'utf-8'));
  const ids = new Set(diagram.nodes.map((n: { id: string }) => n.id));

  it('passes the import dialog checks', () => {
    expect(Array.isArray(diagram.nodes)).toBe(true);
    expect(Array.isArray(diagram.edges)).toBe(true);
    for (const n of diagram.nodes) {
      expect(n.id && n.type && n.position && n.data).toBeTruthy();
      expect(['azure.group', 'azure.service']).toContain(n.type);
    }
    for (const e of diagram.edges) expect(e.id && e.source && e.target).toBeTruthy();
  });

  it('only references nodes that exist', () => {
    for (const n of diagram.nodes) if (n.parentId) expect(ids.has(n.parentId)).toBe(true);
    for (const e of diagram.edges) {
      expect(ids.has(e.source)).toBe(true);
      expect(ids.has(e.target)).toBe(true);
    }
  });

  it('gives every service an Azure resource type', () => {
    for (const n of diagram.nodes.filter((x: { type: string }) => x.type === 'azure.service')) {
      expect(n.data.resourceType).toMatch(/^Microsoft\.[A-Za-z]+\/[A-Za-z]+$/);
    }
  });
});
