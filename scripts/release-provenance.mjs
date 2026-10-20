/* eslint-disable no-console */

import { execFileSync } from 'node:child_process';

export const EXPECTED_REPOSITORY = 'SniperStopSniping/nailsalon';
export const EXPECTED_WORKFLOW_NAME = 'CI';
export const EXPECTED_WORKFLOW_PATH = '.github/workflows/CI.yml';
export const EXPECTED_WORKFLOW_ID = 212119716;

const FULL_SHA = /^[0-9a-f]{40}$/;

export class ProvenanceError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

function reject(code) {
  throw new ProvenanceError(code);
}

export function validateReleaseEvent(metadata) {
  if (metadata.repository !== EXPECTED_REPOSITORY) {
    reject('wrong_repository');
  }
  if (metadata.repository !== metadata.runRepository || metadata.repository !== metadata.headRepository) {
    reject('repository_mismatch');
  }
  if (metadata.conclusion !== 'success') {
    reject('upstream_not_successful');
  }
  if (metadata.event !== 'push') {
    reject('upstream_not_main_push');
  }
  if (metadata.headBranch !== 'main') {
    reject('upstream_not_main_push');
  }
  if (metadata.workflowName !== EXPECTED_WORKFLOW_NAME
    || metadata.workflowPath !== EXPECTED_WORKFLOW_PATH
    || metadata.workflowId !== EXPECTED_WORKFLOW_ID) {
    reject('wrong_workflow');
  }
  if (typeof metadata.headSha !== 'string' || !FULL_SHA.test(metadata.headSha)) {
    reject('malformed_upstream_sha');
  }
  return metadata.headSha;
}

export function validateEventCheckout(metadata, actualHeadSha, githubSha) {
  if (metadata.repository !== EXPECTED_REPOSITORY) {
    reject('wrong_repository');
  }
  if (metadata.repository !== metadata.runRepository || metadata.repository !== metadata.headRepository) {
    reject('repository_mismatch');
  }
  if (metadata.conclusion !== 'success') {
    reject('upstream_not_successful');
  }
  if (metadata.event !== 'push' || metadata.headBranch !== 'main') {
    reject('upstream_not_main_push');
  }
  if (metadata.workflowName !== EXPECTED_WORKFLOW_NAME || metadata.workflowId !== EXPECTED_WORKFLOW_ID) {
    reject('wrong_workflow');
  }
  if (typeof metadata.headSha !== 'string' || !FULL_SHA.test(metadata.headSha)) {
    reject('malformed_upstream_sha');
  }
  if (actualHeadSha !== metadata.headSha) {
    reject('checkout_sha_mismatch');
  }
  if (typeof githubSha !== 'string' || !FULL_SHA.test(githubSha) || githubSha !== metadata.headSha) {
    reject('stale_main_sha');
  }
  return metadata.headSha;
}

export function validateCheckout(metadata, actualHeadSha, latestMainSha) {
  const expectedSha = validateReleaseEvent(metadata);
  if (actualHeadSha !== expectedSha) {
    reject('checkout_sha_mismatch');
  }
  if (latestMainSha !== undefined) {
    if (typeof latestMainSha !== 'string' || !FULL_SHA.test(latestMainSha)) {
      reject('latest_main_unavailable');
    }
    if (latestMainSha !== expectedSha) {
      reject('stale_main_sha');
    }
  }
  return expectedSha;
}

export async function fetchLatestMainSha(token, fetchImpl = fetch) {
  if (typeof token !== 'string' || token.length === 0) {
    reject('latest_main_auth_unavailable');
  }
  const url = `https://api.github.com/repos/${EXPECTED_REPOSITORY}/commits/main`;
  let response;
  try {
    response = await fetchImpl(url, {
      method: 'GET',
      redirect: 'error',
      signal: AbortSignal.timeout(15_000),
      headers: {
        'Accept': 'application/vnd.github+json',
        'Authorization': `Bearer ${token}`,
        'X-GitHub-Api-Version': '2022-11-28',
      },
    });
  } catch {
    reject('latest_main_request_failed');
  }
  if (!response?.ok) {
    reject('latest_main_request_failed');
  }
  let body;
  try {
    body = await response.json();
  } catch {
    reject('latest_main_response_invalid');
  }
  if (typeof body?.sha !== 'string' || !FULL_SHA.test(body.sha)) {
    reject('latest_main_response_invalid');
  }
  return body.sha;
}

