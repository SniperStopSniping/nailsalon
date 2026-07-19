import crypto from 'node:crypto';

import { and, eq, isNull } from 'drizzle-orm';

import { db } from '@/libs/DB';
import { createOpaqueToken } from '@/libs/lusterSecurity';
import { getSalonById } from '@/libs/queries';
import { requireAppointmentManagerAccess } from '@/libs/routeAccessGuards';
import { resolveEtransferSettings } from '@/libs/taxConfig';
import { appointmentPaymentLinkSchema } from '@/models/Schema';
import type { SalonSettings } from '@/types/salonPolicy';

// =============================================================================
// POST /api/appointments/[id]/payment-link — mint the payment-instruction link
// =============================================================================
// The QR on the checkout sheet points at a Luster-hosted instruction page.
// Tokens are 256-bit opaque values stored sha256-hashed; one active link per
// appointment (minting revokes prior links); links are revoked automatically
// when the appointment is fully paid or reopened. The URL carries only the
// token — never client data.
// =============================================================================

export async function POST(
  request: Request,
  { params }: { params: { id: string } },
): Promise<Response> {
  try {
    const appointmentId = params.id;
    const access = await requireAppointmentManagerAccess(appointmentId, {
      assignedOnly: true,
      wrongRoleMessage: 'Only salon staff or admins can create payment links',
      tenantForbiddenMessage: 'Appointment does not belong to your salon',
      salonSlugHint: new URL(request.url).searchParams.get('salonSlug'),
    });
    if (!access.ok) {
      return access.response;
    }
    const { appointment } = access;

    const salon = await getSalonById(appointment.salonId);
    const etransfer = resolveEtransferSettings(
      (salon?.settings as SalonSettings | null | undefined) ?? null,
    );
    if (!etransfer.enabled || !etransfer.qrPageEnabled) {
      return Response.json(
        {
          error: {
            code: 'PAYMENT_PAGE_DISABLED',
            message: 'Enable the payment QR page in Settings → Payments & taxes first.',
          },
        },
        { status: 409 },
      );
    }

    const { token, tokenHash } = createOpaqueToken();
    const now = new Date();

    await db.transaction(async (tx) => {
      // One active link per appointment: minting supersedes prior links.
      await tx
        .update(appointmentPaymentLinkSchema)
        .set({ revokedAt: now })
        .where(
          and(
            eq(appointmentPaymentLinkSchema.appointmentId, appointmentId),
            isNull(appointmentPaymentLinkSchema.revokedAt),
          ),
        );
      await tx.insert(appointmentPaymentLinkSchema).values({
        id: `plink_${crypto.randomUUID()}`,
        salonId: appointment.salonId,
        appointmentId,
        tokenHash,
      });
    });

    const url = `${new URL(request.url).origin}/pay/${token}`;
    return Response.json({ data: { url } });
  } catch (error) {
    console.error('Error creating payment link:', error);
    return Response.json(
      { error: { code: 'INTERNAL_ERROR', message: 'Failed to create payment link' } },
      { status: 500 },
    );
  }
}
