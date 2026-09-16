#!/usr/bin/env tsx
/**
 * Per-target billing readiness harness (PR-4 — handoff §5.1/§5.2/§5.3).
 *
 * Governing contract: docs/luster-billing-communications-rev-2-2.md §12, §20.
 * Plan: docs/luster-billing-remaining-work-plan.md §5 "P8c". Runbook:
 * docs/BILLING_PRODUCTION_RUNBOOK.md §1/§5.
 *
 * READ-ONLY. Never makes a Stripe call, never touches the database, never
 * writes a file, never mutates an environment. Its only network traffic is at
 * most two bounded GETs against the target deployment's own origin
 * (`/api/health` and `/api/billing/readiness`). It never prints a secret
 * VALUE: secrets are named on argv only as ENV VAR NAMES, read from the
 * process environment, sent in a header, and never echoed.
 *
 * WHAT CHANGED AND WHY (handoff §5.2): the previous two verdicts
 * (`readyForDarkDeploy` / `readyForActivation`) were computed from the
 * OPERATOR'S OWN SHELL — a local `process.env` plus the working tree's
 * `vercel.json`. Neither is evidence about a deployment, and the activation
 * verdict additionally required the deployment's `whsec_` VALUE to be present
 * locally. This version takes an explicit `--target` and an explicit
 * `--env-source`, gathers evidence from the deployment and from operator-saved
 * provider exports, and records in its own JSON output where every fact came
 * from. A local shell is accepted only behind `--developer`, prints a banner
 * saying so, and can never exit 0.
 *
 * FLAGS
 *   --target dark|rehearsal|activate-topups|activate-subscriptions   (required)
 *   --env-source deployed|env-file|local                             (required)
 *   --developer                     allows --env-source local; never exits 0
 *   --health-url <url>              public health of the target deployment
 *   --readiness-url <url>           defaults to <health origin>/api/billing/readiness
 *   --bypass-secret-env <NAME>      env var holding the Preview protection
 *                                   bypass value (header only, never argv)
 *   --cron-secret-env <NAME>        env var holding CRON_SECRET; sent as the
 *                                   readiness endpoint's Bearer, never printed
 *   --env-file <path>               a `vercel env pull` output for the scope
 *   --environment preview|production  the scope --env-file was pulled for
 *   --git-branch <branch>           recorded with the env-file provenance
 *   --webhook-endpoint-file <path>  `stripe webhook_endpoints retrieve` export
 *   --portal-config-file <path>     `stripe billing_portal configurations list`
 *   --cron-proof-file <path>        recorded manual/dashboard cron invocations
 *   --integrity-report <path>       scripts/billing-integrity-check.ts report
 *   --vercel-json-at-sha <path>     vercel.json as of the deployed gitSha;
 *                                   when omitted the CLI runs
 *                                   `git show <deployed gitSha>:vercel.json`
 *   --health-file <path>            a SAVED /api/health response (evidence
 *   --readiness-file <path>         a SAVED /api/billing/readiness response
 *                                   — both are recorded evidence files, never
 *                                   a substitute for a deployed source: they
 *                                   are REFUSED with `--env-source deployed`,
 *                                   and every target other than `dark` still
 *                                   requires `--env-source deployed`, so a
 *                                   saved file can never manufacture a
 *                                   rehearsal or activation verdict. The JSON
 *                                   `provenance` block names the exact file
 *                                   each fact was read from.
 *
 * EXIT CODES (latched upward; a later check can raise 0→4→5→6, never lower)
 *   0  the target is met by the supplied evidence
 *   4  the target is NOT met (evidence was readable and says so)
 *   5  evidence missing or unreadable (absent/invalid file, unreachable or
 *      401 readiness endpoint, unreadable health URL, unknown deployed sha)
 *   6  the evidence source cannot prove this target (`--env-source env-file`
 *      or `local` for a non-`dark` target, `--developer`, or an invocation
 *      that never establishes a target/source at all)
 *
 * USAGE
 *   npx tsx scripts/billing-readiness-check.ts --target dark \
 *     --env-source deployed --health-url https://www.lustergel.app/api/health
 *   npx tsx scripts/billing-readiness-check.ts --target rehearsal \
 *     --env-source deployed --environment preview \
 *     --health-url https://<preview>/api/health \
 *     --bypass-secret-env VERCEL_AUTOMATION_BYPASS_SECRET \
 *     --cron-secret-env PREVIEW_CRON_SECRET \
 *     --env-file /secure/preview.env --git-branch pilot-isla \
 *     --webhook-endpoint-file /secure/endpoint.json \
 *     --portal-config-file /secure/portal.json \
 *     --cron-proof-file /secure/cron-proof.json \
 *     --integrity-report /secure/integrity.json
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type {
  BillingCronInvocationProof,
  BillingIntegrityReport,
  BillingPortalConfigurationExport,
  BillingReadinessEndpointFacts,
  BillingReadinessEnvFileCarrier,
  BillingReadinessEnvironment,
  BillingReadinessEvidence,
  BillingReadinessEvidenceSource,
  BillingReadinessHealthFacts,
  BillingReadinessTarget,
  ProvisionedBillingWebhookEndpoint,
  VercelCronEntry,
} from '../src/libs/billing/readinessCheck';
import {
  BILLING_READINESS_TARGETS,
  evaluateBillingReadiness,
  inspectEnvFileCarrier,
  runBillingReadinessCheck,
} from '../src/libs/billing/readinessCheck';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const BYPASS_HEADER = 'x-vercel-protection-bypass';
export const FETCH_DEADLINE_MS = 10_000;

export const EXIT_TARGET_MET = 0;
export const EXIT_TARGET_NOT_MET = 4;
export const EXIT_EVIDENCE_MISSING = 5;
export const EXIT_SOURCE_INSUFFICIENT = 6;

export const DEVELOPER_BANNER = 'EVIDENCE SOURCE: local developer shell — NOT deployed proof';

const EVIDENCE_SOURCES: readonly BillingReadinessEvidenceSource[] = ['deployed', 'env-file', 'local'];
const ENVIRONMENTS: readonly BillingReadinessEnvironment[] = ['preview', 'production'];

/**
 * Monotonic exit-code latch. The ONLY way the process exit code is ever set:
 * a later, more serious finding may raise it, and nothing may lower it — a
 * "met" verdict computed after an unreadable evidence file must not erase the
 * fact that the file was unreadable.
 */
