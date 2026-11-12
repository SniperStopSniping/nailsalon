import 'server-only';

import { and, eq, sql } from 'drizzle-orm';

import type { db } from '@/libs/DB';
import { appointmentSchema } from '@/models/Schema';

type Reader = Pick<typeof db, 'select'>;
/** SQL serializes/hashes its own evidence; never compare this hash with JS JSON. */
export async function loadCustomerPaymentCreditEvidence(database: Reader, salonId: string, appointmentId: string) {
  const expression = sql`customer_payment_credit_evidence(${salonId},${appointmentId})`;
  const [row] = await database.select({ evidence: sql<Record<string, unknown>>`${expression}`, evidenceRevision: sql<string>`customer_payment_credit_revision(${expression})` })
    .from(appointmentSchema).where(and(eq(appointmentSchema.id, appointmentId), eq(appointmentSchema.salonId, salonId))).limit(1);
  if (!row?.evidence || !row.evidenceRevision) {
    throw new Error('CUSTOMER_PAYMENT_CREDIT_APPOINTMENT_NOT_FOUND');
  }
  return row;
}
