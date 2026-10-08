import assert from 'node:assert/strict';
import test from 'node:test';

import { getTestFiles } from './test-changed-source.mjs';

test('retains all test extensions owned by the root Vitest configuration', () => {
  const files = [
    'src/component.test.jsx',
    'src/nested/hook.test.tsx',
    'src/module.test.ts',
    'src/legacy.test.js',
    'scripts/nested/guard.test.ts',
    'scripts/utility.test.js',
  ];
  assert.deepEqual(getTestFiles(files, () => false), [...files].sort());
});

test('selects existing sibling tests for changed root source', () => {
  const available = new Set(['src/hook.test.tsx', 'scripts/guard.test.ts']);
  assert.deepEqual(
    getTestFiles(['src/hook.ts', 'scripts/guard.ts', 'src/uncovered.ts'], path => available.has(path)),
    ['scripts/guard.test.ts', 'src/hook.test.tsx'],
  );
});

test('does not submit another package tests to a root runner that excludes them', () => {
  const hook = 'prototypes/site-builder-v2-booking-integration-lab/src/onboarding/state/useOnboardingState';
  assert.deepEqual(getTestFiles([`${hook}.test.tsx`], () => false), []);
  assert.deepEqual(getTestFiles([`${hook}.ts`], path => path === `${hook}.test.tsx`), []);
});

test('mixed changes retain root tests while leaving prototype tests to their package suite', () => {
  assert.deepEqual(getTestFiles([
    'prototypes/lab/src/state.test.tsx',
    'src/features/onboarding-v1-integration/OnboardingV1Integration.test.tsx',
    'scripts/billing-readiness-check.test.ts',
  ], () => false), [
    'scripts/billing-readiness-check.test.ts',
    'src/features/onboarding-v1-integration/OnboardingV1Integration.test.tsx',
  ]);
});

test('rejects unsupported root locations and extensions instead of producing an empty Vitest match', () => {
  assert.deepEqual(getTestFiles([
    'tests/e2e/example.test.ts',
    'src/hook.test.mjs',
    'scripts/widget.test.tsx',
    'src-other/fake.test.ts',
    'scripts-old/fake.test.js',
  ], () => false), []);
});

test('deduplicates and sorts direct and sibling selections', () => {
  assert.deepEqual(getTestFiles([
    'src/z.test.ts',
    'src/a.test.ts',
    'src/a.ts',
    'src/a.test.ts',
  ], path => path === 'src/a.test.ts'), ['src/a.test.ts', 'src/z.test.ts']);
});
