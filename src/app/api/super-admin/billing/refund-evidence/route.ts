/**
 * R-2 super-admin operator endpoint — the INV-A8/A10 exit.
 *
 * §6.7 refund evidence is append-only financial state: a fully refunded
 * invoice's exclusion must survive for the subscription's lifetime, and
 * nothing in this system ever deletes an `audit_log` row. That left exactly
 * one dead end before PR-1 — evidence that is WRONG. A legacy
 * `billing_subscription_refund_applied` row with unusable bounds makes every
 * later evidence read `incomplete`, which fails closed: window grants stop,
 * upgrade differences stop, and no automated path can ever undo it. Likewise
 * a refund Stripe later retracted leaves a paying salon's entitlement
 * suppressed if the reversal webhook never arrived.
 *
 * This endpoint is the operator's way out, and it still never deletes
 * anything: it APPENDS a `billing_subscription_refund_evidence_resolved` row
 * that supersedes the effective state for ONE invoice —
 *
 *   - `void` — this invoice is not refunded after all. The coverage captured
 *     before the void is replayed through the ordinary payment transition,
 *     which re-establishes `paid_through` and re-evaluates windows.
 *   - `set`  — this invoice IS refunded and THIS is its authoritative
 *     coverage window (the repair for malformed legacy bounds).
 *
 * Operator procedure — log in to `/super-admin`, then from that page's
 * browser console run `mode: 'plan'` FIRST and read the effective evidence
 * back:
 *
 *   fetch('/api/super-admin/billing/refund-evidence', {
 *     method: 'POST',
 *     headers: { 'content-type': 'application/json' },
 *     body: JSON.stringify({
 *       salonSlug: '<slug>', stripeSubscriptionId: 'sub_...', invoiceId: 'in_...',
 *       resolution: 'void', reason: '<why>', mode: 'plan',
 *     }),
 *   }).then(r => r.json())
 *
 * Then repeat with `mode: 'apply'` and `confirmation: '<the invoice id>'`
 * typed by hand. A `set` additionally requires `periodStart`/`periodEnd` as
 * ISO strings with `start < end`. Never run `apply` against production
 * without written owner authorization.
 *
 * NEVER hand-edit `audit_log` to achieve the same effect: the `seq` ordering
 * this endpoint assigns under the subscription row lock is what makes
 * concurrent corrections deterministic.
 *
 * No `BILLING_*` switch gate by design (the same reasoning as
 * `starter-grant/route.ts`): broken refund evidence is exactly the condition
 * an operator must be able to repair while billing is dark — gating the
 * repair behind the switches it precedes would make it unreachable when it
 * is most needed. Guarded instead by `requireSuperAdmin()`, the shared
 * endpoint rate limiter, and — for `apply` — a typed confirmation that must
 * exactly match the invoice id.
 *
 * Deliberately NOT under `src/app/api/billing`: a super-admin-only operator
 * action, not a tenant-facing billing surface, so it needs no CI byte-freeze
 * / allowlist entry (`CI.yml` only enumerates paths under
 * `src/app/api/billing`).
 */
import * as Sentry from '@sentry/nextjs';
import { eq } from 'drizzle-orm';
import { z } from 'zod';

import { requireSuperAdmin } from '@/libs/adminAuth';
import {
  applySubscriptionRefundEvidenceResolution,
  planSubscriptionRefundEvidence,
} from '@/libs/billing/billingSubscriptionProjection';
import { db } from '@/libs/DB';
import { checkEndpointRateLimit, getClientIp, rateLimitResponse } from '@/libs/rateLimit';
import { salonSchema } from '@/models/Schema';

const ENDPOINT_KEY = 'super-admin/billing/refund-evidence';

const requestSchema = z.object({
  salonSlug: z.string().trim().min(1),
  stripeSubscriptionId: z.string().trim().min(1),
  invoiceId: z.string().trim().min(1),
  resolution: z.enum(['void', 'set']),
  periodStart: z.string().optional(),
  periodEnd: z.string().optional(),
  reason: z.string().trim().min(1).max(500),
  mode: z.enum(['plan', 'apply']),
  confirmation: z.string().optional(),
}).strict();

function errorJson(status: number, code: string, message: string): Response {
  return Response.json({ error: { code, message } }, { status });
}

/** An ISO-8601 instant, or null when the input is absent or unparseable. */
function parseInstant(value: string | undefined): Date | null {
  if (value === undefined) {
    return null;
  }
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
}

