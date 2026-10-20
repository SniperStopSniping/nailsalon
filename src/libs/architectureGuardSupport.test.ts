import { describe, expect, it } from 'vitest';

import { getValueImportSpecifiers, hasUseClientDirective } from './architectureGuardSupport';

describe('architecture syntax evidence', () => {
  it('rechecks directives and runtime imports when the same path changes', () => {
    const file = 'src/fixtures/changing-boundary.ts';
    const client = `'use client'; import type { Db } from './database'; export const load = () => import('./safe');`;
    const server = `import { db } from './database'; export const value = db;`;

    expect(hasUseClientDirective(client, file)).toBe(true);
    expect(getValueImportSpecifiers(client, file)).toEqual(['./safe']);
    expect(getValueImportSpecifiers(server, file)).toEqual(['./database']);
    expect(hasUseClientDirective(server, file)).toBe(false);
    expect(hasUseClientDirective(client, file)).toBe(true);
    expect(getValueImportSpecifiers(client, file)).toEqual(['./safe']);
  });

  it('prevents a caller from changing the import evidence another guard reads', () => {
    const file = 'src/fixtures/independent-boundary.ts';
    const source = `'use client'; import { value } from './safe';`;
    const imports = getValueImportSpecifiers(source, file);
    imports.splice(0, imports.length, 'server-only');

    expect(getValueImportSpecifiers(source, file)).toEqual(['./safe']);
    expect(hasUseClientDirective(source, file)).toBe(true);
    expect(getValueImportSpecifiers(source, file)).not.toBe(imports);
  });
});