export class ExitLatch {
  private code = EXIT_TARGET_MET;

  raise(candidate: number): void {
    if (candidate > this.code) {
      this.code = candidate;
    }
  }

  get value(): number {
    return this.code;
  }
}

export type ReadinessArguments = {
  target: BillingReadinessTarget | null;
  envSource: BillingReadinessEvidenceSource | null;
  developer: boolean;
  healthUrl: string | null;
  readinessUrl: string | null;
  bypassSecretEnv: string | null;
  cronSecretEnv: string | null;
  envFile: string | null;
  environment: BillingReadinessEnvironment | null;
  gitBranch: string | null;
  webhookEndpointFile: string | null;
  portalConfigFile: string | null;
  cronProofFile: string | null;
  integrityReport: string | null;
  vercelJsonAtSha: string | null;
  healthFile: string | null;
  readinessFile: string | null;
  error: string | null;
  /** Exit code the caller must latch when `error` is set. */
  errorExit: number;
};

const VALUE_FLAGS = [
  '--target',
  '--env-source',
  '--health-url',
  '--readiness-url',
  '--bypass-secret-env',
  '--cron-secret-env',
  '--env-file',
  '--environment',
  '--git-branch',
  '--webhook-endpoint-file',
  '--webhook-event-types-file',
  '--portal-config-file',
  '--cron-proof-file',
  '--integrity-report',
  '--vercel-json-at-sha',
  '--health-file',
  '--readiness-file',
] as const;

function emptyArguments(): ReadinessArguments {
  return {
    target: null,
    envSource: null,
    developer: false,
    healthUrl: null,
    readinessUrl: null,
    bypassSecretEnv: null,
    cronSecretEnv: null,
    envFile: null,
    environment: null,
    gitBranch: null,
    webhookEndpointFile: null,
    portalConfigFile: null,
    cronProofFile: null,
    integrityReport: null,
    vercelJsonAtSha: null,
    healthFile: null,
    readinessFile: null,
    error: null,
    errorExit: EXIT_SOURCE_INSUFFICIENT,
  };
}

