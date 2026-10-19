/* eslint-disable no-template-curly-in-string -- GitHub expressions are literal workflow contracts. */
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { BaseSequencer } from 'vitest/node';
import { parse } from 'yaml';

const workflow = parse(readFileSync(new URL('../.github/workflows/CI.yml', import.meta.url), 'utf8'));
const { jobs } = workflow;

test('AI setup publication races require an attested database and all thirteen cases', () => {
  const step = jobs['test-core'].steps.find(step => step.name === 'Verify AI setup publication concurrency on disposable PostgreSQL');
  assert.equal(step.env.AI_SETUP_PUBLICATION_CONCURRENCY_REQUIRED, 'true');
  assert.match(step.env.CONCURRENCY_TEST_DATABASE_URL, /@127\.0\.0\.1:55432\/luster_e2e_ci_disposable\?application_name=luster-e2e-ci-disposable$/);
  assert.match(step.run, /publication\.concurrency\.integration\.test\.ts/);
  assert.match(step.run, /numPassedTests!==13/);
  assert.match(step.run, /numTotalTests!==13/);
  assert.match(step.run, /numPendingTests!==0/);
});

test('AI new-owner enrollment races require an attested database and zero skipped cases', () => {
  const step = jobs['test-core'].steps.find(step => step.name === 'Verify AI owner entry concurrency on disposable PostgreSQL');
  assert.equal(step.env.AI_ENTRY_CONCURRENCY_REQUIRED, 'true');
  assert.match(step.env.CONCURRENCY_TEST_DATABASE_URL, /@127\.0\.0\.1:55432\/luster_e2e_ci_disposable\?application_name=luster-e2e-ci-disposable$/);
  assert.match(step.run, /entry\.concurrency\.integration\.test\.ts/);
  assert.match(step.run, /numPassedTests!==2/);
  assert.match(step.run, /numPendingTests!==0/);
});

test('Calendar PostgreSQL regressions are required and cannot silently skip', () => {
  const deposits = jobs['deposits-postgres-concurrency'];
  const calendar = deposits.steps.find(step => step.name === 'Run D5 Calendar claim and revert races and prove zero skips');
  assert.ok(calendar, 'D5 Calendar must execute separately from the six deposit cases');
  assert.equal(deposits.env.D5_CONCURRENCY_REQUIRED, 'true');
  assert.match(calendar.run, /set -euo pipefail/);
  assert.ok(calendar.run.includes('src/libs/deposits/deposits.d5Calendar.concurrency.integration.test.ts'));
  assert.ok(calendar.run.includes('D5_REAL_POSTGRES_TESTS_EXECUTED=3 D5_REAL_POSTGRES_TESTS_SKIPPED=0'));
  assert.equal(calendar.env.LUSTER_DISPOSABLE_POSTGRES_CONTAINER_ID, '${{ job.services.postgres.id }}');
  const outbox = jobs['google-outbox-postgres'];
  assert.equal(outbox.needs, 'secret-scan');
  assert.equal(outbox.env.GOOGLE_OUTBOX_PG_REQUIRED, 'true');
  assert.equal(outbox.env.LUSTER_DISPOSABLE_DATABASE, 'true');
  assert.equal(outbox.services.postgres.env.POSTGRES_DB, 'luster_e2e_ci_disposable');
  assert.equal(outbox.services.postgres.env.POSTGRES_USER, 'luster_e2e_ci');
  assert.deepEqual(outbox.services.postgres.ports, ['127.0.0.1:55432:5432']);
  assert.match(outbox.env.CONCURRENCY_TEST_DATABASE_URL, /@127\.0\.0\.1:55432\/luster_e2e_ci_disposable\?application_name=luster-e2e-ci-disposable$/);
  const execute = outbox.steps.find(step => step.name === 'Require Calendar outbox parent and independent child coverage');
  assert.equal(execute.env.LUSTER_DISPOSABLE_POSTGRES_CONTAINER_ID, '${{ job.services.postgres.id }}');
  assert.equal(execute.env.LUSTER_DISPOSABLE_POSTGRES_NETWORK, '${{ job.services.postgres.network }}');
  assert.match(execute.run, /set -euo pipefail/);
  assert.ok(execute.run.includes('src/libs/integrationOutbox.postgres.integration.test.ts'));
  assert.ok(execute.run.includes('GOOGLE_OUTBOX_PARENT_POSTGRES_TESTS_EXECUTED=7'));
  assert.ok(execute.run.includes('GOOGLE_OUTBOX_CHILD_POSTGRES_TESTS_EXECUTED=1'));
  assert.equal(outbox.steps.find(step => step.uses === 'actions/checkout@v4').with.ref, '${{ github.event.pull_request.head.sha || github.sha }}');
  assert.equal(jobs.test.steps[0].env.DEPOSITS_POSTGRES_RESULT, '${{ needs.deposits-postgres-concurrency.result }}');
  assert.equal(jobs.test.steps[0].env.GOOGLE_OUTBOX_RESULT, '${{ needs.google-outbox-postgres.result }}');
});

