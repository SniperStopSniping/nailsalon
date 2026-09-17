/**
 * New-track Stripe customer identity — the `billing_customer` resolver.
 *
 * Governing design: FINAL_IMPLEMENTATION_HANDOFF.md §3 (all of it). Migration
 * `0079_billing_customer.sql` owns the two indexes this module leans on.
 *
 * THE ENVIRONMENT FENCE IS WHY THIS FILE EXISTS. This deployment family shares
 * ONE database between development and production (Preview uses a separate
 * project), so a Stripe Customer created in test mode must never be reachable
 * by a live-mode deployment. That is enforced twice, and both halves are
 * load-bearing:
 *
 *   1. the `(salon_id, plan_env)` unique index, with every read filtered by the
 *      runtime's `BILLING_PLAN_ENV`; and
 *   2. a livemode verification against Stripe before an existing subscription's
 *      customer is adopted — because `billing_subscription` rows for one salon
 *      may have been written by a dev deployment against the same database.
 *
 * TWO ENTRY POINTS, DELIBERATELY SEPARATE, so a read surface (the Billing
 * Portal, a projection guard) can never mint a Stripe Customer:
 * {@link findBillingCustomer} never creates one under any input;
 * {@link resolveOrCreateBillingCustomer} is for checkout paths only.
 *
 * `salon.stripeCustomerId` — the legacy column — is NEVER consulted here, which
 * is why this module does not import `salonSchema` at all. The legacy column is
 * not new-track evidence (it is written by the legacy webhook and is exactly
 * the leak D19c closes), so a genuine legacy salon joining the new track gets
 * its own separate new-track Customer. The owner has accepted that.
 */
import 'server-only';

import * as Sentry from '@sentry/nextjs';
import { and, eq, sql } from 'drizzle-orm';

import { logAuditEventTx } from '@/libs/auditLog';
import { db } from '@/libs/DB';
import { Env } from '@/libs/Env';
import { computeExpectedLivemode } from '@/libs/environmentIsolation';
import { stripe } from '@/libs/stripe';
import { billingCustomerSchema, billingSubscriptionSchema } from '@/models/Schema';

import type { BillingDbTransaction } from './creditLedger';

/**
 * A drizzle handle that can read and write: either the module-level `db` or a
 * caller's open transaction. Reads and the adoption write both go through the
 * handle the caller supplied, so a caller already inside a transaction keeps
 * one unit of work (and cannot deadlock this module's foreign-key lock on
 * `salon` against its own `FOR UPDATE`).
 */
export type BillingCustomerDb = Pick<BillingDbTransaction, 'select' | 'insert' | 'transaction'>;

export type BillingCustomerRecord = {
  id: string;
  salonId: string;
  planEnv: string;
  stripeCustomerId: string;
  source: 'created' | 'adopted_subscription';
};

export type BillingCustomerErrorCode
  = | 'CUSTOMER_TENANT_CONFLICT'
  | 'CUSTOMER_ENVIRONMENT_MISMATCH';

const ERROR_MESSAGES: Record<BillingCustomerErrorCode, string> = {
  CUSTOMER_TENANT_CONFLICT:
    'Billing customer rejected: that Stripe Customer already belongs to another salon.',
  CUSTOMER_ENVIRONMENT_MISMATCH:
    'Billing customer rejected: this deployment cannot attest its Stripe environment.',
};

export class BillingCustomerError extends Error {
  readonly code: BillingCustomerErrorCode;

  constructor(code: BillingCustomerErrorCode) {
    super(ERROR_MESSAGES[code]);
    this.name = 'BillingCustomerError';
    this.code = code;
  }
}

/** The Stripe idempotency key for a salon's first new-track customer. */
export function buildBillingCustomerIdempotencyKey(input: {
  planEnv: string;
  salonId: string;
}): string {
  return `billing-customer:${input.planEnv}:${input.salonId}:v1`;
}

const MAPPING_COLUMNS = {
  id: billingCustomerSchema.id,
  salonId: billingCustomerSchema.salonId,
  planEnv: billingCustomerSchema.planEnv,
  stripeCustomerId: billingCustomerSchema.stripeCustomerId,
  source: billingCustomerSchema.source,
} as const;

type MappingRow = {
  id: string;
  salonId: string;
  planEnv: string;
  stripeCustomerId: string;
  source: string;
};

function toRecord(row: MappingRow): BillingCustomerRecord {
  return {
    id: row.id,
    salonId: row.salonId,
    planEnv: row.planEnv,
    stripeCustomerId: row.stripeCustomerId,
    // The database CHECK constraint is the authority; this narrows the column's
    // free text to the union the callers see.
    source: row.source as BillingCustomerRecord['source'],
  };
}