/** Pure argument parsing, kept exportable for CLI tests. */
export function parseReadinessArguments(argv: readonly string[]): ReadinessArguments {
  const parsed = emptyArguments();
  const fail = (message: string, exit: number): ReadinessArguments => ({
    ...parsed,
    error: message,
    errorExit: exit,
  });

  // A flag whose value is missing must never silently swallow the NEXT flag
  // (that is how `--webhook-endpoint-file --target rehearsal` would quietly
  // read a file named "--target").
  const readValue = (flag: string): string | null | undefined => {
    const index = argv.indexOf(flag);
    if (index === -1) {
      return undefined;
    }
    const value = argv[index + 1];
    return !value || value.startsWith('--') ? null : value;
  };

  for (const flag of VALUE_FLAGS) {
    if (readValue(flag) === null) {
      return fail(`${flag} requires a value`, EXIT_EVIDENCE_MISSING);
    }
  }

  // Every flag above is now known to carry a value; narrow the reader so the
  // rest of this function deals in `string | undefined` only.
  const value = (flag: string): string | undefined => {
    const raw = readValue(flag);
    return raw === null ? undefined : raw;
  };

  if (argv.includes('--mode')) {
    return fail('--mode was replaced by --target dark|rehearsal|activate-topups|activate-subscriptions', EXIT_SOURCE_INSUFFICIENT);
  }

  parsed.developer = argv.includes('--developer');

  const target = value('--target');
  if (target === undefined) {
    return fail(`--target is required (${BILLING_READINESS_TARGETS.join(' | ')})`, EXIT_SOURCE_INSUFFICIENT);
  }
  if (!(BILLING_READINESS_TARGETS as readonly string[]).includes(target)) {
    return fail(`--target must be one of ${BILLING_READINESS_TARGETS.join(' | ')}`, EXIT_SOURCE_INSUFFICIENT);
  }
  parsed.target = target as BillingReadinessTarget;

  const envSource = value('--env-source');
  if (envSource === undefined) {
    return fail(`--env-source is required (${EVIDENCE_SOURCES.join(' | ')})`, EXIT_SOURCE_INSUFFICIENT);
  }
  if (!(EVIDENCE_SOURCES as readonly string[]).includes(envSource)) {
    return fail(`--env-source must be one of ${EVIDENCE_SOURCES.join(' | ')}`, EXIT_SOURCE_INSUFFICIENT);
  }
  parsed.envSource = envSource as BillingReadinessEvidenceSource;
  if (parsed.envSource === 'local' && !parsed.developer) {
    return fail('--env-source local is a developer diagnostic only and requires --developer (it can never exit 0)', EXIT_SOURCE_INSUFFICIENT);
  }

  const environment = value('--environment');
  if (environment !== undefined && !(ENVIRONMENTS as readonly string[]).includes(environment)) {
    return fail(`--environment must be one of ${ENVIRONMENTS.join(' | ')}`, EXIT_SOURCE_INSUFFICIENT);
  }
  parsed.environment = (environment ?? null) as BillingReadinessEnvironment | null;

  parsed.healthUrl = value('--health-url') ?? null;
  parsed.readinessUrl = value('--readiness-url') ?? null;
  parsed.bypassSecretEnv = value('--bypass-secret-env') ?? null;
  parsed.cronSecretEnv = value('--cron-secret-env') ?? null;
  parsed.envFile = value('--env-file') ?? null;
  parsed.gitBranch = value('--git-branch') ?? null;
  // `--webhook-event-types-file` is the pre-PR-4 spelling of the same object
  // export; accepted so an operator following an older runbook copy is not
  // silently given a verdict with no endpoint evidence at all.
  parsed.webhookEndpointFile = value('--webhook-endpoint-file')
  ?? value('--webhook-event-types-file')
  ?? null;
  parsed.portalConfigFile = value('--portal-config-file') ?? null;
  parsed.cronProofFile = value('--cron-proof-file') ?? null;
  parsed.integrityReport = value('--integrity-report') ?? null;
  parsed.vercelJsonAtSha = value('--vercel-json-at-sha') ?? null;
  parsed.healthFile = value('--health-file') ?? null;
  parsed.readinessFile = value('--readiness-file') ?? null;

  if (parsed.bypassSecretEnv !== null && parsed.healthUrl === null && parsed.readinessUrl === null) {
    return fail('--bypass-secret-env is only meaningful with --health-url or --readiness-url', EXIT_SOURCE_INSUFFICIENT);
  }
  if (parsed.envFile !== null && parsed.environment === null) {
    return fail('--env-file requires --environment preview|production (the scope it was pulled for)', EXIT_SOURCE_INSUFFICIENT);
  }
  if (parsed.envSource === 'deployed' && (parsed.healthFile !== null || parsed.readinessFile !== null)) {
    return fail('--health-file/--readiness-file are saved evidence files and are refused with --env-source deployed, which means facts read live from the deployment', EXIT_SOURCE_INSUFFICIENT);
  }
  if (parsed.envSource === 'deployed' && parsed.healthUrl === null) {
    return fail('--env-source deployed requires --health-url (the target deployment origin)', EXIT_SOURCE_INSUFFICIENT);
  }

  return parsed;
}

// ---------------------------------------------------------------------------
// Evidence files. Every reader validates structure before returning; an
// unreadable or structurally invalid file is MISSING evidence (exit 5), never
// a pass and never a silent `undefined`.
// ---------------------------------------------------------------------------

export type EvidenceRead<T> = { ok: true; value: T } | { ok: false; reason: string };

