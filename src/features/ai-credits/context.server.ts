import 'server-only';

import { AsyncLocalStorage } from 'node:async_hooks';

import { and, eq } from 'drizzle-orm';

import { SetupError } from '@/features/business-setup/contracts';
import type { SetupActor, SetupTransaction } from '@/features/business-setup/drafts.server';
import { aiCreditReservationSchema as reservations } from '@/models/Schema';

import type { AiCreditPlanEnv } from './catalog';
import type { AiCreditPricingSnapshot } from './pricing';

export type AiCreditExecution = { reservationId: string; operationId: string; salonId: string; adminId: string; planEnv: AiCreditPlanEnv; token: string; pricing: AiCreditPricingSnapshot };
const execution = new AsyncLocalStorage<AiCreditExecution>();
export const currentAiCreditExecution = () => execution.getStore();
export const withAiCreditExecution = <T>(context: AiCreditExecution, work: () => Promise<T>) => execution.run(context, work);

/** Called under the salon lock, inside the same transaction as a draft write. */
export async function assertAiCreditExecution(tx: SetupTransaction, actor: SetupActor) {
  const context = currentAiCreditExecution();
  if (!context) {
    return null; // Manual editors and the existing isolated trial stay separate.
  }
  if (context.salonId !== actor.salonId || context.adminId !== actor.adminId) {
    throw new SetupError('FORBIDDEN', 'This AI request does not belong to your business.');
  }
  const [hold] = await tx.select().from(reservations).where(and(eq(reservations.id, context.reservationId), eq(reservations.salonId, actor.salonId), eq(reservations.planEnv, context.planEnv))).for('update');
  if (!hold || hold.status !== 'held' || hold.actorId !== actor.adminId || hold.executionToken !== context.token || !hold.leaseExpiresAt || hold.leaseExpiresAt.getTime() <= Date.now()) {
    throw new SetupError('NOT_READY', 'This AI request has stopped. Your saved changes are safe. Please start a new attempt.');
  }
  return hold;
}
