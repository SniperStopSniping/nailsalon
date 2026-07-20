import { and, eq, gt, isNull } from 'drizzle-orm';

import { db } from '@/libs/DB';
import { hashOpaqueToken } from '@/libs/lusterSecurity';
import { appointmentAccessTokenSchema, appointmentSchema, salonSchema } from '@/models/Schema';

export async function verifyAppointmentAccessToken(token: string, options?: {
  appointmentId?: string;
  salonId?: string;
}) {
  const conditions = [
    eq(appointmentAccessTokenSchema.tokenHash, hashOpaqueToken(token)),
    isNull(appointmentAccessTokenSchema.revokedAt),
    gt(appointmentAccessTokenSchema.expiresAt, new Date()),
  ];
  if (options?.appointmentId) {
    conditions.push(eq(appointmentAccessTokenSchema.appointmentId, options.appointmentId));
  }
  if (options?.salonId) {
    conditions.push(eq(appointmentAccessTokenSchema.salonId, options.salonId));
  }

  const [result] = await db
    .select({
      tokenId: appointmentAccessTokenSchema.id,
      appointmentId: appointmentAccessTokenSchema.appointmentId,
      salonId: appointmentAccessTokenSchema.salonId,
      expiresAt: appointmentAccessTokenSchema.expiresAt,
      appointment: appointmentSchema,
      salonSlug: salonSchema.slug,
      salonName: salonSchema.name,
      salonEmail: salonSchema.email,
      salonPhone: salonSchema.phone,
      salonSettings: salonSchema.settings,
    })
    .from(appointmentAccessTokenSchema)
    .innerJoin(appointmentSchema, and(
      eq(appointmentSchema.id, appointmentAccessTokenSchema.appointmentId),
      eq(appointmentSchema.salonId, appointmentAccessTokenSchema.salonId),
    ))
    .innerJoin(salonSchema, eq(salonSchema.id, appointmentAccessTokenSchema.salonId))
    .where(and(...conditions))
    .limit(1);
  return result ?? null;
}

/**
 * Why a capability token did not resolve, for error messaging only.
 *
 * `verifyAppointmentAccessToken` filters expiry in SQL, so a caller that only
 * has its null result cannot tell "expired" from "never existed" — and telling
 * a customer their link is invalid when it has simply aged out sends them
 * hunting for a typo that isn't there.
 *
 * Grants nothing: it returns a reason, never the appointment. A revoked token
 * is reported as `invalid` on purpose — a superseded link is not something the
 * holder should be told more about.
 */
export type AppointmentAccessFailureReason = 'invalid' | 'expired';

export async function describeAppointmentAccessFailure(
  token: string,
  now: Date = new Date(),
): Promise<AppointmentAccessFailureReason> {
  const [row] = await db
    .select({
      expiresAt: appointmentAccessTokenSchema.expiresAt,
      revokedAt: appointmentAccessTokenSchema.revokedAt,
    })
    .from(appointmentAccessTokenSchema)
    .where(eq(appointmentAccessTokenSchema.tokenHash, hashOpaqueToken(token)))
    .limit(1);

  if (row && !row.revokedAt && row.expiresAt <= now) {
    return 'expired';
  }
  return 'invalid';
}
