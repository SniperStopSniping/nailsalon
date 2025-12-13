import { and, desc, eq } from 'drizzle-orm';
import { z } from 'zod';

import { db } from '@/libs/DB';
import { getSalonBySlug } from '@/libs/queries';
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
  phone: z.string().min(10).max(10), // Normalized 10-digit phone
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
// Helper: Normalize phone number to 10 digits
// =============================================================================

function normalizePhone(phone: string): string {
  return phone.replace(/\D/g, '').replace(/^1(\d{10})$/, '$1');
}

// =============================================================================
// GET /api/gallery - Get all photos for a client
// =============================================================================
// Query params:
//   - phone: The client's phone number (will be normalized)
//   - salonSlug: The salon slug to filter by
// =============================================================================

export async function GET(request: Request): Promise<Response> {
  try {
    // 1. Parse query parameters
    const { searchParams } = new URL(request.url);
    const rawPhone = searchParams.get('phone');
    const salonSlug = searchParams.get('salonSlug');

    // 2. Validate required params
    if (!rawPhone || !salonSlug) {
      return Response.json(
        {
          error: {
            code: 'MISSING_PARAMETERS',
            message: 'Both phone and salonSlug are required',
          },
        } satisfies ErrorResponse,
        { status: 400 },
      );
    }

    // 3. Normalize and validate phone
    const normalizedClientPhone = normalizePhone(rawPhone);

    const validated = querySchema.safeParse({
      phone: normalizedClientPhone,
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
    const salon = await getSalonBySlug(salonSlug);
    if (!salon) {
      return Response.json(
        {
          error: {
            code: 'SALON_NOT_FOUND',
            message: `Salon "${salonSlug}" not found`,
          },
        } satisfies ErrorResponse,
        { status: 404 },
      );
    }

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
          eq(appointmentPhotoSchema.normalizedClientPhone, normalizedClientPhone),
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
