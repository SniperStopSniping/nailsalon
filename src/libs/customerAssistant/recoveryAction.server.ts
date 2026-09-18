import 'server-only';

import { createHmac } from 'node:crypto';

import { and, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';

import { buildAppointmentManageUrl } from '@/libs/appointmentManageUrl';
import { appointmentManageCapabilityExpiry, mintAppointmentManageCapability } from '@/libs/bookingCommitEffects';
import { db } from '@/libs/DB';
import { resumeCustomerDepositCheckout } from '@/libs/deposits/resumeCustomerCheckout';
import { hashOpaqueToken } from '@/libs/lusterSecurity';
import { appointmentAccessTokenSchema, appointmentSchema, customerBookingOperationSchema, salonSchema } from '@/models/Schema';

import { getCustomerBookingRecoverySecret } from './access.server';
import { CUSTOMER_NO_STORE, isCustomerSameOrigin, readCustomerJson } from './http.server';
import { CustomerBookingOperationError, readCustomerBookingOperation } from './operationStore.server';

const schema = z.object({ capability: z.string().min(1).max(200) }).strict();

/** Explicit capability-authenticated customer actions, separate from polling. */
export async function runCustomerBookingRecoveryAction(request: Request, salonId: string, action: 'resume' | 'manage'): Promise<Response> {
  if (!isCustomerSameOrigin(request)) {
    return new Response(null, { status: 403, headers: CUSTOMER_NO_STORE });
  }
  const body = schema.safeParse(await readCustomerJson(request));
  if (!body.success) {
    return new Response(null, { status: 400, headers: CUSTOMER_NO_STORE });
  }
  const secret = getCustomerBookingRecoverySecret();
  if (!secret) {
    return new Response(null, { status: 404, headers: CUSTOMER_NO_STORE });
  }
  try {
    const operation = await readCustomerBookingOperation({ salonId, capability: body.data.capability, secret });
    if (!operation.appointmentId) {
      return new Response(null, { status: 409, headers: CUSTOMER_NO_STORE });
    }
    if (action === 'resume') {
      const url = await resumeCustomerDepositCheckout({ salonId, appointmentId: operation.appointmentId });
      return Response.json({ url }, { status: url ? 200 : 409, headers: CUSTOMER_NO_STORE });
    }
    const token = createHmac('sha256', secret).update(JSON.stringify(['luster.customer-booking-manage.v1', salonId, operation.id, operation.appointmentId])).digest('base64url');
    const tokenHash = hashOpaqueToken(token);
    const url = await db.transaction(async (tx) => {
      // Serialize issuance for this operation. The deterministic token is never
      // stored; repeat clicks reuse its original guest expiry and revocation.
      await tx.select({ id: customerBookingOperationSchema.id }).from(customerBookingOperationSchema)
        .where(and(eq(customerBookingOperationSchema.id, operation.id), eq(customerBookingOperationSchema.salonId, salonId))).for('update');
      const [appointment] = await tx.select({ id: appointmentSchema.id, endTime: appointmentSchema.endTime, slug: salonSchema.slug, customDomain: salonSchema.customDomain })
        .from(appointmentSchema).innerJoin(salonSchema, eq(salonSchema.id, appointmentSchema.salonId))
        .where(and(eq(appointmentSchema.id, operation.appointmentId!), eq(appointmentSchema.salonId, salonId), isNull(appointmentSchema.deletedAt))).limit(1);
      if (!appointment || appointmentManageCapabilityExpiry(appointment.endTime) <= new Date()) {
        return null;
      }
      const [existing] = await tx.select().from(appointmentAccessTokenSchema).where(and(
        eq(appointmentAccessTokenSchema.tokenHash, tokenHash),
        eq(appointmentAccessTokenSchema.salonId, salonId),
        eq(appointmentAccessTokenSchema.appointmentId, appointment.id),
      )).limit(1);
      if (existing && (existing.revokedAt || existing.expiresAt <= new Date())) {
        return null;
      }
      if (!existing) {
        await mintAppointmentManageCapability(tx, { salonId, appointmentId: appointment.id, appointmentEndTime: appointment.endTime, capability: { token, tokenHash } });
      }
      return buildAppointmentManageUrl({ slug: appointment.slug, customDomain: appointment.customDomain }, token);
    });
    return Response.json({ url }, { status: url ? 200 : 404, headers: CUSTOMER_NO_STORE });
  } catch (error) {
    return Response.json({ kind: 'recovery_unavailable' }, { status: error instanceof CustomerBookingOperationError ? 404 : 503, headers: CUSTOMER_NO_STORE });
  }
}
