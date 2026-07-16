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
