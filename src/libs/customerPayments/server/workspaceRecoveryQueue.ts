import 'server-only';

import { randomUUID } from 'node:crypto';

import { integrationOutboxSchema } from '@/models/Schema';

import type { CustomerPaymentTransaction } from './preparationRepository';
import type { PaymentWorkspaceScope } from './workspaceContract';

/** Commit recovery before any provider write; process death cannot lose the job. */
export async function enqueueWorkspaceRecovery(tx: CustomerPaymentTransaction, scope: PaymentWorkspaceScope, operationId: string) {
  await tx.insert(integrationOutboxSchema).values({
    id: randomUUID(),
    ...scope,
    provider: 'internal',
    operation: 'recover_customer_payment',
    dedupeKey: `payment-workspace:${operationId}:recovery`,
    payload: { operationId },
    availableAt: new Date(Date.now() + 5 * 60_000),
  }).onConflictDoNothing();
}
