import 'server-only';

import { and, eq, isNull } from 'drizzle-orm';

import type { db } from '@/libs/DB';
import { customerPaymentWorkspacePolicyAuditSchema, customerPaymentWorkspacePolicySchema } from '@/models/customerPaymentWorkspaceSchema';
import { adminSalonMembershipSchema, salonSchema, salonStripeAccountSchema } from '@/models/Schema';

import { workspacePolicyWriteSchema } from '../workspacePolicy';
import type { CustomerPaymentTransaction } from './preparationRepository';
import { customerPaymentFingerprint } from './preparationRepository';
import { paymentProviderBindingSchema, workspaceFailure } from './workspaceContract';

export type WorkspaceRuntime = {
  executionEnabled: boolean;
  platformAccountId: string;
  livemode: boolean;
  returnOrigin: string;
};
type Policy = typeof customerPaymentWorkspacePolicySchema.$inferSelect;

function display(policy: Policy | undefined) {
  return {
    revision: policy?.revision ?? 0,
    enabled: policy?.enabled ?? false,
    cancellationPolicy: policy?.cancellationPolicy ?? '',
    mode: 'optional_full' as const,
    platformFeeCents: 0,
    feePayer: 'salon' as const,
  };
}

/** Locks the saved activation and account identity until the dispatch commits. */
export async function readWorkspaceBinding(tx: CustomerPaymentTransaction, salonId: string, runtime: WorkspaceRuntime) {
  const [salon] = await tx.select({ active: salonSchema.isActive, deletedAt: salonSchema.deletedAt }).from(salonSchema).where(eq(salonSchema.id, salonId)).for('share').limit(1);
  const [policy] = await tx.select().from(customerPaymentWorkspacePolicySchema).where(eq(customerPaymentWorkspacePolicySchema.salonId, salonId)).for('share').limit(1);
  if (!runtime.executionEnabled || !salon?.active || salon.deletedAt !== null || !policy?.enabled
    || policy.livemode !== runtime.livemode || policy.platformAccountId !== runtime.platformAccountId) {
    return null;
  }
  const [binding] = await tx.select().from(salonStripeAccountSchema).where(and(eq(salonStripeAccountSchema.salonId, salonId), eq(salonStripeAccountSchema.id, policy.bindingId!), isNull(salonStripeAccountSchema.revokedAt))).for('share').limit(1);
  if (!binding || binding.livemode !== runtime.livemode || !binding.chargesEnabled || !binding.payoutsEnabled || !binding.detailsSubmitted || binding.disabledReason !== null) {
    return null;
  }
  return paymentProviderBindingSchema.parse({ platformAccountId: runtime.platformAccountId, connectedAccountId: binding.stripeAccountId, bindingId: binding.id, livemode: binding.livemode, currency: 'cad', returnOrigin: runtime.returnOrigin, policyRevision: policy.revision });
}

export function createWorkspacePolicyRepository(database: Pick<typeof db, 'transaction'>) {
  return {
    async read(salonId: string) {
      return database.transaction(async tx => display((await tx.select().from(customerPaymentWorkspacePolicySchema).where(eq(customerPaymentWorkspacePolicySchema.salonId, salonId)).limit(1))[0]));
    },
    async write(salonId: string, actorId: string, value: unknown, runtime: WorkspaceRuntime) {
      const input = workspacePolicyWriteSchema.parse(value);
      const requestHash = customerPaymentFingerprint({ ...input, actorId, salonId });
      return database.transaction(async (tx) => {
        // Serializes an initial insert as well as concurrent changes; never locks
        // appointments here, so it cannot invert the checkout lock order.
        const [salon] = await tx.select().from(salonSchema).where(eq(salonSchema.id, salonId)).for('update').limit(1);
        const [owner] = await tx.select().from(adminSalonMembershipSchema).where(and(eq(adminSalonMembershipSchema.salonId, salonId), eq(adminSalonMembershipSchema.adminId, actorId), eq(adminSalonMembershipSchema.role, 'owner'))).for('share').limit(1);
        if (!owner || !salon) {
          return workspaceFailure('PAYMENT_WORKSPACE_OWNER_REQUIRED');
        }
        const [replay] = await tx.select().from(customerPaymentWorkspacePolicyAuditSchema).where(and(eq(customerPaymentWorkspacePolicyAuditSchema.salonId, salonId), eq(customerPaymentWorkspacePolicyAuditSchema.requestId, input.requestId))).limit(1);
        if (replay) {
          if (replay.actorId !== actorId || replay.requestHash !== requestHash) {
            return workspaceFailure('PAYMENT_WORKSPACE_REQUEST_CONFLICT');
          }
          return { revision: replay.revision, enabled: replay.snapshot.enabled === true, cancellationPolicy: String(replay.snapshot.cancellation_policy), mode: 'optional_full' as const, platformFeeCents: 0, feePayer: 'salon' as const };
        }
        const [current] = await tx.select().from(customerPaymentWorkspacePolicySchema).where(eq(customerPaymentWorkspacePolicySchema.salonId, salonId)).for('update').limit(1);
        if ((current?.revision ?? 0) !== input.expectedRevision) {
          return workspaceFailure('PAYMENT_WORKSPACE_POLICY_STALE');
        }
        let bindingId = current?.bindingId ?? null;
        if (input.enabled) {
          const [binding] = await tx.select().from(salonStripeAccountSchema).where(and(eq(salonStripeAccountSchema.salonId, salonId), isNull(salonStripeAccountSchema.revokedAt))).for('share').limit(1);
          if (!runtime.executionEnabled || !salon.isActive || salon.deletedAt !== null || !/^acct_[A-Za-z0-9]+$/.test(runtime.platformAccountId)
            || !binding || binding.livemode !== runtime.livemode || !binding.chargesEnabled || !binding.payoutsEnabled || !binding.detailsSubmitted || binding.disabledReason !== null) {
            return workspaceFailure('PAYMENT_WORKSPACE_CONNECT_SETUP_REQUIRED');
          }
          bindingId = binding.id;
        }
        const next = { salonId, revision: input.expectedRevision + 1, enabled: input.enabled, cancellationPolicy: input.cancellationPolicy, bindingId, platformAccountId: input.enabled ? runtime.platformAccountId : current?.platformAccountId ?? null, livemode: input.enabled ? runtime.livemode : current?.livemode ?? runtime.livemode, actorId, requestId: input.requestId, requestHash };
        const [saved] = current
          ? await tx.update(customerPaymentWorkspacePolicySchema).set(next).where(eq(customerPaymentWorkspacePolicySchema.salonId, salonId)).returning()
          : await tx.insert(customerPaymentWorkspacePolicySchema).values(next).returning();
        return display(saved);
      });
    },
  };
}
