import 'server-only';

import { randomUUID } from 'node:crypto';

import { integrationOutboxSchema } from '@/models/Schema';

import type { CustomerPaymentTransaction } from './preparationRepository';
import type { PaymentWorkspaceScope } from './workspaceContract';

/** Commit the refresh with money/invoice changes; the existing outbox retries it. */
export async function enqueueWorkspaceStats(tx: CustomerPaymentTransaction, scope: PaymentWorkspaceScope, revision: number) {
  await tx.insert(integrationOutboxSchema).values({
    id: randomUUID(),
    salonId: scope.salonId,
    appointmentId: scope.appointmentId,
    provider: 'internal',
    operation: 'refresh_client_stats',
    dedupeKey: `payment-workspace:${scope.appointmentId}:client-stats:${revision}`,
    payload: { source: 'customer_payment_workspace', revision },
  }).onConflictDoNothing();
}
