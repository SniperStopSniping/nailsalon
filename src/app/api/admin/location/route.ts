import { eq } from 'drizzle-orm';
import { z } from 'zod';

import { requireAdmin } from '@/libs/adminAuth';
import { logAuditEvent } from '@/libs/auditLog';
import { db } from '@/libs/DB';
import { getActiveLocationsBySalonId, getSalonBySlug } from '@/libs/queries';
import { salonLocationSchema } from '@/models/Schema';

export const dynamic = 'force-dynamic';

const optionalTextField = z
  .union([z.string(), z.null(), z.undefined()])
  .transform(value => {
    const trimmed = typeof value === 'string' ? value.trim() : '';
    return trimmed.length > 0 ? trimmed : null;
  });

const updateLocationSchema = z.object({
  name: z.string().trim().min(1, 'Location name is required'),
  address: optionalTextField,
  city: optionalTextField,
  state: optionalTextField,
  zipCode: optionalTextField,
});

function buildLocationPayload(location: {
  id: string;
  name: string;
  address: string | null;
  city: string | null;
  state: string | null;
  zipCode: string | null;
  isPrimary: boolean | null;
}) {
  return {
    id: location.id,
    name: location.name,
    address: location.address,
    city: location.city,
    state: location.state,
    zipCode: location.zipCode,
    isPrimary: Boolean(location.isPrimary),
  };
}

export async function GET(request: Request): Promise<Response> {
  try {
    const { searchParams } = new URL(request.url);
    const salonSlug = searchParams.get('salonSlug');

    if (!salonSlug) {
      return Response.json(
        { error: { code: 'MISSING_SALON_SLUG', message: 'salonSlug query parameter is required' } },
        { status: 400 },
      );
    }

    const salon = await getSalonBySlug(salonSlug);
    if (!salon) {
      return Response.json(
        { error: { code: 'SALON_NOT_FOUND', message: 'Salon not found' } },
        { status: 404 },
      );
    }

    const guard = await requireAdmin(salon.id);
    if (!guard.ok) {
      return guard.response;
    }

    const locations = await getActiveLocationsBySalonId(salon.id);
    const primaryLocation = locations.find(location => location.isPrimary) ?? locations[0] ?? null;

    return Response.json({
      data: {
        salon: {
          id: salon.id,
          slug: salon.slug,
          name: salon.name,
          locationCount: locations.length,
        },
        location: primaryLocation ? buildLocationPayload(primaryLocation) : null,
        isPrimaryFallback: Boolean(primaryLocation && !primaryLocation.isPrimary),
      },
    });
  } catch (error) {
    console.error('Error fetching admin location settings:', error);
    return Response.json(
      { error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch location settings' } },
      { status: 500 },
    );
  }
}

export async function PATCH(request: Request): Promise<Response> {
  try {
    const { searchParams } = new URL(request.url);
    const salonSlug = searchParams.get('salonSlug');

    if (!salonSlug) {
      return Response.json(
        { error: { code: 'MISSING_SALON_SLUG', message: 'salonSlug query parameter is required' } },
        { status: 400 },
      );
    }

    const salon = await getSalonBySlug(salonSlug);
    if (!salon) {
      return Response.json(
        { error: { code: 'SALON_NOT_FOUND', message: 'Salon not found' } },
        { status: 404 },
      );
    }

    const guard = await requireAdmin(salon.id);
    if (!guard.ok) {
      return guard.response;
    }

    const body = await request.json();
    const validated = updateLocationSchema.safeParse(body);
    if (!validated.success) {
      return Response.json(
        {
          error: {
            code: 'INVALID_REQUEST',
            message: validated.error.issues[0]?.message ?? 'Invalid request data',
          },
        },
        { status: 400 },
      );
    }

    const locations = await getActiveLocationsBySalonId(salon.id);
    const targetLocation = locations.find(location => location.isPrimary) ?? locations[0] ?? null;
    const locationPayload = validated.data;

    if (!targetLocation) {
      const [createdLocation] = await db
        .insert(salonLocationSchema)
        .values({
          id: crypto.randomUUID(),
          salonId: salon.id,
          name: locationPayload.name,
          address: locationPayload.address,
          city: locationPayload.city,
          state: locationPayload.state,
          zipCode: locationPayload.zipCode,
          isPrimary: true,
          isActive: true,
        })
        .returning();

      void logAuditEvent({
        salonId: salon.id,
        actorType: 'admin',
        actorId: guard.admin.id,
        action: 'settings_updated',
        entityType: 'salon_location',
        entityId: createdLocation?.id ?? null,
        metadata: {
          via: 'admin_location_settings',
          created: true,
        },
      });

      return Response.json({
        data: {
          location: createdLocation ? buildLocationPayload(createdLocation) : null,
          locationCount: 1,
          created: true,
        },
      });
    }

    const [updatedLocation] = await db
      .update(salonLocationSchema)
      .set({
        name: locationPayload.name,
        address: locationPayload.address,
        city: locationPayload.city,
        state: locationPayload.state,
        zipCode: locationPayload.zipCode,
        ...(targetLocation.isPrimary ? {} : { isPrimary: true }),
      })
      .where(eq(salonLocationSchema.id, targetLocation.id))
      .returning();

    void logAuditEvent({
      salonId: salon.id,
      actorType: 'admin',
      actorId: guard.admin.id,
      action: 'settings_updated',
      entityType: 'salon_location',
      entityId: targetLocation.id,
      metadata: {
        via: 'admin_location_settings',
        before: buildLocationPayload(targetLocation),
        after: updatedLocation ? buildLocationPayload(updatedLocation) : null,
      },
    });

    return Response.json({
      data: {
        location: updatedLocation ? buildLocationPayload(updatedLocation) : null,
        locationCount: locations.length,
        created: false,
      },
    });
  } catch (error) {
    console.error('Error updating admin location settings:', error);
    return Response.json(
      { error: { code: 'INTERNAL_ERROR', message: 'Failed to save location settings' } },
      { status: 500 },
    );
  }
}
