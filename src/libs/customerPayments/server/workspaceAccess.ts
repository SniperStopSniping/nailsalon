import 'server-only';

import { and, eq } from 'drizzle-orm';

import { adminSalonMembershipSchema, technicianSchema } from '@/models/Schema';

import type { CustomerPaymentTransaction } from './preparationRepository';
import type { PaymentWorkspaceActor } from './workspaceContract';
import { workspaceFailure } from './workspaceContract';

/** Recheck membership while the appointment lock is held, including on retry. */
export async function authorizeWorkspaceActor(tx: CustomerPaymentTransaction, actor: PaymentWorkspaceActor) {
  if (actor.impersonating) {
    return workspaceFailure('PAYMENT_WORKSPACE_ACCESS_REQUIRED');
  }
  if (actor.role === 'staff') {
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

export async function requireWorkspaceActor(request: Request, appointmentId: string) {
  const [{ requireAppointmentManagerAccess }, { getAdminImpersonationSession }] = await Promise.all([
    import('@/libs/routeAccessGuards'),
    import('@/libs/adminImpersonation'),
  ]);
  const access = await requireAppointmentManagerAccess(appointmentId, {
    assignedOnly: true,
    salonSlugHint: new URL(request.url).searchParams.get('salonSlug'),
  });
  if (!access.ok) {
    return { ok: false as const, response: access.response };
  }
  // Super-admin impersonation never authorizes a charge or refund.
  if (await getAdminImpersonationSession() || access.actorRole === 'client') {
    return workspaceFailure('PAYMENT_WORKSPACE_ACCESS_REQUIRED');
  }
  const scope = { salonId: access.appointment.salonId, appointmentId };
  if (access.actorRole === 'staff') {
    return { ok: true as const, actor: { ...scope, id: access.session.technicianId, role: 'staff', impersonating: false, canEditItems: true, canRecordPayment: true } satisfies PaymentWorkspaceActor };
  }
  const membership = access.admin.salons.find(item => item.salonId === scope.salonId);
  if (!membership || !['owner', 'admin'].includes(membership.role)) {
    return workspaceFailure('PAYMENT_WORKSPACE_ACCESS_REQUIRED');
  }
  return { ok: true as const, actor: { ...scope, id: access.admin.id, role: membership.role === 'owner' ? 'owner' : 'admin', impersonating: false, canEditItems: true, canRecordPayment: true } satisfies PaymentWorkspaceActor };
}
