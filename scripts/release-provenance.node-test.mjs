import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  EXPECTED_REPOSITORY,
  EXPECTED_WORKFLOW_ID,
  EXPECTED_WORKFLOW_NAME,
  EXPECTED_WORKFLOW_PATH,
  fetchLatestMainSha,
  fetchWorkflowRun,
  ProvenanceError,
  validateCheckout,
  validateEventCheckout,
} from './release-provenance.mjs';

function git(cwd, ...args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function makeHistory() {
  const cwd = mkdtempSync(path.join(os.tmpdir(), 'release-provenance-'));
  git(cwd, 'init', '--quiet', '--initial-branch=main');
  git(cwd, 'config', 'user.name', 'Local Test');
  git(cwd, 'config', 'user.email', 'local-test@example.invalid');
  writeFileSync(path.join(cwd, 'fixture.txt'), 'first\n');
  git(cwd, 'add', 'fixture.txt');
  git(cwd, 'commit', '--quiet', '-m', 'first');
  const first = git(cwd, 'rev-parse', 'HEAD');
  git(cwd, 'update-ref', 'refs/remotes/origin/main', first);
  return { cwd, first, dispose: () => rmSync(cwd, { recursive: true, force: true }) };
}

function metadata(overrides = {}) {
  return {
    repository: EXPECTED_REPOSITORY,
    runRepository: EXPECTED_REPOSITORY,
    headRepository: EXPECTED_REPOSITORY,
    conclusion: 'success',
    event: 'push',
    headBranch: 'main',
    headSha: '0'.repeat(40),
    workflowName: EXPECTED_WORKFLOW_NAME,
    workflowPath: EXPECTED_WORKFLOW_PATH,
    workflowId: EXPECTED_WORKFLOW_ID,
    ...overrides,
  };
}

function expectRejected(callback, code) {
  assert.throws(callback, error => error instanceof ProvenanceError && error.code === code);
}

test('accepts the exact successful push SHA when it is still latest main', (t) => {
  const repo = makeHistory();
  t.after(repo.dispose);
  const actual = git(repo.cwd, 'rev-parse', 'HEAD');
  assert.equal(validateCheckout(metadata({ headSha: repo.first }), actual, repo.first), repo.first);
});

test('accepts the exact main checkout before install without relying on webhook path', (t) => {
  const repo = makeHistory();
  t.after(repo.dispose);
  const run = metadata({ headSha: repo.first });
  assert.equal(validateEventCheckout(run, repo.first, repo.first), repo.first);
  expectRejected(() => validateEventCheckout(run, repo.first, '1'.repeat(40)), 'stale_main_sha');
});

test('rejects a successful but stale main SHA', (t) => {
  const repo = makeHistory();
  t.after(repo.dispose);
  writeFileSync(path.join(repo.cwd, 'fixture.txt'), 'second\n');
  git(repo.cwd, 'commit', '--quiet', '-am', 'second');
  const latest = git(repo.cwd, 'rev-parse', 'HEAD');
  git(repo.cwd, 'update-ref', 'refs/remotes/origin/main', latest);
  git(repo.cwd, 'checkout', '--quiet', '--detach', repo.first);
  expectRejected(() => validateCheckout(metadata({ headSha: repo.first }), repo.first, latest), 'stale_main_sha');
});

test('rejects an off-main branch', () => {
  expectRejected(() => validateCheckout(metadata({ headBranch: 'release/1.x' }), '0'.repeat(40), '0'.repeat(40)), 'upstream_not_main_push');
});

test('rejects a checked-out ref that differs from the CI head SHA', () => {
  expectRejected(() => validateCheckout(metadata({ headSha: '1'.repeat(40) }), '2'.repeat(40), '1'.repeat(40)), 'checkout_sha_mismatch');
});

test('rejects a malformed upstream SHA', () => {
  expectRejected(() => validateCheckout(metadata({ headSha: 'main' }), '0'.repeat(40), '0'.repeat(40)), 'malformed_upstream_sha');
});

test('rejects pull_request-origin CI', () => {
  expectRejected(() => validateCheckout(metadata({ event: 'pull_request' }), '0'.repeat(40), '0'.repeat(40)), 'upstream_not_main_push');
});

test('rejects fork or mismatched repository identities', () => {
  expectRejected(() => validateCheckout(metadata({ headRepository: 'contributor/nailsalon' }), '0'.repeat(40), '0'.repeat(40)), 'repository_mismatch');
  expectRejected(() => validateCheckout(metadata({ repository: 'someone/nailsalon' }), '0'.repeat(40), '0'.repeat(40)), 'wrong_repository');
});

test('rejects the wrong workflow name or path', () => {
  expectRejected(() => validateCheckout(metadata({ workflowName: 'Release' }), '0'.repeat(40), '0'.repeat(40)), 'wrong_workflow');
  expectRejected(() => validateCheckout(metadata({ workflowPath: '.github/workflows/other.yml@main' }), '0'.repeat(40), '0'.repeat(40)), 'wrong_workflow');
  expectRejected(() => validateCheckout(metadata({ workflowId: EXPECTED_WORKFLOW_ID + 1 }), '0'.repeat(40), '0'.repeat(40)), 'wrong_workflow');
});

test('rejects an unsuccessful CI run', () => {
  expectRejected(() => validateCheckout(metadata({ conclusion: 'failure' }), '0'.repeat(40), '0'.repeat(40)), 'upstream_not_successful');
});

test('latest-main API request is fixed to this repository and does not follow redirects', async () => {
  let call;
  const sha = 'a'.repeat(40);
  const result = await fetchLatestMainSha('synthetic-token', async (...args) => {
    call = args;
    return { ok: true, json: async () => ({ sha }) };
  });
  assert.equal(result, sha);
  assert.equal(call[0], `https://api.github.com/repos/${EXPECTED_REPOSITORY}/commits/main`);
  assert.equal(call[1].redirect, 'error');
  assert.equal(call[1].headers.Authorization, 'Bearer synthetic-token');
});

test('latest-main API rejects invalid responses without exposing response details', async () => {
  await assert.rejects(() => fetchLatestMainSha('synthetic-token', async () => ({ ok: true, json: async () => ({ sha: 'not-a-sha', private: 'fixture-secret' }) })), error => error instanceof ProvenanceError && error.code === 'latest_main_response_invalid');
  await assert.rejects(() => fetchLatestMainSha('synthetic-token', async () => ({ ok: false, json: async () => ({}) })), error => error instanceof ProvenanceError && error.code === 'latest_main_request_failed');
});

test('completed-run REST verification uses the fixed run endpoint and canonical workflow path', async () => {
  let call;
  const runId = '39060338539';
  const sha = 'd'.repeat(40);
  const run = await fetchWorkflowRun('synthetic-token', runId, async (...args) => {
    call = args;
    return {
      ok: true,
      json: async () => ({
        id: Number(runId),
        name: 'CI',
        path: '.github/workflows/CI.yml',
        workflow_id: EXPECTED_WORKFLOW_ID,
        event: 'push',
        head_branch: 'main',
        head_sha: sha,
        conclusion: 'success',
        repository: { full_name: EXPECTED_REPOSITORY },
        head_repository: { full_name: EXPECTED_REPOSITORY },
      }),
    };
  });
  assert.equal(call[0], `https://api.github.com/repos/${EXPECTED_REPOSITORY}/actions/runs/${runId}`);
  assert.equal(call[1].redirect, 'error');
  assert.equal(run.workflowPath, EXPECTED_WORKFLOW_PATH);
  assert.equal(run.workflowId, EXPECTED_WORKFLOW_ID);
  assert.equal(validateCheckout(run, sha, sha), sha);
});

test('release workflow gates checkout and installs before exposing the deploy key', () => {
  const workflow = readFileSync(new URL('../.github/workflows/release.yml', import.meta.url), 'utf8');
  const eventGate = workflow.indexOf('github.event.workflow_run.workflow_id == 212119716');
  const checkoutCheck = workflow.indexOf('node scripts/release-provenance.mjs --verify-checkout');
  const testGuard = workflow.indexOf('node --test scripts/release-provenance.node-test.mjs');
  const install = workflow.indexOf('HUSKY=0 npm ci');
  const latestCheck = workflow.indexOf('node scripts/release-provenance.mjs --verify-latest-main');
  const keyStep = workflow.indexOf(`SEMANTIC_RELEASE_DEPLOY_KEY: ${String.fromCharCode(36)}{{ secrets.SEMANTIC_RELEASE_DEPLOY_KEY }}`);
  const release = workflow.indexOf('npx semantic-release');
  assert.ok(eventGate >= 0 && checkoutCheck >= 0 && testGuard >= 0 && install >= 0 && latestCheck >= 0 && keyStep >= 0 && release >= 0);
  assert.ok(eventGate < checkoutCheck && checkoutCheck < testGuard && testGuard < install && install < latestCheck && latestCheck < keyStep && keyStep < release);
  const beforeKey = workflow.slice(0, keyStep);
  assert.equal(beforeKey.includes('SEMANTIC_RELEASE_DEPLOY_KEY'), false);
});
