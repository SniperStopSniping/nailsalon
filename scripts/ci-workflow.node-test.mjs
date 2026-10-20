/* eslint-disable no-template-curly-in-string -- GitHub expressions are literal workflow contracts. */
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
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
  assert.ok(step.run.includes('node scripts/verify-dependency-pair.mjs'));
  const registry = JSON.parse(readFileSync(new URL('./reviewed-dependency-pairs.json', import.meta.url), 'utf8'));
  const reviewed = registry.pairs.map(pair => [pair.packageJson, pair.packageLock]);
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
    ['415d1c90eb42ea7230692a3f241d6febe7e872d6', 'f0c9aa4940a835250395d2098565f07802bb950e'],
    ['2c85781c86ede9f53b02c36bd36751a0bae4e5e4', '960fa1603f11ff1a10084331ff43b95d8ea68a9e'],
    ['cf9ee4410133e7254924abfee7a7a70e0592a25b', 'c7279e61b579800514e86c260774a902c25b26b4'],
    ['fcf749d8a0e3a531756b221ed60848df2b540355', '1a0d21a18e49f9d77dcecde059cdbf20a788a621'],
    ['68378a97e8f7292264e15565a299b4b5c04e47b3', '5467895180e9024f1227adf9b47b9c42ce7c4d4c'],
    ['72714ec554388ba617898e14c78a0556f475bc65', '547a7f34a8855333a1cfbdebbdd32393b8be31c3'],
    ['95a5d51e3c9fd0bde85d21fc288077db849ef5a0', 'ac97375ebeff51fd225f1e1831243e131a5c50ef'],
  ];
  for (const pair of monitoringPairs) {
    assert.ok(reviewed.some(([manifest, lock]) => manifest === pair[0] && lock === pair[1]));
  }
  const validation = spawnSync(process.execPath, ['scripts/verify-dependency-pair.mjs'], { encoding: 'utf8' });
  assert.equal(validation.status, 0, validation.stderr);
  const tests = jobs['test-core'].steps.find(candidate => candidate.name === 'Verify release dependency registration with zero skips');
  assert.ok(tests.run.includes('scripts/dependency-pair.node-test.mjs'));
  assert.ok(tests.run.includes('scripts/release-pair-registration.node-test.mjs'));
  assert.equal(tests.if, undefined);
  assert.equal(tests['continue-on-error'], undefined);
  assert.match(tests.run, /set -euo pipefail/);
  assert.ok(tests.run.includes('grep -Fqx \'# tests 22\''));
  assert.ok(tests.run.includes('grep -Fqx \'# pass 22\''));
  assert.ok(tests.run.includes('grep -Fqx \'# skipped 0\''));
  assert.doesNotMatch(step.run, /if false/);
});

test('installed compiler helpers satisfy Next and Intl distinct requirements', () => {
  const graphCheck = jobs['test-core'].steps.find(step => step.name === 'Verify installed dependency graph');
  assert.ok(graphCheck);
  assert.match(graphCheck.run, /set -euo pipefail/);
  assert.match(graphCheck.run, /npm ls --all --json/);
  assert.match(graphCheck.run, /INSTALLED_DEPENDENCY_GRAPH_VALIDATED=1/);
  const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  const rootRequire = createRequire(new URL('../package.json', import.meta.url));
  const nextRequire = createRequire(rootRequire.resolve('next/package.json'));
  const intlRequire = createRequire(rootRequire.resolve('next-intl'));
  const compilerRequire = createRequire(intlRequire.resolve('@swc/core'));

  assert.equal(manifest.dependencies['@swc/helpers'], '0.5.23');
  assert.equal(rootRequire('@swc/helpers/package.json').version, '0.5.23');
  assert.equal(nextRequire('./package.json').dependencies['@swc/helpers'], '0.5.15');
  assert.equal(nextRequire('@swc/helpers/package.json').version, '0.5.15');
  assert.equal(compilerRequire('./package.json').peerDependencies['@swc/helpers'], '>=0.5.17');
  assert.equal(compilerRequire('@swc/helpers/package.json').version, '0.5.23');
});

