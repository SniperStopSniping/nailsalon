#!/usr/bin/env tsx
/**
 * P8c read-only billing production-readiness check.
 *
 * Governing contract: docs/luster-billing-communications-rev-2-2.md §12,
 * §20. Plan: docs/luster-billing-remaining-work-plan.md §5 "P8c". Runbook:
 * docs/BILLING_PRODUCTION_RUNBOOK.md.
 *
 * Reads `process.env` and `vercel.json` (never mutates either). Optionally
 * fetches `--health-url <url>` with ONE GET request and prints/consults only
 * the response's `billing` block — every other field is discarded and
 * nothing is sent besides the request itself. Never makes a Stripe call,
 * never touches the database, never prints a secret VALUE (only presence,
 * distinctness and catalogue KEY names — see readinessCheck.ts's header).
 *
 * Usage:
 *   npx tsx scripts/billing-readiness-check.ts
 *   npx tsx scripts/billing-readiness-check.ts --health-url https://www.lustergel.app/api/health
 *
 * Exit code: 0 when readyForDarkDeploy, 4 otherwise. Never exits non-zero
 * for a network/health-fetch failure alone — that degrades to "health cross
 * -check skipped", printed as a warning, not a hard failure.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { BILLING_WEBHOOK_HANDLED_TYPES } from '../src/libs/billing/billingWebhookEvents';
import type { BillingReadinessHealthBilling, VercelCronEntry } from '../src/libs/billing/readinessCheck';
import { runBillingReadinessCheck } from '../src/libs/billing/readinessCheck';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function parseArguments(argv: readonly string[]): { healthUrl: string | null } {
  const flagIndex = argv.indexOf('--health-url');
  if (flagIndex === -1) {
    return { healthUrl: null };
  }
  const value = argv[flagIndex + 1];
  if (!value) {
    process.stderr.write('--health-url requires a value\n');
    process.exitCode = 4;
    return { healthUrl: null };
  }
  return { healthUrl: value };
}

function readVercelCrons(): VercelCronEntry[] {
  const raw = fs.readFileSync(path.join(repositoryRoot, 'vercel.json'), 'utf8');
  const parsed = JSON.parse(raw) as { crons?: VercelCronEntry[] };
  return Array.isArray(parsed.crons) ? parsed.crons : [];
}

async function fetchHealthBilling(url: string): Promise<BillingReadinessHealthBilling | null> {
  try {
    const response = await fetch(url, { method: 'GET' });
    if (!response.ok) {
      process.stderr.write(`[warn] --health-url returned HTTP ${response.status}; skipping health cross-check\n`);
      return null;
    }
    const body = await response.json() as { billing?: unknown };
    const billing = body.billing as { dark?: unknown; planEnvMatchesRuntime?: unknown } | undefined;
    if (
      !billing
      || typeof billing.dark !== 'boolean'
      || typeof billing.planEnvMatchesRuntime !== 'boolean'
    ) {
      process.stderr.write('[warn] --health-url response has no well-formed `billing` block; skipping health cross-check\n');
      return null;
    }
    process.stdout.write(`health.billing = ${JSON.stringify(billing)}\n`);
    return { dark: billing.dark, planEnvMatchesRuntime: billing.planEnvMatchesRuntime };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown error';
    process.stderr.write(`[warn] --health-url request failed (${message}); skipping health cross-check\n`);
    return null;
  }
}

async function main(): Promise<void> {
  const { healthUrl } = parseArguments(process.argv.slice(2));
  if (process.exitCode) {
    return;
  }

  const vercelCrons = readVercelCrons();
  const healthBilling = healthUrl ? await fetchHealthBilling(healthUrl) ?? undefined : undefined;

  const result = runBillingReadinessCheck({
    env: process.env,
    vercelCrons,
    handledEventTypes: BILLING_WEBHOOK_HANDLED_TYPES,
    healthBilling,
  });

  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);

  process.stdout.write('\n--- billing readiness summary ---\n');
  for (const check of result.checks) {
    process.stdout.write(`[${check.ok ? 'OK  ' : 'FAIL'}] ${check.id}: ${check.detail}\n`);
  }
  process.stdout.write(`readyForDarkDeploy:  ${result.readyForDarkDeploy}\n`);
  process.stdout.write(`readyForActivation:  ${result.readyForActivation}\n`);

  process.exitCode = result.readyForDarkDeploy ? 0 : 4;
}

void main();
