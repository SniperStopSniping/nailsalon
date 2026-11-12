import 'server-only';

import { createHash } from 'node:crypto';

import { and, eq, gt, isNull } from 'drizzle-orm';

import type { db } from '@/libs/DB';
import { adminSalonMembershipSchema, appointmentAccessTokenSchema, technicianSchema } from '@/models/Schema';

import type { CustomerPaymentTransaction } from './preparationRepository';
import type { PaymentWorkspaceActor } from './workspaceContract';
import { workspaceFailure } from './workspaceContract';

/** Recheck membership while the appointment lock is held, including on retry. */
export async function authorizeWorkspaceActor(tx: CustomerPaymentTransaction, actor: PaymentWorkspaceActor) {
  if (actor.impersonating) {
    return workspaceFailure('PAYMENT_WORKSPACE_ACCESS_REQUIRED');
  }
  if (actor.role === 'customer') {
    if (!actor.accessToken || actor.id !== `customer:${actor.accessToken.id}` || !/^[a-f0-9]{64}$/.test(actor.accessToken.hash)) {
      return workspaceFailure('PAYMENT_WORKSPACE_ACCESS_REQUIRED');
    }
    const [capability] = await tx.select({ id: appointmentAccessTokenSchema.id }).from(appointmentAccessTokenSchema).where(and(
      eq(appointmentAccessTokenSchema.id, actor.accessToken.id),
      eq(appointmentAccessTokenSchema.tokenHash, actor.accessToken.hash),
      eq(appointmentAccessTokenSchema.salonId, actor.salonId),
      eq(appointmentAccessTokenSchema.appointmentId, actor.appointmentId),
      isNull(appointmentAccessTokenSchema.revokedAt),
      gt(appointmentAccessTokenSchema.expiresAt, new Date()),
    )).for('share').limit(1);
    if (!capability) {
      return workspaceFailure('PAYMENT_WORKSPACE_ACCESS_REQUIRED');
    }
  } else if (actor.role === 'staff') {
    const [staff] = await tx.select().from(technicianSchema).where(and(eq(technicianSchema.id, actor.id), eq(technicianSchema.salonId, actor.salonId))).for('share').limit(1);
    if (!staff?.isActive) {
      return workspaceFailure('PAYMENT_WORKSPACE_ACCESS_REQUIRED');
    }
  } else {
    const [member] = await tx.select().from(adminSalonMembershipSchema).where(and(eq(adminSalonMembershipSchema.adminId, actor.id), eq(adminSalonMembershipSchema.salonId, actor.salonId))).for('share').limit(1);
    if (!member || member.role !== (actor.role === 'owner' ? 'owner' : 'admin')) {
      return workspaceFailure('PAYMENT_WORKSPACE_ACCESS_REQUIRED');
    }
  }
}

export async function resolveCustomerWorkspaceActor(database: Pick<typeof db, 'select'>, token: string): Promise<PaymentWorkspaceActor> {
  if (!/^[\w-]{32,128}$/.test(token)) {
    return workspaceFailure('PAYMENT_WORKSPACE_ACCESS_REQUIRED');
  }
  const hash = createHash('sha256').update(token).digest('hex');
  const [capability] = await database.select().from(appointmentAccessTokenSchema).where(and(eq(appointmentAccessTokenSchema.tokenHash, hash), isNull(appointmentAccessTokenSchema.revokedAt), gt(appointmentAccessTokenSchema.expiresAt, new Date()))).limit(1);
  if (!capability) {
    return workspaceFailure('PAYMENT_WORKSPACE_ACCESS_REQUIRED');
  }
  return { salonId: capability.salonId, appointmentId: capability.appointmentId, id: `customer:${capability.id}`, role: 'customer', impersonating: false, canEditItems: false, canRecordPayment: false, accessToken: { id: capability.id, hash } };
}

type ManagerAccess = Extract<Awaited<ReturnType<typeof import('@/libs/routeAccessGuards').requireAppointmentManagerAccess>>, { ok: true }>;

/** Reuse an already authenticated checkout guard; do not open a second DB read inside its transaction. */
export async function resolveWorkspaceActor(access: ManagerAccess, appointmentId: string): Promise<PaymentWorkspaceActor> {
  const { getAdminImpersonationSession } = await import('@/libs/adminImpersonation');
  if (await getAdminImpersonationSession() || access.actorRole === 'client') {
    return workspaceFailure('PAYMENT_WORKSPACE_ACCESS_REQUIRED');
  }
  const scope = { salonId: access.appointment.salonId, appointmentId };
  if (access.actorRole === 'staff') {
    return { ...scope, id: access.session.technicianId, role: 'staff', impersonating: false, canEditItems: true, canRecordPayment: true };
  }
  const membership = access.admin.salons.find(item => item.salonId === scope.salonId);
  if (!membership || !['owner', 'admin'].includes(membership.role)) {
    return workspaceFailure('PAYMENT_WORKSPACE_ACCESS_REQUIRED');
  }
  return { ...scope, id: access.admin.id, role: membership.role === 'owner' ? 'owner' : 'admin', impersonating: false, canEditItems: true, canRecordPayment: true };
}

export async function requireWorkspaceActor(request: Request, appointmentId: string) {
  const { requireAppointmentManagerAccess } = await import('@/libs/routeAccessGuards');
  const access = await requireAppointmentManagerAccess(appointmentId, {
    assignedOnly: true,
    salonSlugHint: new URL(request.url).searchParams.get('salonSlug'),
  });
  if (!access.ok) {
    return { ok: false as const, response: access.response };
  }
  return { ok: true as const, actor: await resolveWorkspaceActor(access, appointmentId) };
}