test('npm CLI owner chain stays on the patched compatible 10.x bundle', () => {
  const packageJson = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  const packageLock = JSON.parse(readFileSync(new URL('../package-lock.json', import.meta.url), 'utf8'));
  const lockPackages = packageLock.packages;
  assert.equal(packageJson.devDependencies.npm, '10.9.9');

  const npm = lockPackages['node_modules/npm'];
  assert.ok(npm, 'the existing CLI owner chain must resolve npm');
  assert.equal(npm.version, '10.9.9');
  assert.ok(npm.bundleDependencies.includes('tar'));
  assert.equal(npm.dependencies.tar, '^7.5.22');

  const ownerRanges = [
    ['node_modules/@oclif/plugin-plugins', '^10.8.2'],
    ['node_modules/@semantic-release/npm', '^10.5.0'],
  ];
  for (const [path, range] of ownerRanges) {
    const owner = lockPackages[path];
    assert.ok(owner, `expected existing owner ${path}`);
    assert.equal(owner.dependencies.npm, range);
  }

  const bundledTarEntries = Object.entries(lockPackages).filter(([path, entry]) => (
    path.startsWith('node_modules/npm/') && /(?:^|\/)node_modules\/tar$/.test(path) && entry.inBundle === true
  ));
  assert.ok(bundledTarEntries.length > 0, 'inspect every tar bundled beneath npm');
  for (const [path, entry] of bundledTarEntries) {
    const match = entry.version.match(/^(\d+)\.(\d+)\.(\d+)$/);
    assert.ok(match, `${path} must resolve to a stable tar release`);
    const version = match.slice(1).map(Number);
    assert.ok(version[0] > 7 || (version[0] === 7 && (version[1] > 5 || (version[1] === 5 && version[2] >= 21))), `${path} is below the tar security floor`);
  }
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
  assert.match(step.run, /numPassedTests!==9/);
  assert.match(step.run, /numPendingTests!==0/);
});

test('deployment engine and CI build cover Node 24 while retaining compatibility lanes', () => {
  const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  const lock = JSON.parse(readFileSync(new URL('../package-lock.json', import.meta.url), 'utf8'));
  assert.equal(manifest.engines.node, '24.x');
  assert.equal(lock.packages[''].engines.node, '24.x');
  assert.deepEqual(jobs.build.strategy.matrix['node-version'], ['20.x', 22.6, '24.x']);
});

test('every PostgreSQL CI job runs on the package Node 24 engine', () => {
  const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(manifest.engines.node, '24.x');

  const postgresJobs = Object.entries(jobs).filter(([, job]) => Object.hasOwn(job.services ?? {}, 'postgres'));
  assert.equal(postgresJobs.length, 11);
  for (const [id, job] of postgresJobs) {
    const setupNode = job.steps.find(step => step.uses === 'actions/setup-node@v4');
    assert.ok(setupNode, `${id} must set up Node.js`);

    const configuredVersion = setupNode.with['node-version'];
    if (configuredVersion === '${{ matrix.node-version }}') {
      assert.deepEqual(job.strategy?.matrix?.['node-version'], ['24.x'], `${id} matrix must use Node 24 only`);
    } else {
      assert.equal(configuredVersion, manifest.engines.node, `${id} must use the package Node engine`);
    }
  }
});

test('the required Node 24 job exercises the installed patched SMS and image dependencies', () => {
  const step = jobs['monitoring-node24'].steps.find(candidate => candidate.name === 'Verify patched runtime dependencies and SMS transport with zero skips');
  assert.match(step.run, /set -euo pipefail/);
  assert.ok(step.run.includes('node --test --test-reporter=tap scripts/runtime-dependency-security.node-test.mjs'));
  assert.ok(step.run.includes('grep -Fqx \'# tests 10\''));
  assert.ok(step.run.includes('grep -Fqx \'# pass 10\''));
  assert.ok(step.run.includes('grep -Fqx \'# skipped 0\''));
});

