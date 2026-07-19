import { and, eq, or } from 'drizzle-orm';

import { logAppointmentChange } from '@/libs/appointmentAudit';
import { resolveCheckoutActor } from '@/libs/appointmentCheckoutServer';
import { deleteAppointmentPhoto } from '@/libs/Cloudinary';
import { db } from '@/libs/DB';
import { requireAppointmentManagerAccess } from '@/libs/routeAccessGuards';
import {
  appointmentArtifactsSchema,
  appointmentPhotoSchema,
} from '@/models/Schema';

// =============================================================================
// DELETE /api/appointments/[id]/photos/[photoId] — remove a photo
// =============================================================================
// Admins can remove any photo; staff can remove only photos they uploaded.
// The Cloudinary asset delete is best-effort (an orphaned asset is harmless;
// a dangling DB row is not). The matching appointment_artifacts URL slot is
// cleared so the canvas photo gates stay consistent.
// =============================================================================

function errorJson(status: number, code: string, message: string): Response {
  return Response.json({ error: { code, message } }, { status });
}

export async function DELETE(
  request: Request,
  { params }: { params: { id: string; photoId: string } },
): Promise<Response> {
  try {
    const { id: appointmentId, photoId } = params;
    const access = await requireAppointmentManagerAccess(appointmentId, {
      assignedOnly: true,
      wrongRoleMessage: 'Only salon staff or admins can remove photos',
      assignmentForbiddenMessage: 'You can only manage photos on your own appointments',
      tenantForbiddenMessage: 'Appointment does not belong to your salon',
      salonSlugHint: new URL(request.url).searchParams.get('salonSlug'),
    });
    if (!access.ok) {
      return access.response;
    }
    const { appointment } = access;

    const [photo] = await db
      .select()
      .from(appointmentPhotoSchema)
      .where(
        and(
          eq(appointmentPhotoSchema.id, photoId),
          eq(appointmentPhotoSchema.appointmentId, appointmentId),
          eq(appointmentPhotoSchema.salonId, appointment.salonId),
        ),
      )
      .limit(1);

    if (!photo) {
      return errorJson(404, 'PHOTO_NOT_FOUND', 'Photo not found');
    }

    // Staff may only remove their own uploads; admins may remove any.
    if (
      access.actorRole === 'staff'
      && photo.uploadedByTechId !== access.session.technicianId
    ) {
      return errorJson(403, 'FORBIDDEN', 'You can only remove photos you uploaded');
    }

    await db
      .delete(appointmentPhotoSchema)
      .where(eq(appointmentPhotoSchema.id, photoId));

    // Keep the canvas artifacts row consistent: clear whichever URL slot held
    // this photo (presign-uploaded photos share the same URL in both tables).
    await db
      .update(appointmentArtifactsSchema)
      .set({
        ...(photo.photoType === 'before'
          ? { beforePhotoUrl: null, beforePhotoUploadedAt: null }
          : { afterPhotoUrl: null, afterPhotoUploadedAt: null }),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(appointmentArtifactsSchema.appointmentId, appointmentId),
          or(
            eq(appointmentArtifactsSchema.beforePhotoUrl, photo.imageUrl),
            eq(appointmentArtifactsSchema.afterPhotoUrl, photo.imageUrl),
          ),
        ),
      );

    // Best-effort Cloudinary cleanup — never block the delete on it.
    deleteAppointmentPhoto(photo.cloudinaryPublicId).catch((cloudinaryError) => {
      console.error('Failed to delete Cloudinary asset (non-fatal):', cloudinaryError);
    });

    const actor = resolveCheckoutActor(access);
    void logAppointmentChange({
      appointmentId,
      salonId: appointment.salonId,
      action: 'photo_removed',
      performedBy: actor.performedBy,
      performedByRole: actor.performedByRole,
      performedByName: actor.performedByName ?? undefined,
      previousValue: { photoId, photoType: photo.photoType },
    });

    return Response.json({ data: { deleted: true, photoId } });
  } catch (error) {
    console.error('Error deleting photo:', error);
    return errorJson(500, 'INTERNAL_ERROR', 'Failed to delete photo');
  }
}
