/* eslint-disable no-template-curly-in-string -- GitHub expressions are literal workflow contracts. */
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { BaseSequencer } from 'vitest/node';
import { parse } from 'yaml';

const workflow = parse(readFileSync(new URL('../.github/workflows/CI.yml', import.meta.url), 'utf8'));
const { jobs } = workflow;

test('required aggregates reject failed, skipped, cancelled and missing evidence', () => {
  for (const id of ['full-vitest', 'test']) {
    const job = jobs[id];
    assert.equal(job.if, '${{ always() }}');
    const step = job.steps[0];
    const variables = Object.keys(step.env);
    const success = Object.fromEntries(variables.map(key => [key, 'success']));
    assert.equal(spawnSync('bash', ['-e', '-c', step.run], { env: success }).status, 0);
    for (const key of variables) {
      for (const result of ['failure', 'skipped', 'cancelled', '']) {
        assert.notEqual(spawnSync('bash', ['-e', '-c', step.run], {
          env: { ...success, [key]: result },
        }).status, 0);
      }
    }
  }
  assert.equal(jobs['full-vitest'].name, 'Full Vitest Suite');
  assert.equal(jobs.test.name, 'Run all tests (20.x)');
  assert.deepEqual(jobs.test.needs, ['test-core', 'test-components']);
  assert.equal(jobs['full-vitest'].needs, 'full-vitest-shards');
});

test('all execution checkouts use the reviewed head and shards cannot fail fast', () => {
  for (const job of Object.values(jobs)) {
    for (const step of job.steps ?? []) {
      if (step.uses === 'actions/checkout@v4') {
        assert.match(step.with.ref, /^\$\{\{ github\.event\.pull_request\.head\.sha(?: \|\| github\.sha)? \}\}$/);
      }
    }
  }
  const shards = jobs['full-vitest-shards'];
  assert.equal(shards.strategy['fail-fast'], false);
  assert.deepEqual(shards.strategy.matrix.shard, [1, 2, 3]);
  assert.equal(shards.steps.at(-1).run, 'npm run test:all -- --shard=${{ matrix.shard }}/3');
});

test('cancellation is scoped to a PR, with unique non-PR run groups', () => {
  assert.equal(workflow.concurrency.group, '${{ github.workflow }}-${{ github.event_name }}-${{ github.event.pull_request.number || github.run_id }}');
  assert.equal(workflow.concurrency['cancel-in-progress'], '${{ github.event_name == \'pull_request\' }}');
});

test('native Vitest shard selection covers every discovered test file exactly once', async () => {
  // Vitest 2 list --filesOnly ignores --shard; use the installed run sequencer.
  const files = execFileSync(process.execPath, [
    'node_modules/vitest/vitest.mjs',
    'list',
    '--filesOnly',
  ], { encoding: 'utf8' }).split('\n').filter(file => file.startsWith('src/') && file.includes('.test.'));
  assert.ok(files.length > 0);
  const specs = files.map(moduleId => ({ moduleId }));
  const indices = jobs['full-vitest-shards'].strategy.matrix.shard;
  const shards = await Promise.all(indices.map(index => new BaseSequencer({
    config: { root: process.cwd(), shard: { index, count: indices.length } },
  }).shard(specs)));
  assert.deepEqual(shards.flat().map(spec => spec.moduleId).sort(), [...files].sort());
  assert.equal(new Set(shards.flat().map(spec => spec.moduleId)).size, files.length);
});
