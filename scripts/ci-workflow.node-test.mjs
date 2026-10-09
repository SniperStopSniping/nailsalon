/* eslint-disable no-template-curly-in-string -- GitHub expressions are literal workflow contracts. */
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { BaseSequencer } from 'vitest/node';
import { parse } from 'yaml';

const workflow = parse(readFileSync(new URL('../.github/workflows/CI.yml', import.meta.url), 'utf8'));
const { jobs } = workflow;

test('CI services use the reviewed digest-pinned Docker Official Images from ECR Public', () => {
  const approvedImages = {
    postgres: 'public.ecr.aws/docker/library/postgres:16-alpine@sha256:721873c34ceb9f8d8fc265984940dc982404c105f19ad51be9fdc5970a6080ea',
    redis: 'public.ecr.aws/docker/library/redis:7-alpine@sha256:858f009f9709ce576febc734aa78b8f6d624b82571f9ddb6bda4377c833b3499',
  };
  const services = Object.values(jobs).flatMap(job => Object.entries(job.services ?? {}));
  assert.equal(services.filter(([name]) => name === 'postgres').length, 10);
  assert.equal(services.filter(([name]) => name === 'redis').length, 1);
  for (const [name, service] of services) {
    assert.ok(Object.hasOwn(approvedImages, name), `Unreviewed CI service: ${name}`);
    assert.equal(service.image, approvedImages[name]);
    assert.equal(service.credentials, undefined);
  }
});

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
  assert.deepEqual(jobs.test.needs, ['test-core', 'test-components', 'monitoring-node24']);
  assert.equal(jobs['full-vitest'].needs, 'full-vitest-shards');
});

test('the required aggregate includes Node 24 monitoring evidence with zero skips', () => {
  const job = jobs['monitoring-node24'];
  assert.equal(job.needs, 'secret-scan');
  assert.ok(job.steps.some(step => step.uses === 'actions/setup-node@v4' && step.with['node-version'] === '24.x'));
  const step = job.steps.find(candidate => candidate.name === 'Verify monitoring URL compatibility and privacy with zero skips');
  assert.match(step.run, /set -euo pipefail/);
  assert.match(step.run, /npm run test:monitoring:node24/);
  assert.ok(step.run.includes('grep -Fqx \'# tests 17\''));
  assert.ok(step.run.includes('grep -Fqx \'# pass 17\''));
  assert.ok(step.run.includes('grep -Fqx \'# skipped 0\''));
  assert.equal(jobs.test.steps[0].env.MONITORING_RESULT, '${{ needs.monitoring-node24.result }}');
  assert.match(jobs.test.steps[0].run, /test "\$MONITORING_RESULT" = success/);
});

test('the required Node 24 job also exercises the bundled Redis URL parser', () => {
  const step = jobs['monitoring-node24'].steps.find(candidate => candidate.name === 'Verify Redis URL compatibility with zero skips');
  assert.match(step.run, /set -euo pipefail/);
  assert.match(step.run, /node --test --test-reporter=tap scripts\/redis-node24.node-test.mjs/);
  assert.ok(step.run.includes('grep -Fqx \'# tests 18\''));
  assert.ok(step.run.includes('grep -Fqx \'# pass 18\''));
  assert.ok(step.run.includes('grep -Fqx \'# skipped 0\''));
});

test('the required Node 24 job also verifies Cloudinary request and error contracts', () => {
  const step = jobs['monitoring-node24'].steps.find(candidate => candidate.name === 'Verify Cloudinary image API compatibility with zero skips');
  assert.match(step.run, /set -euo pipefail/);
  assert.ok(step.run.includes('node --pending-deprecation --test --test-reporter=tap scripts/cloudinary-node24.node-test.mjs'));
  assert.ok(step.run.includes('grep -Fqx \'# tests 17\''));
  assert.ok(step.run.includes('grep -Fqx \'# pass 17\''));
  assert.ok(step.run.includes('grep -Fqx \'# skipped 0\''));
});