/**
 * The runtime's billing plan environment — the same single source of truth
 * `stripePriceMap.ts` selects its price column from.
 */
function currentPlanEnv(): 'dev' | 'test' | 'prod' {
  return Env.BILLING_PLAN_ENV;
}

function isUniqueViolation(error: unknown): boolean {
  const candidate = error as { code?: string; cause?: { code?: string } } | null;
  return candidate?.code === '23505' || candidate?.cause?.code === '23505';
}

function stripeErrorShape(error: unknown): { code?: string; type?: string } {
  return (error ?? {}) as { code?: string; type?: string };
}

function isDefiniteMissingStripeResource(error: unknown): boolean {
  return stripeErrorShape(error).code === 'resource_missing';
}

function isStripeIdempotencyError(error: unknown): boolean {
  const candidate = stripeErrorShape(error);
  return candidate.type === 'StripeIdempotencyError'
    || candidate.type === 'idempotency_error'
    || candidate.code === 'idempotency_key_in_use';
}

// =============================================================================
// STEP 1 — the mapping itself
// =============================================================================

async function selectMapping(
  handle: BillingCustomerDb,
  salonId: string,
  planEnv: 'dev' | 'test' | 'prod',
): Promise<BillingCustomerRecord | null> {
  const rows = await handle
    .select(MAPPING_COLUMNS)
    .from(billingCustomerSchema)
    .where(and(
      eq(billingCustomerSchema.salonId, salonId),
      eq(billingCustomerSchema.planEnv, planEnv),
    ))
    .limit(1);

  return rows[0] ? toRecord(rows[0]) : null;
}

async function selectMappingByStripeCustomerId(
  stripeCustomerId: string,
): Promise<BillingCustomerRecord | null> {
  const rows = await db
    .select(MAPPING_COLUMNS)
    .from(billingCustomerSchema)
    .where(eq(billingCustomerSchema.stripeCustomerId, stripeCustomerId))
    .limit(1);

  return rows[0] ? toRecord(rows[0]) : null;
}

/**
 * Insert the mapping, tolerating the concurrent winner and failing closed on the
 * tenant fence.
 *
 * `ON CONFLICT (salon_id, plan_env) DO NOTHING` is deliberately TARGETED: a
 * bare `DO NOTHING` would also swallow a `billing_customer_stripe_uniq`
 * violation, which is precisely the event that must be loud. With the target in
 * place, a 23505 escaping this insert can only be the global
 * `stripe_customer_id` fence.
 *
 * Returns `{ won: false }` when a concurrent request inserted first.
 */
async function insertMapping(
  handle: BillingCustomerDb,
  values: {
    salonId: string;
    planEnv: 'dev' | 'test' | 'prod';
    stripeCustomerId: string;
    source: BillingCustomerRecord['source'];
  },
): Promise<{ won: boolean; record: BillingCustomerRecord }> {
  const id = `bcus_${crypto.randomUUID()}`;
  let inserted: MappingRow | null;

  try {
    // One unit of work: a committed mapping without its audit row would leave
    // nothing behind once the salon is purged and the mapping cascades away.
    // Given a caller's transaction this opens a SAVEPOINT, so a tenant conflict
    // raised here does not poison the caller's own work.
    inserted = await handle.transaction(async (tx) => {
      const rows = await tx
        .insert(billingCustomerSchema)
        .values({
          id,
          salonId: values.salonId,
          planEnv: values.planEnv,
          stripeCustomerId: values.stripeCustomerId,
          source: values.source,
        })
        .onConflictDoNothing({
          target: [billingCustomerSchema.salonId, billingCustomerSchema.planEnv],
        })
        .returning();

      const row = rows[0];
      if (!row) {
        // A concurrent request inserted first; the conflict target absorbed
        // ours. No audit row, because this insert did not win.
        return null;
      }

      // `audit_log` rows survive a salon purge with `salon_id` nulled, so this
      // is the durable record of which Stripe Customer belonged to this salon
      // after the mapping row itself is gone.
      await logAuditEventTx(tx, {
        salonId: values.salonId,
        actorType: 'system',
        actorId: 'billing-customer',
        action: 'billing_customer_created',
        entityType: 'billing_customer',
        entityId: row.id,
        metadata: {
          stripeCustomerId: values.stripeCustomerId,
          source: values.source,
          planEnv: values.planEnv,
        },
      });

      return row;
    });
  } catch (error) {
    if (!isUniqueViolation(error)) {
      throw error;
    }

    // Classify by RE-READING OBSERVED STATE, never by constraint name —
    // `error.constraint` surfacing through every driver this repo runs on is
    // unverified. The read goes through the module-level `db` on purpose: if
    // `handle` was a caller's transaction, the failed statement has already
    // aborted it and any further query on it would raise 25P02.
    const owner = await selectMappingByStripeCustomerId(values.stripeCustomerId);
    if (
      owner
      && owner.salonId === values.salonId
      && owner.planEnv === values.planEnv
    ) {
      // Our own write landed twice. Idempotent success, nothing re-tenanted.
      return { won: false, record: owner };
    }

    // The Stripe Customer belongs to ANOTHER salon (or to this salon in another
    // plan environment). Never overwrite, never re-tenant. Any other 23505
    // shape lands here too, deliberately.
    throw new BillingCustomerError('CUSTOMER_TENANT_CONFLICT');
  }

  if (inserted) {
    return { won: true, record: toRecord(inserted) };
  }

  const winner = await selectMapping(handle, values.salonId, values.planEnv);
  if (!winner) {
    throw new Error('billing_customer insert conflicted but no mapping is present');
  }
  return { won: false, record: winner };
}

