/**
 * P8a super-admin operator endpoint — G22 (plan §5 P8a; contract §3.1,
 * §7.3, §20 step 6, §21 step 9): grant the one-time 100-credit starter
 * allowance to a pre-existing salon whose business identity never went
 * through the live onboarding grant call site
 * (`src/app/api/onboarding/luster/route.ts`).
 *
 * Replaces `scripts/grant-starter-credits.ts` (deleted): that tsx CLI was
 * structurally unrunnable for a real (non---help) invocation — the live
 * `creditGrants.ts` it must reuse has a module-scope `import { db } from
 * '@/libs/DB'`, and `DB.ts` has genuine top-level `await`; under this
 * repository's CommonJS-default `package.json`, tsx/esbuild cannot compile
 * that nested import (top-level await is not valid CJS output). Inside the
 * Next.js server process this is a non-issue — the bundler handles it the
 * same way it handles every other billing route — so this endpoint reuses
 * the exact same `src/libs/billing/starterGrantBackfill.ts` library the CLI
 * used, unedited, with no such limitation. A pilot prerequisite (§21 step 9)
 * cannot depend on a tool that cannot run.
 *
 * Deliberately NOT under `src/app/api/billing`: this is a super-admin-only
 * operator action, not a public or tenant-facing billing surface, so it
 * needs no CI byte-freeze / 8-path allowlist entry (`CI.yml` only enumerates
 * paths under `src/app/api/billing`).
 *
 * No `BILLING_*` switch gate: a starter grant IS the §20 step-6 dark action
 * itself — the runbook step that seeds a pilot salon's credits BEFORE
 * `BILLING_SUBSCRIPTIONS_ENABLED` / `BILLING_TOPUPS_ENABLED` /
 * `PUBLIC_PRICING_ENABLED` are ever set. Gating this endpoint behind those
 * switches would make the pilot prerequisite depend on the very switches it
 * must precede. Guarded instead by `requireSuperAdmin()` (only), rate
 * limiting, and — for `apply` — a typed confirmation that must exactly
 * match the salon slug.
 *
 * Operator procedure: log in to `/super-admin`, then from that page's
 * browser console:
 *
 *   fetch('/api/super-admin/billing/starter-grant', {
 *     method: 'POST',
 *     headers: { 'content-type': 'application/json' },
 *     body: JSON.stringify({ salonSlug: '<slug>', mode: 'plan' }),
 *   }).then(r => r.json())
 *
 * Review the plan (`alreadyGranted`/`wouldGrant`), then repeat with
 * `{ salonSlug: '<slug>', mode: 'apply', confirmation: '<slug>' }`. A second
 * `apply` is a no-op (`granted: false`) — never a duplicate grant. Never run
 * `apply` against production without written owner authorization (contract
 * §20 step 6). (The runbook doc is updated separately, on another branch.)
 */
import * as Sentry from '@sentry/nextjs';
import { z } from 'zod';

import { requireSuperAdmin } from '@/libs/adminAuth';
import {
  applyStarterGrantBackfill,
  planStarterGrantBackfill,
  StarterGrantBackfillError,
} from '@/libs/billing/starterGrantBackfill';
import { db } from '@/libs/DB';
import { checkEndpointRateLimit, getClientIp, rateLimitResponse } from '@/libs/rateLimit';

const ENDPOINT_KEY = 'super-admin/billing/starter-grant';

const requestSchema = z.object({
  salonSlug: z.string().trim().min(1),
  mode: z.enum(['plan', 'apply']),
  confirmation: z.string().optional(),
}).strict();

function errorJson(status: number, code: string, message: string): Response {
  return Response.json({ error: { code, message } }, { status });
}

export async function POST(request: Request): Promise<Response> {
  // 1. Auth — first, ahead of rate limiting or any body parsing.
  const guard = await requireSuperAdmin();
  if (!guard.ok) {
    return guard.response;
  }

  // 2. The same generic endpoint rate limiter the billing checkout/top-up
  // routes use (`checkEndpointRateLimit` + `BILLING` preset).
  const ip = getClientIp(request);
  const rateLimit = checkEndpointRateLimit(ENDPOINT_KEY, ip, 'BILLING');
  if (!rateLimit.allowed) {
    return rateLimitResponse(rateLimit.retryAfterMs);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorJson(400, 'INVALID_INPUT', 'Request body must be valid JSON.');
  }

  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) {
    return errorJson(
      400,
      'INVALID_INPUT',
      'salonSlug (string) and mode ("plan" | "apply") are required.',
    );
  }
  const { salonSlug, mode, confirmation } = parsed.data;

  // 3. Typed confirmation — apply only, must exactly match the slug.
  if (mode === 'apply' && confirmation !== salonSlug) {
    return errorJson(
      400,
      'CONFIRMATION_REQUIRED',
      'apply requires confirmation to exactly match salonSlug.',
    );
  }

  try {
    if (mode === 'plan') {
      const plan = await planStarterGrantBackfill(db, { salonSlug });
      return Response.json(plan);
    }

    const result = await applyStarterGrantBackfill(db, {
      salonSlug,
      actorId: guard.admin.id,
    });
    return Response.json(result);
  } catch (error) {
    if (error instanceof StarterGrantBackfillError) {
      if (error.code === 'SALON_NOT_FOUND') {
        return errorJson(404, 'SALON_NOT_FOUND', 'No salon with that slug was found.');
      }
      // SALON_DELETED
      return errorJson(409, 'SALON_DELETED', 'This salon has been deleted.');
    }

    // Every other failure is masked — no raw error message ever reaches the
    // response body, only the salon slug (never Stripe ids, never amounts,
    // never identity fingerprints) reaches Sentry.
    Sentry.captureException(error, {
      tags: { endpoint: ENDPOINT_KEY },
      extra: { salonSlug, mode },
    });
    return errorJson(
      500,
      'STARTER_GRANT_ERROR',
      'The starter-grant operation could not be completed.',
    );
  }
}
