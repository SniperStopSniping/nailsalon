#!/usr/bin/env tsx
/**
 * P8c read-only billing production-readiness check.
 *
 * Governing contract: docs/luster-billing-communications-rev-2-2.md §12,
 * §20. Plan: docs/luster-billing-remaining-work-plan.md §5 "P8c". Runbook:
 * docs/BILLING_PRODUCTION_RUNBOOK.md.
 *
 * Reads `process.env` and `vercel.json` (never mutates either). Optionally
 * fetches `--health-url <url>` with ONE bounded GET request and consults only
 * the response's billing flags and schema readiness. A protected Preview
 * may use a bypass header read from the named environment variable.
 * Never makes a Stripe call,
 * never touches the database, never prints a secret VALUE (only presence,
 * distinctness and catalogue KEY names — see readinessCheck.ts's header).
 *
 * Usage:
 *   npx tsx scripts/billing-readiness-check.ts
 *   npx tsx scripts/billing-readiness-check.ts --health-url https://www.lustergel.app/api/health
 *   npx tsx scripts/billing-readiness-check.ts --mode activation \
 *       --webhook-event-types-file /secure/path/stripe-endpoint-events.json
 *
 * Exit code: 0 when the selected mode is ready, 4 otherwise. The default
 * mode is `dark`. Supplying --health-url makes a successful, well-formed
 * health response mandatory; a skipped request is not deployment evidence.
 * Activation additionally requires an independently exported Stripe endpoint
 * event list via --webhook-event-types-file.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { BillingReadinessHealthBilling, ProvisionedBillingWebhookEndpoint, VercelCronEntry } from '../src/libs/billing/readinessCheck';
import { runBillingReadinessCheck } from '../src/libs/billing/readinessCheck';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export type ReadinessMode = 'dark' | 'activation';

export type ReadinessArguments = {
  healthUrl: string | null;
  webhookEventTypesFile: string | null;
  /** Name only; its value is never accepted on argv. */
  bypassSecretEnv: string | null;
  mode: ReadinessMode;
  error: string | null;
};

export const BYPASS_HEADER = 'x-vercel-protection-bypass';

/** Pure argument parsing, kept exportable for CLI tests. */
export function parseReadinessArguments(argv: readonly string[]): ReadinessArguments {
  const readValue = (flag: string): string | null | undefined => {
    const index = argv.indexOf(flag);
    if (index === -1) {
      return undefined;
    }
    const value = argv[index + 1];
    return !value || value.startsWith('--') ? null : value;
  };
  const healthUrl = readValue('--health-url');
  const webhookEventTypesFile = readValue('--webhook-event-types-file');
  const bypassSecretEnv = readValue('--bypass-secret-env');
  if (healthUrl === null || webhookEventTypesFile === null) {
    return {
      healthUrl: healthUrl ?? null,
      webhookEventTypesFile: webhookEventTypesFile ?? null,
      bypassSecretEnv: bypassSecretEnv ?? null,
      mode: 'dark',
      error: `${healthUrl === null ? '--health-url' : '--webhook-event-types-file'} requires a value`,
    };
  }
  if (bypassSecretEnv === null) {
    return {
      healthUrl: healthUrl ?? null,
      webhookEventTypesFile: webhookEventTypesFile ?? null,
      bypassSecretEnv: null,
      mode: 'dark',
      error: '--bypass-secret-env requires the name of an environment variable',
    };
  }
  if (bypassSecretEnv !== undefined && healthUrl === undefined) {
    return {
      healthUrl: null,
      webhookEventTypesFile: webhookEventTypesFile ?? null,
      bypassSecretEnv,
      mode: 'dark',
      error: '--bypass-secret-env is only meaningful with --health-url',
    };
  }
  const modeIndex = argv.indexOf('--mode');
  const requestedMode = modeIndex === -1 ? 'dark' : argv[modeIndex + 1];
  if (requestedMode !== 'dark' && requestedMode !== 'activation') {
    return {
      healthUrl: healthUrl ?? null,
      webhookEventTypesFile: webhookEventTypesFile ?? null,
      bypassSecretEnv: bypassSecretEnv ?? null,
      mode: 'dark',
      error: '--mode requires either "dark" or "activation"',
    };
  }
  return {
    healthUrl: healthUrl ?? null,
    webhookEventTypesFile: webhookEventTypesFile ?? null,
    bypassSecretEnv: bypassSecretEnv ?? null,
    mode: requestedMode,
    error: null,
  };
}

function readVercelCrons(): VercelCronEntry[] {
  const raw = fs.readFileSync(path.join(repositoryRoot, 'vercel.json'), 'utf8');
  const parsed = JSON.parse(raw) as { crons?: VercelCronEntry[] };
  return Array.isArray(parsed.crons) ? parsed.crons : [];
}

function readProvisionedWebhookEndpoint(file: string | null): ProvisionedBillingWebhookEndpoint | undefined {
  if (file === null) {
    return undefined;
  }
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (
      typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)
      || typeof (parsed as { id?: unknown }).id !== 'string'
      || typeof (parsed as { url?: unknown }).url !== 'string'
      || typeof (parsed as { livemode?: unknown }).livemode !== 'boolean'
      || (parsed as { status?: unknown }).status !== 'enabled'
      || !Array.isArray((parsed as { enabled_events?: unknown }).enabled_events)
      || !(parsed as { enabled_events: unknown[] }).enabled_events.every(type => typeof type === 'string')
    ) {
      throw new Error('invalid endpoint evidence');
    }
    return parsed as ProvisionedBillingWebhookEndpoint;
  } catch {
    process.stderr.write('[warn] endpoint evidence could not be read or validated\n');
    process.exitCode = 4;
    return undefined;
  }
}

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