function readJsonFile(file: string): EvidenceRead<unknown> {
  try {
    return { ok: true, value: JSON.parse(fs.readFileSync(file, 'utf8')) as unknown };
  } catch {
    // Deliberately no error detail: a parse error message can echo file
    // content, and these files sit next to secrets.
    return { ok: false, reason: 'file could not be read or is not valid JSON' };
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Preserves #225's object validation: a bare array is not an endpoint. */
export function validateWebhookEndpoint(parsed: unknown): EvidenceRead<ProvisionedBillingWebhookEndpoint> {
  if (
    !isRecord(parsed)
    || typeof parsed.id !== 'string'
    || typeof parsed.url !== 'string'
    || typeof parsed.livemode !== 'boolean'
    || typeof parsed.status !== 'string'
    || !Array.isArray(parsed.enabled_events)
    || !parsed.enabled_events.every(type => typeof type === 'string')
  ) {
    return { ok: false, reason: 'not a Stripe webhook-endpoint object export (need id, url, livemode, status, enabled_events[])' };
  }
  return { ok: true, value: parsed as unknown as ProvisionedBillingWebhookEndpoint };
}

export function validatePortalConfigurations(parsed: unknown): EvidenceRead<BillingPortalConfigurationExport[]> {
  // `stripe billing_portal configurations list` emits `{ data: [...] }`; a
  // hand-saved export is often the bare array.
  const list = Array.isArray(parsed)
    ? parsed
    : isRecord(parsed) && Array.isArray(parsed.data) ? parsed.data : null;
  if (list === null) {
    return { ok: false, reason: 'not a Billing Portal configuration list export' };
  }
  const configurations: BillingPortalConfigurationExport[] = [];
  for (const entry of list) {
    if (!isRecord(entry) || typeof entry.id !== 'string' || typeof entry.is_default !== 'boolean') {
      return { ok: false, reason: 'a portal configuration entry lacks id/is_default' };
    }
    configurations.push(entry as unknown as BillingPortalConfigurationExport);
  }
  return { ok: true, value: configurations };
}

export function validateCronProof(parsed: unknown): EvidenceRead<BillingCronInvocationProof> {
  if (!isRecord(parsed) || !Array.isArray(parsed.invocations) || typeof parsed.recordedAt !== 'string') {
    return { ok: false, reason: 'not a cron-invocation proof (need invocations[] and recordedAt)' };
  }
  for (const entry of parsed.invocations) {
    if (!isRecord(entry) || typeof entry.path !== 'string' || typeof entry.status !== 'number') {
      return { ok: false, reason: 'a recorded invocation lacks path/status' };
    }
  }
  return { ok: true, value: parsed as unknown as BillingCronInvocationProof };
}

export function validateIntegrityReport(parsed: unknown): EvidenceRead<BillingIntegrityReport> {
  if (!isRecord(parsed) || typeof parsed.exitCode !== 'number' || !Array.isArray(parsed.violations)) {
    return { ok: false, reason: 'not a billing-integrity report (need exitCode and violations[])' };
  }
  return { ok: true, value: parsed as unknown as BillingIntegrityReport };
}

/**
 * `httpStatus` is omitted when the body came from a SAVED file rather than a
 * live response. It is then derived from the body's own `status`, because
 * `/api/health` answers 503 for exactly `status !== 'ok'` — rather than
 * recording a 200 the deployment never sent.
 */
export function validateHealthFacts(parsed: unknown, httpStatus?: number): EvidenceRead<BillingReadinessHealthFacts> {
  if (!isRecord(parsed)) {
    return { ok: false, reason: 'health response is not an object' };
  }
  const billing = parsed.billing;
  if (
    !isRecord(billing)
    || typeof billing.dark !== 'boolean'
    || typeof billing.planEnvMatchesRuntime !== 'boolean'
    || typeof parsed.schemaDrift !== 'string'
    || typeof parsed.status !== 'string'
  ) {
    return { ok: false, reason: 'health response has no well-formed billing block' };
  }
  return {
    ok: true,
    value: {
      httpStatus: httpStatus ?? (parsed.status === 'ok' ? 200 : 503),
      status: parsed.status,
      dark: billing.dark,
      planEnvMatchesRuntime: billing.planEnvMatchesRuntime,
      schemaDrift: parsed.schemaDrift,
      gitSha: typeof parsed.gitSha === 'string' ? parsed.gitSha : null,
    },
  };
}

export function validateReadinessFacts(parsed: unknown): EvidenceRead<BillingReadinessEndpointFacts> {
  if (!isRecord(parsed)) {
    return { ok: false, reason: 'readiness response is not an object' };
  }
  const switches = parsed.switches;
  const carrier = parsed.carrier;
  if (
    !isRecord(switches)
    || typeof switches.subscriptions !== 'boolean'
    || typeof switches.topups !== 'boolean'
    || typeof switches.publicPricing !== 'boolean'
    || typeof switches.taxCollection !== 'boolean'
    || !isRecord(carrier)
    || typeof carrier.present !== 'boolean'
    || typeof carrier.offers !== 'number'
    || typeof carrier.topups !== 'number'
    || typeof carrier.coupons !== 'number'
    || typeof carrier.parse !== 'string'
    || typeof parsed.planEnvMatchesRuntime !== 'boolean'
    || typeof parsed.webhookSecretConfigured !== 'boolean'
    || typeof parsed.webhookSecretDistinct !== 'boolean'
    || typeof parsed.cronSecretConfigured !== 'boolean'
    || typeof parsed.identityHmacConfigured !== 'boolean'
    || typeof parsed.deploymentMarker !== 'boolean'
    || typeof parsed.timestamp !== 'string'
  ) {
    return { ok: false, reason: 'readiness response is missing required presence facts' };
  }
  return { ok: true, value: parsed as unknown as BillingReadinessEndpointFacts };
}

/**
 * Minimal `vercel env pull` (dotenv) reader. Returns variable NAMES and the
 * carrier value only. Values are NEVER returned wholesale and never printed:
 * this file holds the deployment's secrets, and the harness's whole point is
 * that it reports presence, not content.
 */
export function readEnvFileNamesAndCarrier(content: string): {
  names: string[];
  planEnv: string | undefined;
  carrierRaw: string | undefined;
} {
  const names: string[] = [];
  let planEnv: string | undefined;
  let carrierRaw: string | undefined;
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line === '' || line.startsWith('#')) {
      continue;
    }
    const withoutExport = line.startsWith('export ') ? line.slice('export '.length).trim() : line;
    const separator = withoutExport.indexOf('=');
    if (separator <= 0) {
      continue;
    }
    const name = withoutExport.slice(0, separator).trim();
    if (!/^[A-Z_]\w*$/i.test(name)) {
      continue;
    }
    names.push(name);
    if (name !== 'BILLING_PLAN_ENV' && name !== 'BILLING_STRIPE_PRICE_IDS') {
      continue;
    }
    let value = withoutExport.slice(separator + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"') && value.length >= 2)
      || (value.startsWith('\'') && value.endsWith('\'') && value.length >= 2)) {
      value = value.slice(1, -1);
    }
    if (name === 'BILLING_PLAN_ENV') {
      planEnv = value;
    } else {
      // `vercel env pull` escapes embedded quotes in JSON values.
      carrierRaw = value.replace(/\\"/g, '"');
    }
  }
  return { names, planEnv, carrierRaw };
}

// ---------------------------------------------------------------------------
// Deployed evidence. Both fetches keep #225's hardening unchanged: HTTPS only,
// no credentials/query/fragment in the URL, redirects REFUSED (an automation
// bypass header must never be replayed to a redirect target), a 10 s deadline,
// and no transport/JSON error detail in any message.
// ---------------------------------------------------------------------------

export type HealthResponse = {
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
};

export type HealthFetch = (url: string, init: {
  method: 'GET';
  headers: Record<string, string>;
  redirect: 'manual';
  signal: AbortSignal;
}) => Promise<HealthResponse>;

export function isRedirect(status: number): boolean {
  return status >= 300 && status < 400;
}

export function assertSafeFetchUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:'
      && !parsed.username
      && !parsed.password
      && !parsed.search
      && !parsed.hash;
  } catch {
    return false;
  }
}

