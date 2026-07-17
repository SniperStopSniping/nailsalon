import { and, eq } from 'drizzle-orm';
import { z } from 'zod';

import { db } from '@/libs/DB';
import { getOrCreateSalonClient, getSalonById } from '@/libs/queries';
import { getRetentionSettingsForSalon } from '@/libs/retentionSettings.server';
import {
  buildGoogleReviewMessage,
  buildSatisfactionMessage,
  REVIEW_FOLLOWUP_ACTIONS,
  type ReviewFollowupAction,
} from '@/libs/reviewFollowup';
import { requireAppointmentManagerAccess } from '@/libs/routeAccessGuards';
import { appointmentSchema, salonClientSchema } from '@/models/Schema';
import type { SalonSettings } from '@/types/salonPolicy';

// =============================================================================
// POST /api/appointments/[id]/review-followup
// =============================================================================
// Records which post-appointment review follow-up the tech chose, returns the
// message text to copy/send. When action = 'already_reviewed', marks the client
// as reviewed so the prompt never shows again. No SMS/email is sent here.
// =============================================================================

const bodySchema = z.object({
  action: z.enum(REVIEW_FOLLOWUP_ACTIONS),
});

type ErrorResponse = { error: { code: string; message: string; details?: unknown } };

export async function POST(
  request: Request,
  { params }: { params: { id: string } },
): Promise<Response> {
  try {
    const appointmentId = params.id;
    const access = await requireAppointmentManagerAccess(appointmentId, {
      assignedOnly: true,
      wrongRoleMessage: 'Only salon staff or admins can record review follow-up',
      assignmentForbiddenMessage: 'You can only record follow-up for your own appointments',
      tenantForbiddenMessage: 'Appointment does not belong to your salon',
      salonSlugHint: new URL(request.url).searchParams.get('salonSlug'),
    });
    if (!access.ok) {
      return access.response;
    }
    const { appointment } = access;

    let body: unknown = {};
    try {
      body = await request.json();
    } catch {
      // fall through to validation error
    }
    const validated = bodySchema.safeParse(body);
    if (!validated.success) {
      return Response.json(
        { error: { code: 'VALIDATION_ERROR', message: 'Invalid action', details: validated.error.flatten() } } satisfies ErrorResponse,
        { status: 400 },
      );
    }
    const action: ReviewFollowupAction = validated.data.action;

    const technicianId = access.actorRole === 'staff' ? access.session.technicianId : null;
    const now = new Date();

    // Record the per-visit follow-up action on the appointment.
    await db
      .update(appointmentSchema)
      .set({
        reviewFollowupAction: action,
        reviewFollowupSentAt: now,
        reviewFollowupSentBy: technicianId,
        updatedAt: now,
      })
      .where(and(
        eq(appointmentSchema.id, appointmentId),
        eq(appointmentSchema.salonId, appointment.salonId),
      ));

    // 'already_reviewed' is client-level truth — mark it so we never ask again.
    let clientHasGoogleReview = false;
    if (action === 'already_reviewed') {
      const salonClient = appointment.salonClientId
        ? { id: appointment.salonClientId }
        : await getOrCreateSalonClient(appointment.salonId, appointment.clientPhone, appointment.clientName ?? undefined);
      if (salonClient?.id) {
        await db
          .update(salonClientSchema)
          .set({ hasGoogleReview: true, googleReviewMarkedAt: now, googleReviewMarkedBy: technicianId, updatedAt: now })
          .where(eq(salonClientSchema.id, salonClient.id));
        clientHasGoogleReview = true;
      }
    }

    // Build the copyable message for the "send" actions.
    const salon = await getSalonById(appointment.salonId);
    const salonName = salon?.name ?? 'our salon';
    const retentionSettings = await getRetentionSettingsForSalon(appointment.salonId);
    const googleReviewUrl = retentionSettings.googleReviewUrl
      ?? (salon?.settings as SalonSettings | null | undefined)?.googleReviewUrl
      ?? null;

    let message: string | null = null;
    if (action === 'satisfaction_question') {
      message = buildSatisfactionMessage({ salonName, clientName: appointment.clientName });
    } else if (action === 'google_review_link') {
      message = buildGoogleReviewMessage({ salonName, clientName: appointment.clientName, googleReviewUrl });
    }

    return Response.json({
      data: {
        action,
        sentAt: now,
        message,
        clientHasGoogleReview,
      },
    });
  } catch (error) {
    console.error('Error recording review follow-up:', error);
    return Response.json(
      { error: { code: 'INTERNAL_ERROR', message: 'Failed to record review follow-up', details: error instanceof Error ? error.message : 'Unknown error' } } satisfies ErrorResponse,
      { status: 500 },
    );
  }
}