// =============================================================================
// STEP 2 — adoption from verified, environment-matching new-track evidence
// =============================================================================

/**
 * The ONLY permitted adoption source: `billing_subscription.stripe_customer_id`
 * for this salon, preferring a live row and then the most recently updated.
 * Rows exist there only for `purpose=plan_subscription` objects, so this is
 * new-track evidence by construction — unlike `salon.stripeCustomerId`.
 */
async function selectAdoptionCandidate(
  handle: BillingCustomerDb,
  salonId: string,
): Promise<string | null> {
  const rows = await handle
    .select({ stripeCustomerId: billingSubscriptionSchema.stripeCustomerId })
    .from(billingSubscriptionSchema)
    .where(eq(billingSubscriptionSchema.salonId, salonId))
    .orderBy(
      sql`(${billingSubscriptionSchema.status} not in ('canceled', 'incomplete_expired')) desc`,
      sql`${billingSubscriptionSchema.updatedAt} desc`,
    )
    .limit(1);

  return rows[0]?.stripeCustomerId ?? null;
}

/**
 * Environment verification — the whole point of the owner's
 * "environment-matching" condition.
 *
 * Returns `true` only when Stripe itself reports the customer in the livemode
 * this deployment expects. A deleted customer answers with `DeletedCustomer`,
 * which carries no `livemode` at all, so it reads as a mismatch and is never
 * adopted — the intended fail-closed outcome.
 *
 * Throws (retryable) when Stripe fails, because evidence we could not read is
 * not evidence. Throws `CUSTOMER_ENVIRONMENT_MISMATCH` when this deployment
 * cannot attest its own expected livemode: we then know nothing about the
 * candidate, and silently creating a second customer in an environment whose
 * markers disagree with its key would be adopting-by-omission.
 */
async function candidateMatchesEnvironment(
  stripeCustomerId: string,
  salonId: string,
): Promise<boolean> {
  const expected = computeExpectedLivemode(process.env);
  if (!expected.ok) {
    throw new BillingCustomerError('CUSTOMER_ENVIRONMENT_MISMATCH');
  }

  // Never swallowed: a Stripe failure must surface as a retryable error rather
  // than adopt on unverified evidence, and must not fall through to creating a
  // second customer either.
  let customer: Awaited<ReturnType<typeof stripe.customers.retrieve>>;
  try {
    customer = await stripe.customers.retrieve(stripeCustomerId);
  } catch (error) {
    // A Customer from the other Stripe mode is `resource_missing` under this
    // deployment's key. That is definite non-adoptable evidence, not an
    // outage: the create path may mint its own environment-scoped Customer and
    // the Portal may continue to its legacy fallback. Transient failures still
    // throw so they can never cause adoption-by-omission.
    if (isDefiniteMissingStripeResource(error)) {
      return false;
    }
    throw error;
  }
  const candidate = customer as {
    livemode?: boolean;
    metadata?: Record<string, string | undefined>;
  };
  const metadata = candidate.metadata ?? {};
  const deploymentMarker = Env.BILLING_DEPLOYMENT_MARKER;
  const metadataContradictsRuntime
    = (metadata.salonId !== undefined && metadata.salonId !== salonId)
    || (metadata.planEnv !== undefined && metadata.planEnv !== currentPlanEnv())
    || (
      deploymentMarker !== undefined
      && metadata.luster_deployment !== undefined
      && metadata.luster_deployment !== deploymentMarker
    );

  if (candidate.livemode === expected.livemode && !metadataContradictsRuntime) {
    return true;
  }

  Sentry.captureMessage('billing.customer_adoption_environment_mismatch', {
    level: 'warning',
    tags: { integration: 'stripe-billing' },
    extra: {
      salonId,
      stripeCustomerId,
      expectedLivemode: expected.livemode,
      observedLivemode: candidate.livemode ?? null,
      observedPlanEnv: metadata.planEnv ?? null,
      observedSalonId: metadata.salonId ?? null,
      observedDeploymentMarker: metadata.luster_deployment ?? null,
    },
  });
  return false;
}

