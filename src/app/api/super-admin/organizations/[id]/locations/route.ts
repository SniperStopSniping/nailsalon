import { eq, sql } from 'drizzle-orm';
import { z } from 'zod';

import { db } from '@/libs/DB';
import { logAuditAction, requireSuperAdmin } from '@/libs/superAdmin';
import { salonLocationSchema, salonSchema } from '@/models/Schema';

export const dynamic = 'force-dynamic';

// =============================================================================
// REQUEST VALIDATION
// =============================================================================

const dayHoursSchema = z.object({ open: z.string(), close: z.string() }).nullable();

const businessHoursSchema = z.object({
  monday: dayHoursSchema,
  tuesday: dayHoursSchema,
  wednesday: dayHoursSchema,
  thursday: dayHoursSchema,
  friday: dayHoursSchema,
  saturday: dayHoursSchema,
  sunday: dayHoursSchema,
}).optional().nullable();

const createLocationSchema = z.object({
  name: z.string().min(1, 'Location name is required'),
  address: z.string().optional(),
  city: z.string().optional(),
  state: z.string().optional(),
  zipCode: z.string().optional(),
  phone: z.string().optional(),
  email: z.string().email().optional(),
  isPrimary: z.boolean().optional(),
  businessHours: businessHoursSchema,
});

// =============================================================================
// GET /api/super-admin/organizations/[id]/locations - List locations
// =============================================================================

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const guard = await requireSuperAdmin();
  if (guard) {
    return guard;
  }

  try {
    const { id } = await params;

    // Check salon exists
    const [salon] = await db
      .select({ id: salonSchema.id, name: salonSchema.name, maxLocations: salonSchema.maxLocations })
      .from(salonSchema)
      .where(eq(salonSchema.id, id))
      .limit(1);

    if (!salon) {
      return Response.json(
        { error: 'Salon not found' },
        { status: 404 },
      );
    }

    // Get locations
    const locations = await db
      .select()
      .from(salonLocationSchema)
      .where(eq(salonLocationSchema.salonId, id));

    return Response.json({
      locations: locations.map(loc => ({
        id: loc.id,
        name: loc.name,
        address: loc.address,
        city: loc.city,
        state: loc.state,
        zipCode: loc.zipCode,
        phone: loc.phone,
        email: loc.email,
        isPrimary: loc.isPrimary,
        isActive: loc.isActive,
        businessHours: loc.businessHours,
        createdAt: loc.createdAt.toISOString(),
        updatedAt: loc.updatedAt.toISOString(),
      })),
      salon: {
        id: salon.id,
        name: salon.name,
        maxLocations: salon.maxLocations ?? 1,
      },
    });
  } catch (error) {
    console.error('Error fetching locations:', error);
    return Response.json(
      { error: 'Failed to fetch locations' },
      { status: 500 },
    );
  }
}

// =============================================================================
// POST /api/super-admin/organizations/[id]/locations - Create location
// =============================================================================

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const guard = await requireSuperAdmin();
  if (guard) {
    return guard;
  }

  try {
    const { id } = await params;
    const body = await request.json();

    const validated = createLocationSchema.safeParse(body);
    if (!validated.success) {
      return Response.json(
        { error: 'Invalid request data', details: validated.error.flatten() },
        { status: 400 },
      );
    }

    // Check salon exists and get max locations
    const [salon] = await db
      .select({ id: salonSchema.id, maxLocations: salonSchema.maxLocations })
      .from(salonSchema)
      .where(eq(salonSchema.id, id))
      .limit(1);

    if (!salon) {
      return Response.json(
        { error: 'Salon not found' },
        { status: 404 },
      );
    }

    // Check current location count
    const [countResult] = await db
      .select({ count: sql<number>`count(*)` })
      .from(salonLocationSchema)
      .where(eq(salonLocationSchema.salonId, id));

    const currentCount = Number(countResult?.count ?? 0);
    const maxLocations = salon.maxLocations ?? 1;

    if (currentCount >= maxLocations) {
      return Response.json(
        {
          error: {
            code: 'LOCATION_LIMIT_REACHED',
            message: `Location limit reached (${currentCount}/${maxLocations})`,
          },
        },
        { status: 403 },
      );
    }

    const locationData = validated.data;

    // If setting as primary, unset other primaries
    if (locationData.isPrimary) {
      await db
        .update(salonLocationSchema)
        .set({ isPrimary: false })
        .where(eq(salonLocationSchema.salonId, id));
    }

    // If first location, make it primary
    const isPrimary = currentCount === 0 ? true : locationData.isPrimary ?? false;

    // Create location
    const [created] = await db
      .insert(salonLocationSchema)
      .values({
        id: crypto.randomUUID(),
        salonId: id,
        name: locationData.name,
        address: locationData.address,
        city: locationData.city,
        state: locationData.state,
        zipCode: locationData.zipCode,
        phone: locationData.phone,
        email: locationData.email,
        isPrimary,
        businessHours: locationData.businessHours,
      })
      .returning();

    // Log the action
    await logAuditAction(id, 'location_added', {
      newValue: { name: locationData.name, id: created!.id },
      details: `Added location: ${locationData.name}`,
    });

    return Response.json({
      success: true,
      location: {
        id: created!.id,
        name: created!.name,
        address: created!.address,
        city: created!.city,
        state: created!.state,
        zipCode: created!.zipCode,
        phone: created!.phone,
        email: created!.email,
        isPrimary: created!.isPrimary,
        isActive: created!.isActive,
        businessHours: created!.businessHours,
        createdAt: created!.createdAt.toISOString(),
        updatedAt: created!.updatedAt.toISOString(),
      },
    });
  } catch (error) {
    console.error('Error creating location:', error);
    return Response.json(
      { error: 'Failed to create location' },
      { status: 500 },
    );
  }
}