test('CI services use the reviewed digest-pinned Docker Official Images from the Google cache', () => {
  const approvedImages = {
    postgres: 'mirror.gcr.io/library/postgres:16-alpine@sha256:721873c34ceb9f8d8fc265984940dc982404c105f19ad51be9fdc5970a6080ea',
    redis: 'mirror.gcr.io/library/redis:7-alpine@sha256:858f009f9709ce576febc734aa78b8f6d624b82571f9ddb6bda4377c833b3499',
  };
  const services = Object.values(jobs).flatMap(job => Object.entries(job.services ?? {}));
  assert.equal(services.filter(([name]) => name === 'postgres').length, 11);
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
  assert.deepEqual(jobs.test.needs, ['test-core', 'test-components', 'monitoring-node24', 'deposits-postgres-concurrency', 'google-outbox-postgres']);
  assert.equal(jobs['full-vitest'].needs, 'full-vitest-shards');
});

test('the required aggregate includes Node 24 monitoring evidence with zero skips', () => {
  const job = jobs['monitoring-node24'];
  assert.equal(job.needs, 'secret-scan');
  assert.ok(job.steps.some(step => step.uses === 'actions/setup-node@v4' && step.with['node-version'] === '24.x'));
  const step = job.steps.find(candidate => candidate.name === 'Verify monitoring URL compatibility and privacy with zero skips');
  assert.match(step.run, /set -euo pipefail/);
  assert.match(step.run, /npm run test:monitoring:node24/);
  assert.ok(step.run.includes('grep -Fqx \'# tests 18\''));
  assert.ok(step.run.includes('grep -Fqx \'# pass 18\''));
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

test('the required Node 24 aggregate verifies application timezone rules with zero skips', () => {
  const job = jobs['monitoring-node24'];
  const step = job.steps.find(candidate => candidate.name === 'Verify timezone rules and booking conversion on Node 24');
  assert.equal(job.steps.some(candidate => candidate.uses === 'actions/setup-node@v4' && candidate.with['node-version'] === '24.x'), true);
  assert.match(step.run, /node --test --test-reporter=tap scripts\/timezone-node24\.node-test\.mjs/);
  assert.ok(step.run.includes('grep -Fqx \'# tests 1\''));
  assert.ok(step.run.includes('grep -Fqx \'# pass 1\''));
  assert.ok(step.run.includes('grep -Fqx \'# skipped 0\''));
  assert.ok(jobs.test.needs.includes('monitoring-node24'));
  assert.equal(jobs.test.steps[0].env.MONITORING_RESULT, '${{ needs.monitoring-node24.result }}');
});

test('dependency protection accepts reviewed pairs and rejects changed or mixed manifests', () => {
  const step = jobs['test-core'].steps.find(candidate => candidate.name === 'Deposits ladder protected surfaces');
  assert.ok(step.run.includes('if ! git diff --quiet "$base" -- package.json package-lock.json; then'));
  const statement = step.run.match(/case "\$dependency_manifest_blob:\$dependency_lock_blob" in[\s\S]*?esac/)?.[0];
  assert.ok(statement);
  const reviewed = [...statement.matchAll(/([a-f0-9]{40}):([a-f0-9]{40})\) ;;/g)].map(match => [match[1], match[2]]);
  const monitoringPairs = [
    ['e8611651650ec97880c8a67e05b795a26efaa6cb', '8f5742e82fcd36ec2185235d4bfa08bd383a7966'],
    ['b7e4591c8df9d94b82b281587cec8f98b0f5439e', '9576667ec691e6f5aba41486cfbbcf8e32d6b3ee'],
    ['f5212c5c05d6cf9a89a3e63c2643f03bbf223d75', '3500380b6019dbab17b1c137064ee1c1e3963eda'],
    ['ea2893563cf943de48bbd6ba91881946fe4c9f98', 'da93db3e2a143e0b8694b3231265f4e8b8885d5a'],
    ['5f3f0c31d902dd4ff5494d02d536de4cf04784ad', 'ac14f583f5e9bde0910231da97b64d28e24b252b'],
    ['676faa4e87813eb9500b132e5b5034947fb607ea', '9d6a655a476d1beaea9c5f3ed3dee6a0b0012ca2'],
    ['2d308eb94fc47228b1f8cefb95e5109674a6c7b6', '16a00768b1248501e221a5af2350d2a49a27d3d4'],
    ['81033b57a45e03fa3fb84b35435d5c511c945dc6', '9c7d5702e010a55e897258fee728c517b20d0593'],
    ['2658646d2addf8fe450503e0366a1b30d3a37d16', '2b018033b1df3bbc21bfd1858b764a6fe2d14e64'],
    ['36b6eb8cc244742e3f00ca9e6371e83580bbd907', 'f30136fcafe073d34bb76a50cadeaf8d83c2a31b'],
    ['7a219ff506106dca631528df8bf7877ca28c4b71', '03917548fdcf78991dfd60a487783cfbdefa5ab0'],
    ['021dfc548a7955ac279af6576c880b87ff36d87a', '99e31ce606948ad4d522d0f3da2ec9d372b0db7d'],
    ['30c0c10fc47f7d1d372c39f8f46cdb31ae128d8b', '8e1b8a6010053efb7bd0fb883f4674537829cdd0'],
    ['8c510528ccff7fa01b70bb29cb42dd6a32452ac2', 'f9473055446d79e1ccce710cd0924b3a677c5844'],
    ['415d1c90eb42ea7230692a3f241d6febe7e872d6', 'c7bb0015690ce967afed8f1776d28ced92d5f116'],
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

test('AI migration pins accept the new packet and reject changed or already-shipped SQL', () => {
  const run = jobs['test-core'].steps.find(step => step.name === 'Deposits ladder protected surfaces').run;
  const packet = run.match(/while read -r file expected_blob; do[\s\S]*?\nAI_SETUP_MIGRATIONS/)[0];
  const files = [...packet.matchAll(/^(migrations\/\d{4}_[a-z0-9_]+\.sql) [a-f0-9]{40}$/gm)].map(match => match[1]);
  assert.equal(files.length, 15);
  assert.ok(files.includes('migrations/0110_setup_add_on_publication.sql'));
  assert.ok(files.includes('migrations/0111_other_service_categories.sql'));
  assert.ok(files.includes('migrations/0112_ai_operator_expense_budget.sql'));
  const directory = mkdtempSync(path.join(tmpdir(), 'ai-migration-gate-'));
  const git = (...args) => execFileSync('git', args, { cwd: directory, stdio: 'pipe' }).toString().trim();
  const check = () => spawnSync('bash', ['-eu', '-c', `base="$(git rev-parse HEAD)"\n${packet}`], { cwd: directory }).status;
  try {
    git('init', '-q');
    git('-c', 'user.name=Synthetic Test', '-c', 'user.email=test@example.invalid', 'commit', '--allow-empty', '-qm', 'test base');
    mkdirSync(path.join(directory, 'migrations'));
    for (const file of files) {
      writeFileSync(path.join(directory, file), readFileSync(new URL(`../${file}`, import.meta.url)));
    }
    git('add', 'migrations');
    assert.equal(check(), 0);
    for (const file of files) {
      const current = path.join(directory, file);
      const source = readFileSync(current);
      writeFileSync(current, `${source}\n-- unapproved change\n`);
      assert.notEqual(check(), 0);
      writeFileSync(current, source);
    }
    git('-c', 'user.name=Synthetic Test', '-c', 'user.email=test@example.invalid', 'commit', '-qm', 'synthetic shipped packet');
    const first = path.join(directory, files[0]);
    const source = readFileSync(first);
    writeFileSync(first, `${source}\n-- rewrite shipped SQL\n`);
    assert.notEqual(check(), 0);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('prepaid AI wallet races are required on the existing isolated PostgreSQL service', () => {
  const job = jobs['test-core'];
  const step = job.steps.find(candidate => candidate.name === 'Verify prepaid AI wallet concurrency on disposable PostgreSQL');
  assert.equal(job.env.LUSTER_DISPOSABLE_DATABASE, 'true');
  assert.equal(step.env.AI_CREDIT_CONCURRENCY_REQUIRED, 'true');
  assert.equal(step.env.LUSTER_DISPOSABLE_POSTGRES_CONTAINER_ID, '${{ job.services.postgres.id }}');
  assert.equal(step.env.LUSTER_DISPOSABLE_POSTGRES_NETWORK, '${{ job.services.postgres.network }}');
  assert.match(step.env.CONCURRENCY_TEST_DATABASE_URL, /@127\.0\.0\.1:55432\/luster_e2e_ci_disposable\?application_name=luster-e2e-ci-disposable$/);
  assert.match(step.run, /set -euo pipefail/);
  assert.match(step.run, /wallet\.concurrency\.integration\.test\.ts/);
  assert.match(step.run, /numPassedTests!==8/);
  assert.match(step.run, /numPendingTests!==0/);
});

test('deployment engine and CI build cover Node 24 while retaining compatibility lanes', () => {
  const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  const lock = JSON.parse(readFileSync(new URL('../package-lock.json', import.meta.url), 'utf8'));
  assert.equal(manifest.engines.node, '24.x');
  assert.equal(lock.packages[''].engines.node, '24.x');
  assert.deepEqual(jobs.build.strategy.matrix['node-version'], ['20.x', 22.6, '24.x']);
});

test('the required Node 24 job exercises the installed patched SMS and image dependencies', () => {
  const step = jobs['monitoring-node24'].steps.find(candidate => candidate.name === 'Verify patched runtime dependencies and SMS transport with zero skips');
  assert.match(step.run, /set -euo pipefail/);
  assert.ok(step.run.includes('node --test --test-reporter=tap scripts/runtime-dependency-security.node-test.mjs'));
  assert.ok(step.run.includes('grep -Fqx \'# tests 10\''));
  assert.ok(step.run.includes('grep -Fqx \'# pass 10\''));
  assert.ok(step.run.includes('grep -Fqx \'# skipped 0\''));
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
  assert.deepEqual(job.strategy.matrix.suite, ['onboarding-owner', 'owner-operations', 'customer-booking']);
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
      'Verify owner assistant reload recovery and account isolation',
      'Verify AI credit purchase interface and recovery in mobile browsers',
      'Verify platform policy labels and navigation',
      'Verify owner destinations and Hours in mobile browsers',
      'Verify owner dashboard polish and shared dialogs in mobile browsers',
      'Verify dashboard loading, recovery and salon context in mobile browsers',
      'Verify onboarding desktop and phone geometry',
      'Verify manual Your Design upload and clickable links',
    ],
    'owner-operations': [
      'Verify owner forms and error recovery in mobile browsers',
      'Verify Portfolio controls and failure recovery in mobile browsers',
      'Verify owner settings and payment presentation in mobile browsers',
      'Verify Luster owner entry screens in mobile browsers',
      'Verify simple website publishing in mobile and desktop browsers',
      'Verify owner account recovery in mobile browsers',
      'Verify direct founding offer in mobile browsers',
      'Verify owner Marketing destinations in mobile browsers',
      'Verify Booking Page business information in mobile browsers',
      'Verify Booking Page experience and flow in mobile browsers',
      'Verify Settings and Plan destinations in mobile browsers',
      'Verify owner client profiles in mobile browsers',
      'Verify owner Calendar Clients and Services polish',
      'Verify SMS balances and top-up entry in desktop and mobile browsers',
      'Run storybook tests',
    ],
    'customer-booking': [
      'Verify Next Visit settings and guest rebooking in mobile browsers',
      'Verify customer review and confirmation in desktop and mobile browsers',
      'Verify approved Quick Book customer compositions',
      'Verify customer booking access and private management screens',
      'Verify appointment management and checkout in mobile browsers',
    ],
  };
  const evidence = job.steps.filter(step => step.name?.startsWith('Verify ') || step.name === 'Run storybook tests');
  assert.equal(evidence.length, Object.values(expected).flat().length);
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
  assert.equal(install.if, 'matrix.suite != \'onboarding-owner\'');
  assert.equal(install['working-directory'], 'prototypes/site-builder-v2-booking-integration-lab');
  assert.equal(install.run, 'npm ci');
  assert.ok(job.steps.indexOf(install) < job.steps.indexOf(evidence[0]));
  const upload = job.steps.at(-1);
  assert.equal(upload.if, 'always()');
  assert.equal(upload.with.name, 'component-test-results-${{ matrix.suite }}');
  assert.equal(upload.with.path, 'test-results/');
  const ownerRecovery = evidence.find(step => step.name === 'Verify owner assistant reload recovery and account isolation');
  assert.equal(ownerRecovery.run, 'node node_modules/playwright/cli.js test --config tests/browser/ownerAssistant/playwright.config.ts --output=test-results/owner-assistant-components');
  const dashboardStartup = evidence.find(step => step.name === 'Verify dashboard loading, recovery and salon context in mobile browsers');
  assert.equal(dashboardStartup.run, 'node node_modules/playwright/cli.js test --config tests/browser/dashboardStartup/playwright.config.ts --output=test-results/dashboard-startup-components');
  assert.ok(jobs.test.needs.includes('test-components'));
  assert.equal(jobs.test.steps[0].env.COMPONENTS_RESULT, '${{ needs.test-components.result }}');
});
