import 'server-only';

import { and, desc, eq, isNull } from 'drizzle-orm';

import { buildAppointmentManageUrl } from '@/libs/appointmentManageUrl';
import { db } from '@/libs/DB';
import { createOpaqueToken } from '@/libs/lusterSecurity';
import {
  appointmentAccessTokenSchema,
  salonSchema,
} from '@/models/Schema';

const TOKEN_LIFETIME_AFTER_END_MS = 30 * 24 * 60 * 60 * 1000;
const MINIMUM_TOKEN_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_ACTIVE_TOKENS_PER_APPOINTMENT = 3;

type ManageLinkAppointment = {
  id: string;
  salonId: string;
  endTime: Date;
};

/**
 * Creates a short-lived customer capability link after the caller has already
 * proved that the current staff/admin may manage the appointment.
 *
 * Only the hash is persisted. Keeping at most three live capabilities avoids
 * accumulating links when a tech prepares the same native SMS more than once.
 */
export async function mintAppointmentManageLink(
  appointment: ManageLinkAppointment,
  now = new Date(),
): Promise<string> {
  const [salon] = await db
    .select({
      slug: salonSchema.slug,
      customDomain: salonSchema.customDomain,
    })
    .from(salonSchema)
    .where(eq(salonSchema.id, appointment.salonId))
    .limit(1);

  if (!salon?.slug) {
    throw new Error('SALON_NOT_FOUND');
  }

  const capability = createOpaqueToken();
  const appointmentExpiry = appointment.endTime.getTime()
    + TOKEN_LIFETIME_AFTER_END_MS;
  const minimumExpiry = now.getTime() + MINIMUM_TOKEN_LIFETIME_MS;

  await db.insert(appointmentAccessTokenSchema).values({
    id: crypto.randomUUID(),
    salonId: appointment.salonId,
    appointmentId: appointment.id,
    tokenHash: capability.tokenHash,
    expiresAt: new Date(Math.max(appointmentExpiry, minimumExpiry)),
  });

  const activeTokens = await db
    .select({ id: appointmentAccessTokenSchema.id })
    .from(appointmentAccessTokenSchema)
    .where(and(
      eq(appointmentAccessTokenSchema.salonId, appointment.salonId),
      eq(appointmentAccessTokenSchema.appointmentId, appointment.id),
      isNull(appointmentAccessTokenSchema.revokedAt),
    ))
    .orderBy(desc(appointmentAccessTokenSchema.createdAt));

  const staleTokens = activeTokens.slice(MAX_ACTIVE_TOKENS_PER_APPOINTMENT);
  const revokedAt = new Date();
  for (const staleToken of staleTokens) {
    await db
      .update(appointmentAccessTokenSchema)
      .set({ revokedAt })
      .where(and(
        eq(appointmentAccessTokenSchema.id, staleToken.id),
        eq(appointmentAccessTokenSchema.salonId, appointment.salonId),
        eq(appointmentAccessTokenSchema.appointmentId, appointment.id),
      ));
  }

  return buildAppointmentManageUrl(
    { slug: salon.slug, customDomain: salon.customDomain },
    capability.token,
  );
}