export async function fetchWorkflowRun(token, runId, fetchImpl = fetch) {
  if (typeof token !== 'string' || token.length === 0) {
    reject('workflow_run_auth_unavailable');
  }
  if (typeof runId !== 'string' || !/^\d+$/.test(runId)) {
    reject('workflow_run_id_invalid');
  }
  const url = `https://api.github.com/repos/${EXPECTED_REPOSITORY}/actions/runs/${runId}`;
  let response;
  try {
    response = await fetchImpl(url, {
      method: 'GET',
      redirect: 'error',
      signal: AbortSignal.timeout(15_000),
      headers: {
        'Accept': 'application/vnd.github+json',
        'Authorization': `Bearer ${token}`,
        'X-GitHub-Api-Version': '2022-11-28',
      },
    });
  } catch {
    reject('workflow_run_request_failed');
  }
  if (!response?.ok) {
    reject('workflow_run_request_failed');
  }
  let run;
  try {
    run = await response.json();
  } catch {
    reject('workflow_run_response_invalid');
  }
  if (!run || run.id !== Number(runId)) {
    reject('workflow_run_response_invalid');
  }
  return {
    repository: run.repository?.full_name,
    runRepository: run.repository?.full_name,
    headRepository: run.head_repository?.full_name,
    conclusion: run.conclusion,
    event: run.event,
    headBranch: run.head_branch,
    headSha: run.head_sha,
    workflowName: run.name,
    workflowPath: run.path,
    workflowId: run.workflow_id,
  };
}

function metadataFromEnvironment(env) {
  return {
    repository: env.GITHUB_REPOSITORY,
    runRepository: env.UPSTREAM_RUN_REPOSITORY,
    headRepository: env.UPSTREAM_HEAD_REPOSITORY,
    conclusion: env.UPSTREAM_CONCLUSION,
    event: env.UPSTREAM_EVENT,
    headBranch: env.UPSTREAM_HEAD_BRANCH,
    headSha: env.UPSTREAM_HEAD_SHA,
    workflowName: env.UPSTREAM_WORKFLOW_NAME,
    workflowId: Number(env.UPSTREAM_WORKFLOW_ID),
  };
}

function currentHeadSha() {
  try {
    return execFileSync('git', ['rev-parse', '--verify', 'HEAD^{commit}'], { encoding: 'utf8' }).trim();
  } catch {
    reject('checkout_head_unavailable');
  }
}

async function main() {
  const mode = process.argv[2];
  if (mode !== '--verify-checkout' && mode !== '--verify-latest-main') {
    reject('invalid_mode');
  }
  const metadata = metadataFromEnvironment(process.env);
  const headSha = currentHeadSha();
  if (mode === '--verify-checkout') {
    const checkedSha = validateEventCheckout(metadata, headSha, process.env.GITHUB_SHA);
    console.log(JSON.stringify({ status: 'PASS', mode: 'checkout', testedSha: checkedSha }));
    return;
  }
  const workflowRun = await fetchWorkflowRun(process.env.GITHUB_TOKEN, process.env.UPSTREAM_RUN_ID);
  const workflowSha = validateReleaseEvent(workflowRun);
  if (workflowSha !== metadata.headSha) {
    reject('workflow_run_sha_mismatch');
  }
  const latestMainSha = await fetchLatestMainSha(process.env.GITHUB_TOKEN);
  const checkedSha = validateCheckout(workflowRun, headSha, latestMainSha);
  console.log(JSON.stringify({ status: 'PASS', mode: 'latest-main', testedSha: checkedSha }));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    const code = error instanceof ProvenanceError ? error.code : 'provenance_check_failed';
    console.error(JSON.stringify({ status: 'REJECTED', reason: code }));
    process.exitCode = 1;
  });
}