/**
 * `acceptDegraded` is the ONLY Preview-specific allowance, and it is narrow:
 * a Preview deployment is structurally `degraded` (no redis, no verified
 * Resend sender, no Google Calendar on the branch scope), so `/api/health`
 * answers 503 with a complete, correct body. Reading the billing block out of
 * that body is not "ignoring a failure" — the aggregate status is carried
 * through to the evaluation and reported as its own check detail. Production
 * targets do NOT get this allowance: a 503 there is a real failure.
 */
export async function fetchDeployedHealth(
  url: string,
  options: { bypassSecret: string | null; acceptDegraded: boolean },
  fetchImpl: HealthFetch = fetch as unknown as HealthFetch,
): Promise<EvidenceRead<BillingReadinessHealthFacts>> {
  if (!assertSafeFetchUrl(url)) {
    return { ok: false, reason: 'health URL must be HTTPS without credentials, query, or fragment' };
  }
  try {
    const headers: Record<string, string> = {};
    if (options.bypassSecret !== null) {
      headers[BYPASS_HEADER] = options.bypassSecret;
    }
    const response = await fetchImpl(url, {
      method: 'GET',
      headers,
      redirect: 'manual',
      signal: AbortSignal.timeout(FETCH_DEADLINE_MS),
    });
    if (isRedirect(response.status)) {
      return { ok: false, reason: `health URL returned HTTP ${response.status}; redirected health evidence is rejected` };
    }
    const degradedButReadable = response.status === 503 && options.acceptDegraded;
    if (!response.ok && !degradedButReadable) {
      return { ok: false, reason: `health URL returned HTTP ${response.status}` };
    }
    return validateHealthFacts(await response.json(), response.status);
  } catch {
    return { ok: false, reason: 'health request failed' };
  }
}