export async function fetchHealthBilling(
  url: string,
  bypassSecret: string | null,
  fetchImpl: HealthFetch = fetch as unknown as HealthFetch,
): Promise<BillingReadinessHealthBilling | null> {
  try {
    const headers: Record<string, string> = {};
    if (bypassSecret !== null) {
      headers[BYPASS_HEADER] = bypassSecret;
    }
    // Do not replay an automation-bypass header to a redirect target.
    const response = await fetchImpl(url, { method: 'GET', headers, redirect: 'manual', signal: AbortSignal.timeout(10_000) });
    if (isRedirect(response.status)) {
      process.stderr.write(`[warn] --health-url returned HTTP ${response.status}; redirected health evidence is rejected\n`);
      return null;
    }
    if (!response.ok) {
      process.stderr.write(`[warn] --health-url returned HTTP ${response.status}; skipping health cross-check\n`);
      return null;
    }
    const body = await response.json() as { billing?: unknown; schemaDrift?: unknown };
    const billing = body.billing as { dark?: unknown; planEnvMatchesRuntime?: unknown } | undefined;
    if (
      !billing
      || typeof billing.dark !== 'boolean'
      || typeof billing.planEnvMatchesRuntime !== 'boolean'
    ) {
      process.stderr.write('[warn] --health-url response has no well-formed `billing` block; skipping health cross-check\n');
      return null;
    }
    if (body.schemaDrift !== 'ready') {
      process.stderr.write('[warn] --health-url schema readiness is not ready\n');
      return null;
    }
    process.stdout.write(`health.billing = {"dark":${billing.dark},"planEnvMatchesRuntime":${billing.planEnvMatchesRuntime},"schemaDrift":"ready"}\n`);
    return { dark: billing.dark, planEnvMatchesRuntime: billing.planEnvMatchesRuntime, schemaDrift: 'ready' };
  } catch {
    process.stderr.write('[warn] --health-url request failed\n');
    return null;
  }
}

export async function main(): Promise<void> {
  const args = parseReadinessArguments(process.argv.slice(2));
  if (args.error !== null) {
    process.stderr.write(`${args.error}\n`);
    process.exitCode = 4;
    return;
  }
  const { healthUrl, webhookEventTypesFile, bypassSecretEnv, mode } = args;
  if (healthUrl !== null) {
    try {
      const parsed = new URL(healthUrl);
      if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.search || parsed.hash) {
        throw new Error('unsafe health URL');
      }
    } catch {
      process.stderr.write('[warn] --health-url must be an HTTPS URL without credentials, query, or fragment\n');
      process.exitCode = 4;
      return;
    }
  }

  const vercelCrons = readVercelCrons();
  const bypassSecret = bypassSecretEnv === null ? null : process.env[bypassSecretEnv] || null;
  const bypassUnavailable = bypassSecretEnv !== null && bypassSecret === null;
  if (bypassUnavailable) {
    process.stderr.write(`[warn] --bypass-secret-env named ${bypassSecretEnv}, which is unset or empty\n`);
  }
  const healthBilling = healthUrl && !bypassUnavailable
    ? await fetchHealthBilling(healthUrl, bypassSecret) ?? undefined
    : undefined;
  const provisionedWebhookEndpoint = readProvisionedWebhookEndpoint(webhookEventTypesFile);

  const result = runBillingReadinessCheck({
    env: process.env,
    vercelCrons,
    provisionedWebhookEndpoint,
    expectedWebhookUrl: healthUrl === null ? undefined : new URL('/api/webhooks/stripe-billing', healthUrl).toString(),
    healthBilling,
  });

  const requestedHealthFailed = healthUrl !== null && healthBilling === undefined;
  const finalResult = requestedHealthFailed
    ? { ...result, readyForDarkDeploy: false, readyForActivation: false }
    : result;

  process.stdout.write(`${JSON.stringify(finalResult, null, 2)}\n`);

  process.stdout.write('\n--- billing readiness summary ---\n');
  for (const check of finalResult.checks) {
    process.stdout.write(`[${check.ok ? 'OK  ' : 'FAIL'}] ${check.id}: ${check.detail}\n`);
  }
  process.stdout.write(`readyForDarkDeploy:  ${finalResult.readyForDarkDeploy}\n`);
  process.stdout.write(`readyForActivation:  ${finalResult.readyForActivation}\n`);

  if (requestedHealthFailed) {
    process.stderr.write('[warn] requested deployment health evidence was unavailable; readiness is not confirmed\n');
  }
  const selectedModeReady = mode === 'dark'
    ? finalResult.readyForDarkDeploy
    : finalResult.readyForActivation;
  process.exitCode = selectedModeReady && !requestedHealthFailed && process.exitCode !== 4 ? 0 : 4;
}

const invokedDirectly = process.argv[1] !== undefined
  && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (invokedDirectly) {
  void main();
}
