import 'server-only';

import { and, asc, eq, isNull } from 'drizzle-orm';

import { isCustomerPaymentTender } from '@/libs/customerPayments/provenance';
import type { Appointment, AuditPerformerRole } from '@/models/Schema';
import { appointmentPaymentSchema } from '@/models/Schema';

/**
 * Server-side helpers shared by the checkout/complete/payments/reopen routes.
 */

type ManagerAccess
  = | { actorRole: 'staff'; session: { technicianId: string; technicianName: string } }
  | { actorRole: 'admin'; admin: { id: string; name?: string | null } }
  | { actorRole: 'client' };

export type CheckoutActor = {
  /** For appointment_payment rows. */
  recordedByType: 'admin' | 'staff';
  recordedById: string;
  recordedByName: string | null;
  /** For appointment_audit_log rows. */
  performedBy: string;
  performedByRole: AuditPerformerRole;
  performedByName: string | null;
};

/**
 * Normalize the access-guard result into the actor fields written to payment
 * and audit rows. The manager guard never yields a client actor; treat it as
 * unreachable defensively.
 */
export function resolveCheckoutActor(access: ManagerAccess): CheckoutActor {
  if (access.actorRole === 'staff') {
    return {
      recordedByType: 'staff',
      recordedById: access.session.technicianId,
      recordedByName: access.session.technicianName ?? null,
      performedBy: `staff:${access.session.technicianId}`,
      performedByRole: 'staff',
      performedByName: access.session.technicianName ?? null,
    };
  }
  if (access.actorRole === 'admin') {
    return {
      recordedByType: 'admin',
      recordedById: access.admin.id,
      recordedByName: access.admin.name ?? null,
      performedBy: access.admin.id,
      performedByRole: 'admin',
      performedByName: access.admin.name ?? null,
    };
  }
  throw new Error('Checkout routes never admit client actors');
}

type DbLike = {
  select: (fields?: Record<string, unknown>) => any;
};

/**
 * Recompute the paid total from non-voided payment rows — the ONLY way
 * `appointment.amount_paid_cents` is ever derived (never incremented), so
 * concurrent recordings can not drift it.
 */
export async function sumNonVoidedPayments(
  dbClient: DbLike,
  appointmentId: string,
): Promise<number> {
  const rows = await dbClient
    .select({ amountCents: appointmentPaymentSchema.amountCents })
    .from(appointmentPaymentSchema)
    .where(
      and(
        eq(appointmentPaymentSchema.appointmentId, appointmentId),
        isNull(appointmentPaymentSchema.voidedAt),
      ),
    );
  return rows.reduce(
    (sum: number, row: { amountCents: number }) => sum + row.amountCents,
    0,
  );
}

export async function listPayments(dbClient: DbLike, appointmentId: string) {
  const rows = await dbClient
    .select()
    .from(appointmentPaymentSchema)
    .where(eq(appointmentPaymentSchema.appointmentId, appointmentId))
    .orderBy(asc(appointmentPaymentSchema.recordedAt));
  if (!rows.some(isCustomerPaymentTender)) {
    return rows;
  }
  const { enrichCustomerPaymentProvenance } = await import('@/libs/customerPayments/server/provenanceReader');
  return enrichCustomerPaymentProvenance(dbClient, rows);
}

/**
 * The stored money snapshot of a completed appointment, with legacy NULLs
 * normalized. `totalDue = finalPrice + tax + tip` in both tax modes.
 */
export function appointmentMoneySnapshot(appointment: Appointment) {
  return {
    finalPriceCents: appointment.finalPriceCents,
    taxAmountCents: appointment.taxAmountCents,
    tipCents: appointment.tipCents,
    amountPaidCents: appointment.amountPaidCents,
    paymentStatus: appointment.paymentStatus,
  };
}

/** Call under the appointment lock before lifecycle/repricing changes. No new tables. */
export async function hasCustomerPaymentTenderForAppointment(dbClient: DbLike, salonId: string, appointmentId: string): Promise<boolean> {
  const rows = await dbClient.select({ id: appointmentPaymentSchema.id, reference: appointmentPaymentSchema.reference })
    .from(appointmentPaymentSchema).where(and(eq(appointmentPaymentSchema.salonId, salonId), eq(appointmentPaymentSchema.appointmentId, appointmentId)));
  return rows.some(isCustomerPaymentTender);
}