test('dependency protection accepts reviewed pairs and rejects changed or mixed manifests', () => {
  const step = jobs['test-core'].steps.find(candidate => candidate.name === 'Deposits ladder protected surfaces');
  assert.ok(step.run.includes('if ! git diff --quiet "$base" -- package.json package-lock.json; then'));
  const statement = step.run.match(/case "\$dependency_manifest_blob:\$dependency_lock_blob" in[\s\S]*?esac/)?.[0];
  assert.ok(statement);
  const reviewed = [...statement.matchAll(/([a-f0-9]{40}):([a-f0-9]{40})\) ;;/g)].map(match => [match[1], match[2]]);
  const monitoringPairs = [
    ['676faa4e87813eb9500b132e5b5034947fb607ea', '9d6a655a476d1beaea9c5f3ed3dee6a0b0012ca2'],
    ['2d308eb94fc47228b1f8cefb95e5109674a6c7b6', '16a00768b1248501e221a5af2350d2a49a27d3d4'],
    ['81033b57a45e03fa3fb84b35435d5c511c945dc6', '9c7d5702e010a55e897258fee728c517b20d0593'],
    ['2658646d2addf8fe450503e0366a1b30d3a37d16', '2b018033b1df3bbc21bfd1858b764a6fe2d14e64'],
    ['36b6eb8cc244742e3f00ca9e6371e83580bbd907', 'f30136fcafe073d34bb76a50cadeaf8d83c2a31b'],
  ];
  for (const pair of monitoringPairs) {
    assert.ok(reviewed.some(([manifest, lock]) => manifest === pair[0] && lock === pair[1]));
  }
  const run = (manifest, lock) => spawnSync('bash', ['-eu', '-c', statement], {
    env: { dependency_manifest_blob: manifest, dependency_lock_blob: lock },
  }).status;
  for (const [manifest, lock] of reviewed) {
    assert.equal(run(manifest, lock), 0);
    assert.notEqual(run('0'.repeat(40), lock), 0);
    assert.notEqual(run(manifest, '0'.repeat(40)), 0);
    for (const [, otherLock] of reviewed) {
      if (otherLock !== lock) {
        assert.notEqual(run(manifest, otherLock), 0);
      }
    }
  }
  assert.notEqual(run('0'.repeat(40), '0'.repeat(40)), 0);
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

test('commitlint checks only commits introduced beyond the current PR base branch', () => {
  const step = jobs['test-core'].steps.find(candidate => candidate.name === 'Validate commits introduced by the PR');
  assert.equal(step.if, 'github.event_name == \'pull_request\'');
  assert.equal(step.env.PR_BASE_BRANCH, '${{ github.base_ref }}');
  assert.equal(step.env.PR_HEAD_SHA, '${{ github.event.pull_request.head.sha }}');
  assert.match(step.run, /node scripts\/validate-pr-commits\.mjs/);
  assert.match(step.run, /--base-branch "\$PR_BASE_BRANCH"/);
  assert.match(step.run, /--head "\$PR_HEAD_SHA"/);
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

test('founding lifetime claims require real PostgreSQL evidence without skips', () => {
  const job = jobs['sms-credit-ledger-postgres'];
  assert.equal(job.env.CORE_LIFETIME_DISPOSABLE_DATABASE_CONFIRMED, 'true');
  const step = job.steps.find(candidate => candidate.name === 'Run billing real-PostgreSQL money suites and prove zero skips');
  assert.ok(step.run.includes('src/libs/billing/foundingLifetime.concurrency.integration.test.ts'));
  assert.ok(step.run.includes('grep -Fqx \'FOUNDING_CORE_POSTGRES_TESTS_EXECUTED=7 FOUNDING_CORE_POSTGRES_TESTS_SKIPPED=0\''));
});

test('the required component job runs onboarding tests with their package configuration', () => {
  assert.ok(jobs.test.needs.includes('test-components'));
  const step = jobs['test-components'].steps.find(candidate => candidate.name === 'Verify onboarding confirmation and booking notice');
  assert.equal(step['working-directory'], 'prototypes/site-builder-v2-booking-integration-lab');
  assert.match(step.run, /npm test -- --maxWorkers=2 --minWorkers=1/);
  assert.match(step.run, /playwright\.layout-previews\.config\.ts/);
  assert.ok(jobs['test-core'].steps.some(candidate => candidate.run?.includes('scripts/test-changed-source.node-test.mjs')));
});

test('all browser evidence runs exactly once across required independent groups', () => {
  const job = jobs['test-components'];
  assert.deepEqual(job.strategy.matrix.suite, ['onboarding-owner', 'customer-booking']);
  assert.equal(job.strategy['fail-fast'], false);
  assert.equal(job['continue-on-error'], undefined);
  assert.equal(job['timeout-minutes'], 55);
  const expected = {
    'onboarding-owner': [
      'Verify onboarding confirmation and booking notice',
      'Verify SMS components and plan access in desktop and mobile browsers',
      'Verify review previews and delivery states in mobile browsers',
      'Verify no-show correction in desktop and mobile browsers',
      'Verify review automation settings in mobile browsers',
      'Verify dark customer assistant proposal shell in mobile browsers',
      'Verify platform policy labels and navigation',
      'Verify owner destinations and Hours in mobile browsers',
      'Verify owner dashboard polish and shared dialogs in mobile browsers',
      'Verify owner forms and error recovery in mobile browsers',
      'Verify Portfolio controls and failure recovery in mobile browsers',
      'Verify owner settings and payment presentation in mobile browsers',
      'Verify Luster owner entry screens in mobile browsers',
      'Verify owner Marketing destinations in mobile browsers',
      'Verify Booking Page business information in mobile browsers',
      'Verify Booking Page experience and flow in mobile browsers',
      'Verify Settings and Plan destinations in mobile browsers',
      'Verify owner client profiles in mobile browsers',
      'Verify owner Calendar Clients and Services polish',
      'Verify SMS balances and top-up entry in desktop and mobile browsers',
      'Run storybook tests',
      'Verify onboarding desktop and phone geometry',
    ],
    'customer-booking': [
      'Verify Next Visit settings and guest rebooking in mobile browsers',
      'Verify customer review and confirmation in desktop and mobile browsers',
      'Verify approved Quick Book customer compositions',
      'Verify appointment management and checkout in mobile browsers',
    ],
  };
  const evidence = job.steps.filter(step => step.name?.startsWith('Verify ') || step.name === 'Run storybook tests');
  assert.equal(evidence.length, 26);
  assert.equal(new Set(evidence.map(step => step.name)).size, evidence.length);
  for (const [suite, names] of Object.entries(expected)) {
    const selected = evidence.filter(step => step.if === `matrix.suite == '${suite}'`);
    assert.deepEqual(selected.map(step => step.name), names);
    for (const step of selected) {
      assert.equal(typeof step.run, 'string');
      assert.equal(step['continue-on-error'], undefined);
    }
  }
  const install = job.steps.find(step => step.name === 'Install shared onboarding presentation dependencies');
  assert.equal(install.if, 'matrix.suite == \'customer-booking\'');
  assert.equal(install['working-directory'], 'prototypes/site-builder-v2-booking-integration-lab');
  assert.equal(install.run, 'npm ci');
  assert.ok(job.steps.indexOf(install) < job.steps.indexOf(evidence[0]));
  const upload = job.steps.at(-1);
  assert.equal(upload.if, 'always()');
  assert.equal(upload.with.name, 'component-test-results-${{ matrix.suite }}');
  assert.equal(upload.with.path, 'test-results/');
  assert.ok(jobs.test.needs.includes('test-components'));
  assert.equal(jobs.test.steps[0].env.COMPONENTS_RESULT, '${{ needs.test-components.result }}');
});
