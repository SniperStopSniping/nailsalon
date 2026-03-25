import { and, desc, eq } from 'drizzle-orm';
import { z } from 'zod';

import {
  requireClientApiSession,
  requireClientSalonFromQuery,
} from '@/libs/clientApiGuards';
import { db } from '@/libs/DB';
import {
  appointmentPhotoSchema,
  appointmentSchema,
  appointmentServicesSchema,
  serviceSchema,
  technicianSchema,
} from '@/models/Schema';

// Force dynamic rendering for this API route
export const dynamic = 'force-dynamic';

// =============================================================================
// REQUEST VALIDATION
// =============================================================================

const querySchema = z.object({
  salonSlug: z.string().min(1),
});

// =============================================================================
// RESPONSE TYPES
// =============================================================================

type ErrorResponse = {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
};

type PhotoWithDetails = {
  id: string;
  appointmentId: string;
  photoType: string;
  imageUrl: string;
  thumbnailUrl: string | null;
  caption: string | null;
  isPublic: boolean;
  createdAt: Date;
  // Appointment details
  appointmentDate: Date;
  services: string[];
  technicianName: string | null;
};

type SuccessResponse = {
  data: {
    photos: PhotoWithDetails[];
    totalCount: number;
  };
};

// =============================================================================
// GET /api/gallery - Get all photos for a client
// =============================================================================
// Query params:
//   - salonSlug: The salon slug to filter by
// =============================================================================

export async function GET(request: Request): Promise<Response> {
  try {
    const auth = await requireClientApiSession();
    if (!auth.ok) {
      return auth.response;
    }

    // 1. Parse query parameters
    const { searchParams } = new URL(request.url);
    const salonSlug = searchParams.get('salonSlug');

    // 2. Validate required params
    if (!salonSlug) {
      return Response.json(
        {
          error: {
            code: 'MISSING_PARAMETERS',
            message: 'Salon slug is required',
          },
        } satisfies ErrorResponse,
        { status: 400 },
      );
    }

    const validated = querySchema.safeParse({
      salonSlug,
    });

    if (!validated.success) {
      return Response.json(
        {
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid parameters',
            details: validated.error.flatten(),
          },
        } satisfies ErrorResponse,
        { status: 400 },
      );
    }

    // 4. Verify salon exists
    const salonGuard = await requireClientSalonFromQuery(searchParams);
    if (!salonGuard.ok) {
      return salonGuard.response;
    }
    const { salon } = salonGuard;

    // 5. Fetch photos with appointment details
    const photos = await db
      .select({
        // Photo fields
        id: appointmentPhotoSchema.id,
        appointmentId: appointmentPhotoSchema.appointmentId,
        photoType: appointmentPhotoSchema.photoType,
        imageUrl: appointmentPhotoSchema.imageUrl,
        thumbnailUrl: appointmentPhotoSchema.thumbnailUrl,
        caption: appointmentPhotoSchema.caption,
        isPublic: appointmentPhotoSchema.isPublic,
        createdAt: appointmentPhotoSchema.createdAt,
        // Appointment fields
        appointmentDate: appointmentSchema.startTime,
        // Technician
        technicianName: technicianSchema.name,
      })
      .from(appointmentPhotoSchema)
      .innerJoin(
        appointmentSchema,
        eq(appointmentPhotoSchema.appointmentId, appointmentSchema.id),
      )
      .leftJoin(
        technicianSchema,
        eq(appointmentSchema.technicianId, technicianSchema.id),
      )
      .where(
        and(
          eq(appointmentPhotoSchema.normalizedClientPhone, auth.normalizedPhone),
          eq(appointmentPhotoSchema.salonId, salon.id),
        ),
      )
      .orderBy(desc(appointmentPhotoSchema.createdAt));

    // 6. Fetch services for each appointment (separate query for simplicity)
    const appointmentIds = [...new Set(photos.map(p => p.appointmentId))];

    const appointmentServicesMap: Record<string, string[]> = {};

    if (appointmentIds.length > 0) {
      for (const apptId of appointmentIds) {
        const services = await db
          .select({
            serviceName: serviceSchema.name,
          })
          .from(appointmentServicesSchema)
          .innerJoin(
            serviceSchema,
            eq(appointmentServicesSchema.serviceId, serviceSchema.id),
          )
          .where(eq(appointmentServicesSchema.appointmentId, apptId));

        appointmentServicesMap[apptId] = services.map(s => s.serviceName);
      }
    }

    // 7. Build response
    const photosWithDetails: PhotoWithDetails[] = photos.map(photo => ({
      id: photo.id,
      appointmentId: photo.appointmentId,
      photoType: photo.photoType,
      imageUrl: photo.imageUrl,
      thumbnailUrl: photo.thumbnailUrl,
      caption: photo.caption,
      isPublic: photo.isPublic ?? false,
      createdAt: photo.createdAt,
      appointmentDate: photo.appointmentDate,
      services: appointmentServicesMap[photo.appointmentId] || [],
      technicianName: photo.technicianName,
    }));

    const response: SuccessResponse = {
      data: {
        photos: photosWithDetails,
        totalCount: photosWithDetails.length,
      },
    };

    return Response.json(response);
  } catch (error) {
    console.error('Error fetching gallery:', error);
    return Response.json(
      {
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to fetch gallery',
          details: error instanceof Error ? error.message : 'Unknown error',
        },
      } satisfies ErrorResponse,
      { status: 500 },
    );
  }
}
