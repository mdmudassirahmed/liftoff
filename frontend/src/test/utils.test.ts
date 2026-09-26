import { describe, expect, it } from 'vitest';
import { capitalize, formatBytes, formatDuration, getResourceTypeShortName, slugify } from '@/lib/utils';

describe('utils', () => {
  it('slugifies names', () => {
    expect(slugify('My Web App!')).toBe('my-web-app');
  });

  it('formats sizes and durations', () => {
    expect(formatBytes(0)).toBe('0 Bytes');
    expect(formatBytes(1536)).toBe('1.5 KB');
    expect(formatDuration(45)).toMatch(/45/);
  });

  it('shortens resource types and capitalizes', () => {
    expect(getResourceTypeShortName('Microsoft.Web/sites')).toBe('sites');
    expect(capitalize('liftoff')).toBe('Liftoff');
  });
});