export async function POST(request: Request): Promise<Response> {
  // 1. Auth — first, ahead of rate limiting or any body parsing.
  const guard = await requireSuperAdmin();
  if (!guard.ok) {
    return guard.response;
  }

  // 2. The same generic endpoint rate limiter every billing route uses.
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
      'salonSlug, stripeSubscriptionId, invoiceId, resolution ("void" | "set"), reason and mode ("plan" | "apply") are required.',
    );
  }
  const {
    salonSlug,
    stripeSubscriptionId,
    invoiceId,
    resolution,
    reason,
    mode,
    confirmation,
  } = parsed.data;

  // 3. Typed confirmation — apply only, must exactly match the INVOICE id
  // (the thing this resolution actually changes), never the slug.
  if (mode === 'apply' && confirmation !== invoiceId) {
    return errorJson(
      400,
      'CONFIRMATION_REQUIRED',
      'apply requires confirmation to exactly match invoiceId.',
    );
  }

  // 4. A `set` without a valid half-open window would write evidence that
  // reads back as malformed — the very condition this endpoint exists to
  // repair. Rejected before anything is touched.
  const periodStart = parseInstant(parsed.data.periodStart);
  const periodEnd = parseInstant(parsed.data.periodEnd);
  if (resolution === 'set' && (periodStart === null || periodEnd === null || periodStart >= periodEnd)) {
    return errorJson(
      400,
      'INVALID_INPUT',
      'set requires periodStart and periodEnd as valid dates with periodStart < periodEnd.',
    );
  }

  try {
    const [salon] = await db
      .select({ id: salonSchema.id, deletedAt: salonSchema.deletedAt })
      .from(salonSchema)
      .where(eq(salonSchema.slug, salonSlug))
      .limit(1);
    if (salon === undefined) {
      return errorJson(404, 'SALON_NOT_FOUND', 'No salon with that slug was found.');
    }
    if (salon.deletedAt !== null) {
      return errorJson(409, 'SALON_DELETED', 'This salon has been deleted.');
    }

    if (mode === 'plan') {
      const plan = await planSubscriptionRefundEvidence(db, { salonId: salon.id, stripeSubscriptionId });
      if (plan === null) {
        return errorJson(404, 'SUBSCRIPTION_NOT_FOUND', 'No subscription with that id exists for this salon.');
      }
      return Response.json({
        mode: 'plan',
        subscription: { stripeSubscriptionId, paidThrough: plan.paidThrough },
        evidence: plan.evidence,
        intended: {
          invoiceId,
          resolution,
          ...(periodStart !== null ? { periodStart } : {}),
          ...(periodEnd !== null ? { periodEnd } : {}),
          currentlyRefunded: plan.evidence.appliedInvoiceIds.includes(invoiceId),
        },
      });
    }

    const result = await applySubscriptionRefundEvidenceResolution({
      salonId: salon.id,
      stripeSubscriptionId,
      invoiceId,
      resolution,
      ...(resolution === 'set' ? { periodStart: periodStart!, periodEnd: periodEnd! } : {}),
      reason,
      actor: { actorType: 'super_admin', actorId: guard.admin.id },
    });
    if (result.anomaly === 'SUBSCRIPTION_NOT_FOUND') {
      return errorJson(404, 'SUBSCRIPTION_NOT_FOUND', 'No subscription with that id exists for this salon.');
    }
    if (result.anomaly === 'INVALID_RESOLUTION_BOUNDS') {
      return errorJson(400, 'INVALID_INPUT', 'set requires periodStart and periodEnd as valid dates with periodStart < periodEnd.');
    }
    if (!result.applied && resolution === 'void') {
      // Nothing LIVE to void — the invoice is not currently excluded (never
      // was, or a previous void already landed). Not an error the operator
      // caused, but never a success either: answering 200 would let someone
      // believe they had repaired something they had not.
      return errorJson(409, 'NOTHING_TO_VOID', 'This invoice is not currently recorded as refunded.');
    }
    return Response.json({ mode: 'apply', ...result });
  } catch (error) {
    // Every other failure is masked — no raw error message reaches the
    // response body, and only the caller's OWN inputs (slug, mode) reach
    // Sentry: never a Stripe id we discovered, never amounts.
    Sentry.captureException(error, {
      tags: { endpoint: ENDPOINT_KEY },
      extra: { salonSlug, mode },
    });
    return errorJson(
      500,
      'REFUND_EVIDENCE_ERROR',
      'The refund-evidence operation could not be completed.',
    );
  }
}