export async function fetchDeployedReadiness(
  url: string,
  options: { bypassSecret: string | null; cronSecret: string | null },
  fetchImpl: HealthFetch = fetch as unknown as HealthFetch,
): Promise<EvidenceRead<BillingReadinessEndpointFacts>> {
  if (!assertSafeFetchUrl(url)) {
    return { ok: false, reason: 'readiness URL must be HTTPS without credentials, query, or fragment' };
  }
  if (options.cronSecret === null) {
    return { ok: false, reason: 'no CRON_SECRET available (--cron-secret-env named an unset variable)' };
  }
  try {
    const headers: Record<string, string> = { authorization: `Bearer ${options.cronSecret}` };
    if (options.bypassSecret !== null) {
      headers[BYPASS_HEADER] = options.bypassSecret;
    }
    const response = await fetchImpl(url, {
      method: 'GET',
      headers,
      redirect: 'manual',
      signal: AbortSignal.timeout(FETCH_DEADLINE_MS),
    });
    if (isRedirect(response.status)) {
      return { ok: false, reason: `readiness URL returned HTTP ${response.status}; redirected evidence is rejected` };
    }
    if (response.status === 401) {
      return { ok: false, reason: 'readiness endpoint returned 401 (CRON_SECRET not accepted, or unset on the deployment)' };
    }
    if (!response.ok) {
      return { ok: false, reason: `readiness endpoint returned HTTP ${response.status}` };
    }
    return validateReadinessFacts(await response.json());
  } catch {
    return { ok: false, reason: 'readiness request failed' };
  }
}

/**
 * `vercel.json` AT THE DEPLOYED SHA — never the working tree's, which is the
 * defect this replaces (#225 finding B5): a working-tree read proves only
 * what the operator has checked out.
 */
