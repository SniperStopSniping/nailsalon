import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const runner = fileURLToPath(new URL('./verify-saved-ai-sites-readonly.mjs', import.meta.url));
const inherited = Object.fromEntries(['PATH', 'HOME', 'TMPDIR'].filter(key => process.env[key]).map(key => [key, process.env[key]]));
const invoke = (env, argument = '') => spawnSync(process.execPath, [runner, argument], { env: { ...inherited, ...env }, encoding: 'utf8', timeout: 10000 });

test('requires opt-in before opening an archive, browser or database', () => {
  const result = invoke({});
  assert.notEqual(result.status, 0);
  assert.equal(result.stdout, '');
});

test('rejects every model/auth/payment credential without printing its value', () => {
  for (const key of ['OPENAI_API_KEY', 'OPENAI_API_KEY_CUSTOM_SITES', 'OPENAI_API_KEY_OWNER_ASSISTANT', 'CLERK_SECRET_KEY', 'STRIPE_SECRET_KEY']) {
    const sentinel = `private-control-${randomUUID()}`;
    const result = invoke({ LUSTER_SAVED_AI_READONLY_CHECK: 'true', [key]: sentinel });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /must not receive real provider credentials/u);
    assert(!(result.stdout + result.stderr).includes(sentinel));
    assert.equal(result.stdout, '');
  }
});

test('rejects hosted and secret-bearing targets without reflecting the input', () => {
  for (const prefix of ['https://example.com/preview?token=', '/tmp/another-task/']) {
    const sentinel = `private-control-${randomUUID()}`;
    const result = invoke({ LUSTER_SAVED_AI_READONLY_CHECK: 'true' }, prefix + sentinel);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Use only a private local optimized build archive/u);
    assert(!(result.stdout + result.stderr).includes(sentinel));
    assert.equal(result.stdout, '');
  }
});