/**
 * Steps 1–2, shared by both entry points. Returns `null` when there is no
 * mapping and nothing adoptable — the create path's cue, and the read path's
 * answer.
 */
async function findOrAdopt(
  handle: BillingCustomerDb,
  salonId: string,
  planEnv: 'dev' | 'test' | 'prod',
): Promise<BillingCustomerRecord | null> {
  const existing = await selectMapping(handle, salonId, planEnv);
  if (existing) {
    return existing;
  }

  const candidate = await selectAdoptionCandidate(handle, salonId);
  if (!candidate) {
    return null;
  }

  if (!await candidateMatchesEnvironment(candidate, salonId)) {
    return null;
  }

  const { record } = await insertMapping(handle, {
    salonId,
    planEnv,
    stripeCustomerId: candidate,
    source: 'adopted_subscription',
  });
  return record;
}

// =============================================================================
// ENTRY POINTS
// =============================================================================

/**
 * READ-ONLY with respect to Stripe: this never creates a Customer under any
 * input. It may call `stripe.customers.retrieve` once, and only to verify the
 * environment of an adoption candidate before recording it.
 *
 * A livemode mismatch, a deleted customer, or no new-track evidence at all all
 * answer `null`; the caller decides what to do with that (the Billing Portal
 * falls back to the legacy column, which this module never reads).
 */
export async function findBillingCustomer(
  dbOrTx: BillingCustomerDb,
  input: { salonId: string },
): Promise<BillingCustomerRecord | null> {
  return findOrAdopt(dbOrTx, input.salonId, currentPlanEnv());
}

/**
 * Checkout paths only. May create a Stripe Customer.
 *
 * The Stripe call happens OUTSIDE any database transaction and while holding no
 * row lock, which is why this entry point owns the module-level `db` rather than
 * accepting a caller's handle: a network call inside the caller's attempt
 * transaction would hold its locks across Stripe's latency.
 */
export async function resolveOrCreateBillingCustomer(input: {
  salonId: string;
  email: string | null;
  name: string | null;
}): Promise<BillingCustomerRecord> {
  const planEnv = currentPlanEnv();

  const resolved = await findOrAdopt(db, input.salonId, planEnv);
  if (resolved) {
    return resolved;
  }

  // Step 3 — create. The idempotency key means a concurrent duplicate request
  // with identical parameters receives the SAME Stripe Customer, so the two
  // requests usually converge before the unique index even arbitrates.
  let customer: Awaited<ReturnType<typeof stripe.customers.create>>;
  try {
    customer = await stripe.customers.create(
      {
        email: input.email ?? undefined,
        name: input.name ?? undefined,
        metadata: {
          purpose: 'luster_billing',
          salonId: input.salonId,
          planEnv,
          ...(Env.BILLING_DEPLOYMENT_MARKER
            ? { luster_deployment: Env.BILLING_DEPLOYMENT_MARKER }
            : {}),
        },
      },
      {
        idempotencyKey: buildBillingCustomerIdempotencyKey({
          planEnv,
          salonId: input.salonId,
        }),
      },
    );
  } catch (error) {
    if (isStripeIdempotencyError(error)) {
      // Concurrent first requests can carry different email/name values under
      // the same stable idempotency key. Stripe rejects the parameter mismatch,
      // but the other request may already have recorded the canonical mapping.
      // Re-read once and reuse that winner; if it has not committed, preserve
      // the retryable provider error for the caller.
      const winner = await selectMapping(db, input.salonId, planEnv);
      if (winner) {
        return winner;
      }
    }
    throw error;
  }

  const { record } = await insertMapping(db, {
    salonId: input.salonId,
    planEnv,
    stripeCustomerId: customer.id,
    source: 'created',
  });

  if (record.stripeCustomerId !== customer.id) {
    // A concurrent request won with a DIFFERENT customer. Return the winner and
    // leave the extra Stripe object in place — no code path deletes customers,
    // and deleting one we might be wrong about is unrecoverable.
    Sentry.captureMessage('billing.customer_create_race_orphan', {
      level: 'info',
      tags: { integration: 'stripe-billing' },
      extra: {
        salonId: input.salonId,
        planEnv,
        orphanedStripeCustomerId: customer.id,
        winningStripeCustomerId: record.stripeCustomerId,
      },
    });
  }

  return record;
}