test('the required Node 24 job exercises patched semantic-release lodash-es with zero skips', () => {
  const step = jobs['monitoring-node24'].steps.find(candidate => candidate.name === 'Verify patched semantic-release lodash-es with zero skips');
  assert.match(step.run, /set -euo pipefail/);
  assert.ok(step.run.includes('node --test --test-reporter=tap scripts/release-tooling-lodash-es.node-test.mjs'));
  assert.ok(step.run.includes('grep -Fqx \'# tests 2\''));
  assert.ok(step.run.includes('grep -Fqx \'# pass 2\''));
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
  // Vitest 4 prefixes --filesOnly rows with the project name; strip that
  // display label before passing real file paths to BaseSequencer.
  const listedFiles = execFileSync(process.execPath, [
    'node_modules/vitest/vitest.mjs',
    'list',
    '--filesOnly',
  ], { encoding: 'utf8' }).split('\n')
    .map(file => file.replace(/^\[[^\]]+\]\s*/, '').trim())
    .filter(Boolean);
  const files = listedFiles;
  assert.ok(files.length > 0);
  const sourceTestPath = /^src\/.+\.test\.(?:js|jsx|ts|tsx)$/;
  const scriptTestPath = /^scripts\/.+\.test\.(?:js|ts)$/;
  const isConfiguredTestPath = file => sourceTestPath.test(file) || scriptTestPath.test(file);
  assert.ok(files.every(isConfiguredTestPath), 'Every discovered test file must match a configured source or script test glob');
  assert.equal(new Set(files).size, files.length, 'Each test file must be assigned to exactly one project');
  assert.ok(files.some(file => file.startsWith('scripts/')), 'Script tests must be included in the shard inventory');

  // Compare discovery with Git's complete tracked inventory, not the current
  // sparse checkout's materialized files. Otherwise a sparse runner could
  // silently report a successful but incomplete shard plan.
  const configuredGlobs = readFileSync(new URL('../vitest.config.mts', import.meta.url), 'utf8');
  assert.ok(configuredGlobs.includes('\'src/**/*.test.{js,jsx,ts,tsx}\''));
  assert.ok(configuredGlobs.includes('\'scripts/**/*.test.{js,ts}\''));
  const trackedFiles = execFileSync('git', ['ls-files', '--cached', '-z'], { encoding: 'utf8' })
    .split('\0')
    .filter(file => file && isConfiguredTestPath(file))
    .sort();
  assert.deepEqual([...files].sort(), trackedFiles, 'Vitest discovery must match the complete tracked test-glob inventory');

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

test('uncovered concurrency suites run in isolated PostgreSQL jobs with exact zero-skip counts', () => {
  const lifecycle = jobs['client-lifecycle-postgres'];
  const clientDeletion = lifecycle.steps.find(step => step.name === 'Verify client deletion races on real PostgreSQL with zero skips');
  const lifecycleReset = lifecycle.steps.find(step => step.name === 'Reset the disposable database for the command gate');
  assert.ok(clientDeletion);
  assert.ok(lifecycleReset);
  assert.equal(lifecycle.env.CLIENT_LIFECYCLE_DISPOSABLE_DATABASE_CONFIRMED, 'true');
  assert.ok(clientDeletion.run.includes('src/libs/clientDeletion.integration.test.ts'));
  assert.ok(clientDeletion.run.includes('numTotalTests !== 11'));
  assert.ok(clientDeletion.run.includes('numPendingTests !== 0'));
  assert.ok(clientDeletion.run.includes('CLIENT_DELETION_POSTGRES_TESTS_EXECUTED=3 CLIENT_DELETION_POSTGRES_TESTS_SKIPPED=0'));
  assert.ok(lifecycle.steps.indexOf(clientDeletion) < lifecycle.steps.indexOf(lifecycleReset));

  const deposits = jobs['deposits-postgres-concurrency'];
  const portfolio = deposits.steps.find(step => step.name === 'Verify portfolio upload slot races on real PostgreSQL with zero skips');
  const outboxScope = deposits.steps.find(step => step.name === 'Verify scope-clean outbox mutants on real PostgreSQL with zero skips');
  const nextVisit = deposits.steps.find(step => step.name === 'Verify Next Visit offer races on real PostgreSQL with zero skips');
  assert.ok(portfolio);
  assert.ok(outboxScope);
  assert.ok(nextVisit);
  assert.equal(portfolio.env.PORTFOLIO_LIMIT_DISPOSABLE_DATABASE_CONFIRMED, 'true');
  assert.equal(outboxScope.env.D5_CONCURRENCY_REQUIRED, 'true');
  assert.ok(outboxScope.env.LUSTER_DISPOSABLE_POSTGRES_CONTAINER_ID);
  assert.ok(outboxScope.env.LUSTER_DISPOSABLE_POSTGRES_NETWORK);
  assert.equal(nextVisit.env.NEXT_VISIT_DISPOSABLE_DATABASE_CONFIRMED, 'true');
  assert.ok(portfolio.run.includes('src/libs/portfolioMedia.concurrency.integration.test.ts'));
  assert.ok(portfolio.run.includes('numTotalTests !== 4'));
  assert.ok(portfolio.run.includes('PORTFOLIO_MEDIA_POSTGRES_TESTS_EXECUTED=4 PORTFOLIO_MEDIA_POSTGRES_TESTS_SKIPPED=0'));
  assert.ok(outboxScope.run.includes('src/libs/integrationOutbox.scopeCleanMutants.postgres.integration.test.ts'));
  assert.ok(outboxScope.run.includes('numTotalTests !== 2'));
  assert.ok(outboxScope.run.includes('OUTBOX_SCOPE_CLEAN_POSTGRES_TESTS_EXECUTED=2 OUTBOX_SCOPE_CLEAN_POSTGRES_TESTS_SKIPPED=0'));
  assert.ok(nextVisit.run.includes('src/libs/nextVisitOffer.concurrency.integration.test.ts'));
  assert.ok(nextVisit.run.includes('export NEXT_VISIT_TEST_DATABASE_URL="$CONCURRENCY_TEST_DATABASE_URL"'));
  assert.ok(nextVisit.run.includes('numTotalTests !== 4'));
  assert.ok(nextVisit.run.includes('NEXT_VISIT_POSTGRES_TESTS_EXECUTED=4 NEXT_VISIT_POSTGRES_TESTS_SKIPPED=0'));
  assert.equal(deposits.steps.indexOf(portfolio) + 1, deposits.steps.indexOf(outboxScope));
  assert.equal(deposits.steps.indexOf(outboxScope) + 1, deposits.steps.indexOf(nextVisit));
  assert.equal(deposits.steps.at(-1), nextVisit);
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
      'Verify HTTPS custom-site workers and opaque-origin isolation',
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
      'Verify deletion recovery and keyboard review in desktop and mobile browsers',
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
  const renderer = evidence.find(step => step.name === 'Verify HTTPS custom-site workers and opaque-origin isolation');
  assert.equal(renderer['timeout-minutes'], 3);
  assert.equal(renderer.run, 'node node_modules/@playwright/test/cli.js test --config tests/browser/rendererIsolationHttps/playwright.config.ts --output=test-results/renderer-https-isolation');
  assert.equal(renderer.env, undefined);
  const deletion = evidence.find(step => step.name === 'Verify deletion recovery and keyboard review in desktop and mobile browsers');
  assert.equal(deletion['timeout-minutes'], 5);
  assert.equal(deletion.run, 'node node_modules/@playwright/test/cli.js test --config tests/browser/salonDeletion/playwright.config.ts --output=test-results/salon-deletion-review');
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

test('the required Node 24 monitoring job runs Checkly Axios compatibility without bypasses', () => {
  const job = jobs['monitoring-node24'];
  const step = job.steps.find(candidate => candidate.name === 'Verify Checkly Axios request compatibility with zero skips');
  assert.ok(step);
  assert.equal(step.if, undefined);
  assert.equal(step['continue-on-error'], undefined);
  assert.match(step.run, /set -euo pipefail/);
  assert.match(step.run, /npm run test:checkly-axios:node24/);
  assert.ok(step.run.includes('grep -Fqx \'# tests 1\' checkly-axios-node24.log'));
  assert.ok(step.run.includes('grep -Fqx \'# pass 1\' checkly-axios-node24.log'));
  assert.ok(step.run.includes('grep -Fqx \'# skipped 0\' checkly-axios-node24.log'));
  assert.doesNotMatch(step.run, /\|\|\s*(true|:)/);
});

test('trusted-main Percy coverage requires a verified Playwright executable and a no-provider Core override contract', () => {
  const job = jobs['test-core'];
  const browserContract = job.steps.find(candidate => candidate.name === 'Verify Percy discovery browser override without provider traffic');
  assert.ok(browserContract);
  assert.match(browserContract.run, /set -euo pipefail/);
  assert.match(browserContract.run, /node --test --test-reporter=tap scripts\/percy-browser-override\.node-test\.mjs/);
  assert.match(browserContract.run, /# tests 3/);
  assert.match(browserContract.run, /# pass 3/);
  assert.match(browserContract.run, /# skipped 0/);

  const coverage = job.steps.find(candidate => candidate.name === 'Run E2E with trusted-main Percy coverage');
  assert.ok(coverage);
  assert.match(coverage.run, /set -euo pipefail/);
  assert.match(coverage.run, /PERCY_BROWSER_EXECUTABLE=.*playwright.*chromium\.executablePath/);
  assert.match(coverage.run, /export PERCY_BROWSER_EXECUTABLE/);
  assert.match(coverage.run, /test -n "\$PERCY_BROWSER_EXECUTABLE"/);
  assert.match(coverage.run, /test -f "\$PERCY_BROWSER_EXECUTABLE"/);
  assert.match(coverage.run, /test -x "\$PERCY_BROWSER_EXECUTABLE"/);
  assert.ok(coverage.run.indexOf('test -x "$PERCY_BROWSER_EXECUTABLE"') < coverage.run.indexOf('npx percy exec'));
});

test('trusted-main Percy coverage fails closed before npx when Playwright Chromium is missing or not executable', () => {
  const coverage = jobs['test-core'].steps.find(candidate => candidate.name === 'Run E2E with trusted-main Percy coverage');
  const fixture = mkdtempSync(path.join(tmpdir(), 'percy-ci-preflight-'));
  const bin = path.join(fixture, 'bin');
  const marker = path.join(fixture, 'npx-ran');
  const executable = path.join(fixture, 'chromium');
  mkdirSync(bin);
  writeFileSync(path.join(bin, 'node'), '#!/bin/sh\nif [ "${PERCY_CI_TEST_NODE_EXIT:-0}" -ne 0 ]; then exit 19; fi\nprintf %s "${PERCY_CI_TEST_EXECUTABLE:-}"\n');
  writeFileSync(path.join(bin, 'npx'), '#!/bin/sh\nprintf reached > "$PERCY_CI_TEST_NPX_MARKER"\n');
  chmodSync(path.join(bin, 'node'), 0o755);
  chmodSync(path.join(bin, 'npx'), 0o755);

  const run = (executablePath, nodeExit = 0) => {
    const result = spawnSync('/bin/bash', ['-eu', '-o', 'pipefail', '-c', coverage.run], {
      encoding: 'utf8',
      env: {
        PATH: bin,
        PERCY_CI_TEST_EXECUTABLE: executablePath,
        PERCY_CI_TEST_NODE_EXIT: String(nodeExit),
        PERCY_CI_TEST_NPX_MARKER: marker,
        PERCY_TOKEN: 'synthetic-test-token',
      },
    });
    const npxReached = (() => {
      try {
        return readFileSync(marker, 'utf8') === 'reached';
      } catch {
        return false;
      }
    })();
    rmSync(marker, { force: true });
    return { result, npxReached };
  };

  try {
    const missing = run('');
    assert.notEqual(missing.result.status, 0);
    assert.equal(missing.npxReached, false);

    const absent = run(path.join(fixture, 'missing-browser'));
    assert.notEqual(absent.result.status, 0);
    assert.equal(absent.npxReached, false);

    writeFileSync(executable, '#!/bin/sh\nexit 0\n');
    chmodSync(executable, 0o644);
    const nonExecutable = run(executable);
    assert.notEqual(nonExecutable.result.status, 0);
    assert.equal(nonExecutable.npxReached, false);

    const directory = run(bin);
    assert.notEqual(directory.result.status, 0);
    assert.equal(directory.npxReached, false);

    chmodSync(executable, 0o755);
    const resolverFailure = run(executable, 19);
    assert.notEqual(resolverFailure.result.status, 0);
    assert.equal(resolverFailure.npxReached, false);
    const valid = run(executable);
    assert.equal(valid.result.status, 0, valid.result.stderr);
    assert.equal(valid.npxReached, true);
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});

test('the required Node 24 job exercises the patched release-tooling dependency contracts', () => {
  const step = jobs['monitoring-node24'].steps.find(candidate => candidate.name === 'Verify patched release tooling dependencies with zero skips');
  assert.match(step.run, /set -euo pipefail/);
  assert.ok(step.run.includes('node --test --test-reporter=tap scripts/tooling-dependency-security.node-test.mjs'));
  assert.ok(step.run.includes('grep -Fqx \'# tests 3\''));
  assert.ok(step.run.includes('grep -Fqx \'# pass 3\''));
  assert.ok(step.run.includes('grep -Fqx \'# skipped 0\''));
});

test('the required Node 24 job verifies scoped release-plugin Lodash without skips', () => {
  const step = jobs['monitoring-node24'].steps.find(candidate => candidate.name === 'Verify scoped release-plugin Lodash with zero skips');
  assert.ok(step);
  assert.equal(step.if, undefined);
  assert.equal(step['continue-on-error'], undefined);
  assert.match(step.run, /set -euo pipefail/);
  assert.ok(step.run.includes('scripts/release-tooling-lodash.node-test.mjs'));
  assert.ok(step.run.includes('grep -Fqx \'# tests 2\''));
  assert.ok(step.run.includes('grep -Fqx \'# pass 2\''));
  assert.ok(step.run.includes('grep -Fqx \'# skipped 0\''));
});
