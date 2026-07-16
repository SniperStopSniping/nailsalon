import { and, asc, eq, gt, inArray, isNull } from 'drizzle-orm';
import { z } from 'zod';

import { checkBookingRecoveryRateLimit } from '@/libs/bookingRecoveryRateLimit';
import { db } from '@/libs/DB';
import { sendTransactionalEmailDetailed } from '@/libs/email';
import { createOpaqueToken } from '@/libs/lusterSecurity';
import { buildSalonTenantPublicUrl } from '@/libs/publicUrl';
import { getSalonBySlug } from '@/libs/queries';
import { getClientIp } from '@/libs/rateLimit';
import { appointmentAccessTokenSchema, appointmentSchema, notificationDeliverySchema } from '@/models/Schema';

export const dynamic = 'force-dynamic';

const schema = z.object({
  salonSlug: z.string().trim().min(1).max(100),
  email: z.string().trim().email().max(320).transform(value => value.toLowerCase()),
});

const genericResponse = () => Response.json({ data: { accepted: true, message: 'If upcoming bookings match that email, a secure link will arrive shortly.' } }, { status: 202 });
const escapeHtml = (value: string) => value.replace(/[&<>'"]/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '\'': '&#39;', '"': '&quot;' })[character]!);

export async function POST(request: Request) {
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return genericResponse();
  }
  const salon = await getSalonBySlug(parsed.data.salonSlug);
  if (!salon) {
    return genericResponse();
  }
  try {
    if (!await checkBookingRecoveryRateLimit(getClientIp(request), salon.id, parsed.data.email)) {
      return genericResponse();
    }
  } catch {
    return Response.json({ error: { code: 'RECOVERY_TEMPORARILY_UNAVAILABLE', message: 'Booking recovery is temporarily unavailable. Please try again shortly.' } }, { status: 503 });
  }

  const appointments = await db.select({
    id: appointmentSchema.id,
    endTime: appointmentSchema.endTime,
  }).from(appointmentSchema).where(and(
    eq(appointmentSchema.salonId, salon.id),
    eq(appointmentSchema.clientEmail, parsed.data.email),
    inArray(appointmentSchema.status, ['pending', 'confirmed']),
    gt(appointmentSchema.endTime, new Date()),
  )).orderBy(asc(appointmentSchema.startTime)).limit(10);

  if (!appointments.length) {
    return genericResponse();
  }

  const links: string[] = [];
  const issuedTokenHashes: string[] = [];
  for (const appointment of appointments) {
    const capability = createOpaqueToken();
    await db.insert(appointmentAccessTokenSchema).values({
      id: crypto.randomUUID(),
      salonId: salon.id,
      appointmentId: appointment.id,
      tokenHash: capability.tokenHash,
      expiresAt: new Date(appointment.endTime.getTime() + 30 * 24 * 60 * 60 * 1000),
    });
    const active = await db.select({ id: appointmentAccessTokenSchema.id }).from(appointmentAccessTokenSchema).where(and(
      eq(appointmentAccessTokenSchema.salonId, salon.id),
      eq(appointmentAccessTokenSchema.appointmentId, appointment.id),
      isNull(appointmentAccessTokenSchema.revokedAt),
    )).orderBy(asc(appointmentAccessTokenSchema.createdAt));
    if (active.length > 3) {
      await db.update(appointmentAccessTokenSchema).set({ revokedAt: new Date() }).where(inArray(appointmentAccessTokenSchema.id, active.slice(0, -3).map(row => row.id)));
    }
    links.push(buildSalonTenantPublicUrl(`/manage/${capability.token}`, { slug: salon.slug, customDomain: salon.customDomain }));
    issuedTokenHashes.push(capability.tokenHash);
  }

  const text = [`Your upcoming ${salon.name} booking${links.length === 1 ? '' : 's'}:`, ...links.map((link, index) => `${index + 1}. ${link}`), '', 'These private links let you view, reschedule, or cancel.'].join('\n\n');
  const deliveryId = crypto.randomUUID();
  await db.insert(notificationDeliverySchema).values({
    id: deliveryId,
    salonId: salon.id,
    channel: 'email',
    purpose: 'booking_recovery',
    dedupeKey: `email:booking-recovery:${deliveryId}`,
    status: 'queued',
  });
  const result = await sendTransactionalEmailDetailed({
    to: parsed.data.email,
    subject: `${salon.name} booking access`,
    text,
    html: `<p>Your upcoming ${escapeHtml(salon.name)} booking${links.length === 1 ? '' : 's'}:</p>${links.map((link, index) => `<p><a href="${escapeHtml(link)}">Manage booking ${index + 1}</a></p>`).join('')}<p>Keep these private links secure.</p>`,
  });
  await db.update(notificationDeliverySchema).set({
    status: result.ok ? 'sent' : 'failed',
    providerMessageId: result.providerMessageId,
    errorCode: result.errorCode,
    retryable: false,
  }).where(and(eq(notificationDeliverySchema.id, deliveryId), eq(notificationDeliverySchema.salonId, salon.id)));
  if (!result.ok && issuedTokenHashes.length) {
    await db.update(appointmentAccessTokenSchema).set({ revokedAt: new Date() }).where(and(
      eq(appointmentAccessTokenSchema.salonId, salon.id),
      inArray(appointmentAccessTokenSchema.tokenHash, issuedTokenHashes),
    ));
  }
  return genericResponse();
}