export function readVercelCronsAtSha(gitSha: string): EvidenceRead<VercelCronEntry[]> {
  if (!/^[0-9a-f]{7,40}$/i.test(gitSha)) {
    return { ok: false, reason: 'deployed gitSha is not a commit sha' };
  }
  let raw: string;
  try {
    raw = execFileSync('git', ['show', `${gitSha}:vercel.json`], {
      cwd: repositoryRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch {
    return { ok: false, reason: `commit ${gitSha} is not present in this checkout; fetch it (or pass --vercel-json-at-sha)` };
  }
  return parseVercelCrons(raw);
}

export function parseVercelCrons(raw: string): EvidenceRead<VercelCronEntry[]> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, reason: 'vercel.json is not valid JSON' };
  }
  if (!isRecord(parsed)) {
    return { ok: false, reason: 'vercel.json is not an object' };
  }
  const crons = parsed.crons;
  if (crons === undefined) {
    return { ok: true, value: [] };
  }
  if (!Array.isArray(crons) || !crons.every(entry => isRecord(entry) && typeof entry.path === 'string')) {
    return { ok: false, reason: 'vercel.json crons is not a list of { path }' };
  }
  return { ok: true, value: crons as unknown as VercelCronEntry[] };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

type Provenance = Record<string, string>;

function originOf(url: string | null): string | null {
  if (url === null) {
    return null;
  }
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

export async function main(): Promise<void> {
  const args = parseReadinessArguments(process.argv.slice(2));
  const latch = new ExitLatch();
  if (args.error !== null) {
    process.stderr.write(`${args.error}\n`);
    latch.raise(args.errorExit);
    process.exitCode = latch.value;
    return;
  }

  const target = args.target!;
  const source = args.envSource!;
  const origin = originOf(args.healthUrl) ?? originOf(args.readinessUrl);
  const provenance: Provenance = {};

  // The FIRST line of output, always, before any evidence is gathered: a
  // reader who sees only one line must still know what the verdict below is
  // (and is not) evidence of.
  process.stdout.write(`evidenceSource: ${source} environment=${args.environment ?? 'unspecified'} origin=${origin ?? 'none'}\n`);
  if (args.developer) {
    process.stdout.write(`${DEVELOPER_BANNER}\n`);
    latch.raise(EXIT_SOURCE_INSUFFICIENT);
  }

  const bypassSecret = args.bypassSecretEnv === null
    ? null
    : process.env[args.bypassSecretEnv] || null;
  if (args.bypassSecretEnv !== null && bypassSecret === null) {
    process.stderr.write(`[warn] --bypass-secret-env named ${args.bypassSecretEnv}, which is unset or empty\n`);
  }
  const cronSecret = args.cronSecretEnv === null
    ? null
    : process.env[args.cronSecretEnv] || null;
  if (args.cronSecretEnv !== null && cronSecret === null) {
    process.stderr.write(`[warn] --cron-secret-env named ${args.cronSecretEnv}, which is unset or empty\n`);
  }

  const evidence: BillingReadinessEvidence = {
    source,
    environment: args.environment,
    origin,
  };

  // --- health -------------------------------------------------------------
  if (args.healthFile !== null) {
    const file = readJsonFile(args.healthFile);
    const facts = file.ok ? validateHealthFacts(file.value) : file;
    if (facts.ok) {
      evidence.health = facts.value;
      provenance.health = `file:${args.healthFile} (saved /api/health response)`;
      if (args.healthUrl !== null) {
        process.stderr.write('[note] --health-file was supplied, so --health-url was NOT fetched; it is used only as the target origin\n');
      }
    } else {
      process.stderr.write(`[warn] --health-file: ${facts.reason}\n`);
      latch.raise(EXIT_EVIDENCE_MISSING);
    }
  } else if (args.healthUrl !== null) {
    const facts = await fetchDeployedHealth(args.healthUrl, {
      bypassSecret,
      acceptDegraded: args.environment === 'preview',
    });
    if (facts.ok) {
      evidence.health = facts.value;
      provenance.health = `GET ${args.healthUrl}`;
    } else {
      process.stderr.write(`[warn] --health-url: ${facts.reason}\n`);
      latch.raise(EXIT_EVIDENCE_MISSING);
    }
  }

  // --- readiness endpoint --------------------------------------------------
  if (args.readinessFile !== null) {
    const file = readJsonFile(args.readinessFile);
    const facts = file.ok ? validateReadinessFacts(file.value) : file;
    if (facts.ok) {
      evidence.readiness = facts.value;
      provenance.readiness = `file:${args.readinessFile} (saved /api/billing/readiness response)`;
    } else {
      process.stderr.write(`[warn] --readiness-file: ${facts.reason}\n`);
      latch.raise(EXIT_EVIDENCE_MISSING);
    }
  } else if (source === 'deployed') {
    const readinessUrl = args.readinessUrl
      ?? (origin === null ? null : `${origin}/api/billing/readiness`);
    if (readinessUrl === null) {
      process.stderr.write('[warn] no readiness URL could be derived; pass --readiness-url\n');
      latch.raise(EXIT_EVIDENCE_MISSING);
    } else {
      const facts = await fetchDeployedReadiness(readinessUrl, { bypassSecret, cronSecret });
      if (facts.ok) {
        evidence.readiness = facts.value;
        provenance.readiness = `GET ${readinessUrl}`;
      } else {
        process.stderr.write(`[warn] readiness endpoint: ${facts.reason}\n`);
        latch.raise(EXIT_EVIDENCE_MISSING);
      }
    }
  }

  // --- pulled env file -----------------------------------------------------
  if (args.envFile !== null) {
    let content: string | null = null;
    try {
      content = fs.readFileSync(args.envFile, 'utf8');
    } catch {
      process.stderr.write('[warn] --env-file could not be read\n');
      latch.raise(EXIT_EVIDENCE_MISSING);
    }
    if (content !== null) {
      const { names, planEnv, carrierRaw } = readEnvFileNamesAndCarrier(content);
      evidence.envFileNames = names;
      if (carrierRaw !== undefined) {
        const carrier: BillingReadinessEnvFileCarrier = inspectEnvFileCarrier(carrierRaw, planEnv);
        evidence.envFileCarrier = carrier;
      }
      provenance.envFile = `file:${args.envFile} (vercel env pull --environment=${args.environment ?? 'unspecified'}${args.gitBranch === null ? '' : ` --git-branch=${args.gitBranch}`}; ${names.length} variable names read, no value printed)`;
    }
  }

  // --- vercel.json at the deployed sha -------------------------------------
  const deployedSha = evidence.readiness?.gitSha ?? evidence.health?.gitSha ?? null;
  if (args.vercelJsonAtSha !== null) {
    let raw: string | null = null;
    try {
      raw = fs.readFileSync(args.vercelJsonAtSha, 'utf8');
    } catch {
      process.stderr.write('[warn] --vercel-json-at-sha could not be read\n');
      latch.raise(EXIT_EVIDENCE_MISSING);
    }
    if (raw !== null) {
      const crons = parseVercelCrons(raw);
      if (crons.ok) {
        evidence.vercelCrons = crons.value;
        provenance.vercelCrons = `file:${args.vercelJsonAtSha} (operator-supplied vercel.json for deployed sha ${deployedSha ?? 'unknown'})`;
      } else {
        process.stderr.write(`[warn] --vercel-json-at-sha: ${crons.reason}\n`);
        latch.raise(EXIT_EVIDENCE_MISSING);
      }
    }
  } else if (target !== 'dark') {
    if (deployedSha === null) {
      process.stderr.write('[warn] no deployed gitSha was available; cannot read vercel.json at the deployed commit\n');
      latch.raise(EXIT_EVIDENCE_MISSING);
    } else {
      const crons = readVercelCronsAtSha(deployedSha);
      if (crons.ok) {
        evidence.vercelCrons = crons.value;
        provenance.vercelCrons = `git show ${deployedSha}:vercel.json`;
      } else {
        process.stderr.write(`[warn] vercel.json at ${deployedSha}: ${crons.reason}\n`);
        latch.raise(EXIT_EVIDENCE_MISSING);
      }
    }
  }

  // --- operator-saved provider exports -------------------------------------
  const fileEvidence: Array<{
    flag: string;
    file: string | null;
    apply: (parsed: unknown) => EvidenceRead<unknown>;
    assign: (value: never) => void;
    key: string;
  }> = [
    {
      flag: '--webhook-endpoint-file',
      file: args.webhookEndpointFile,
      apply: validateWebhookEndpoint,
      assign: (value: never) => {
        evidence.webhookEndpoint = value as ProvisionedBillingWebhookEndpoint;
      },
      key: 'webhookEndpoint',
    },
    {
      flag: '--portal-config-file',
      file: args.portalConfigFile,
      apply: validatePortalConfigurations,
      assign: (value: never) => {
        evidence.portalConfigurations = value as BillingPortalConfigurationExport[];
      },
      key: 'portalConfigurations',
    },
    {
      flag: '--cron-proof-file',
      file: args.cronProofFile,
      apply: validateCronProof,
      assign: (value: never) => {
        evidence.cronProof = value as BillingCronInvocationProof;
      },
      key: 'cronProof',
    },
    {
      flag: '--integrity-report',
      file: args.integrityReport,
      apply: validateIntegrityReport,
      assign: (value: never) => {
        evidence.integrityReport = value as BillingIntegrityReport;
      },
      key: 'integrityReport',
    },
  ];
  for (const entry of fileEvidence) {
    if (entry.file === null) {
      continue;
    }
    const file = readJsonFile(entry.file);
    const validated = file.ok ? entry.apply(file.value) : file;
    if (validated.ok) {
      entry.assign(validated.value as never);
      provenance[entry.key] = `file:${entry.file}`;
    } else {
      process.stderr.write(`[warn] ${entry.flag}: ${validated.reason}\n`);
      latch.raise(EXIT_EVIDENCE_MISSING);
    }
  }

  const evaluation = evaluateBillingReadiness({ target, evidence });

  // `--developer` only: the pre-PR-4 whole-environment diagnostic, over the
  // operator's own shell. Reported as a DIAGNOSTIC, never folded into `met`,
  // and the banner above has already latched exit 6.
  const developerDiagnostic = args.developer
    ? runBillingReadinessCheck({
      env: process.env,
      vercelCrons: evidence.vercelCrons ?? [],
      provisionedWebhookEndpoint: evidence.webhookEndpoint,
      expectedWebhookUrl: origin === null ? undefined : `${origin}/api/webhooks/stripe-billing`,
    })
    : null;

  process.stdout.write(`${JSON.stringify({
    target: evaluation.target,
    evidenceSource: evaluation.evidenceSource,
    environment: args.environment,
    origin,
    provenance,
    met: evaluation.met,
    missingEvidence: evaluation.missingEvidence,
    checks: evaluation.checks,
    ...(developerDiagnostic === null ? {} : { developerDiagnostic }),
  }, null, 2)}\n`);

  process.stdout.write(`\n--- billing readiness: target ${target} ---\n`);
  for (const check of evaluation.checks) {
    process.stdout.write(`[${check.ok ? 'OK  ' : 'FAIL'}] ${check.id}: ${check.detail}\n`);
  }
  if (evaluation.missingEvidence.length > 0) {
    process.stdout.write(`missingEvidence: ${evaluation.missingEvidence.join(', ')}\n`);
    latch.raise(EXIT_EVIDENCE_MISSING);
  }
  const sourceCheck = evaluation.checks.find(check => check.id === 'evidence_source');
  if (sourceCheck !== undefined && !sourceCheck.ok) {
    latch.raise(EXIT_SOURCE_INSUFFICIENT);
  }
  if (!evaluation.met) {
    latch.raise(EXIT_TARGET_NOT_MET);
  }
  process.stdout.write(`met: ${evaluation.met}\n`);
  process.stdout.write(`exitCode: ${latch.value}\n`);

  process.exitCode = latch.value;
}

const invokedDirectly = process.argv[1] !== undefined
  && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (invokedDirectly) {
  void main();
}
