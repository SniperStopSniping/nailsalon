import { Buffer } from 'node:buffer';

import { nanoid } from 'nanoid';
import { z } from 'zod';

import { isCloudinaryConfigured, uploadAppointmentPhoto } from '@/libs/Cloudinary';
import { db } from '@/libs/DB';
import { getAppointmentById } from '@/libs/queries';
import { appointmentPhotoSchema, PHOTO_TYPES } from '@/models/Schema';

// =============================================================================
// REQUEST VALIDATION
// =============================================================================

const uploadPhotoSchema = z.object({
  photoType: z.enum(PHOTO_TYPES).default('after'),
  caption: z.string().optional(),
  // Tech ID for now - future: get from staff auth session
  uploadedByTechId: z.string().optional(),
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

type PhotoData = {
  id: string;
  appointmentId: string;
  photoType: string;
  imageUrl: string;
  thumbnailUrl: string | null;
  caption: string | null;
  createdAt: Date;
};

type SuccessResponse = {
  data: {
    photo: PhotoData;
  };
};

// =============================================================================
// Helper: Normalize phone number to 10 digits
// =============================================================================

function normalizePhone(phone: string): string {
  return phone.replace(/\D/g, '').replace(/^1(\d{10})$/, '$1');
}

// =============================================================================
// POST /api/appointments/[id]/photos - Upload photo for an appointment
// =============================================================================

export async function POST(
  request: Request,
  { params }: { params: { id: string } },
): Promise<Response> {
  try {
    const appointmentId = params.id;

    // 1. Check Cloudinary is configured
    if (!isCloudinaryConfigured()) {
      return Response.json(
        {
          error: {
            code: 'CLOUDINARY_NOT_CONFIGURED',
            message: 'Photo upload is not available. Cloudinary is not configured.',
          },
        } satisfies ErrorResponse,
        { status: 503 },
      );
    }

    // 2. Verify appointment exists
    const appointment = await getAppointmentById(appointmentId);
    if (!appointment) {
      return Response.json(
        {
          error: {
            code: 'APPOINTMENT_NOT_FOUND',
            message: `Appointment with ID "${appointmentId}" not found`,
          },
        } satisfies ErrorResponse,
        { status: 404 },
      );
    }

    // 3. Parse form data (multipart for file upload)
    const formData = await request.formData();
    const file = formData.get('file') as File | null;
    const photoType = (formData.get('photoType') as string) || 'after';
    const caption = formData.get('caption') as string | null;
    const uploadedByTechId = formData.get('uploadedByTechId') as string | null;

    // 4. Validate file exists
    if (!file) {
      return Response.json(
        {
          error: {
            code: 'NO_FILE_PROVIDED',
            message: 'No file provided in request',
          },
        } satisfies ErrorResponse,
        { status: 400 },
      );
    }

    // 5. Validate file type
    const allowedTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/heic'];
    if (!allowedTypes.includes(file.type)) {
      return Response.json(
        {
          error: {
            code: 'INVALID_FILE_TYPE',
            message: `File type "${file.type}" not allowed. Allowed types: ${allowedTypes.join(', ')}`,
          },
        } satisfies ErrorResponse,
        { status: 400 },
      );
    }

    // 6. Validate file size (max 10MB)
    const maxSize = 10 * 1024 * 1024; // 10MB
    if (file.size > maxSize) {
      return Response.json(
        {
          error: {
            code: 'FILE_TOO_LARGE',
            message: 'File size exceeds 10MB limit',
          },
        } satisfies ErrorResponse,
        { status: 400 },
      );
    }

    // 7. Validate photoType
    const validatedInput = uploadPhotoSchema.safeParse({
      photoType,
      caption,
      uploadedByTechId,
    });

    if (!validatedInput.success) {
      return Response.json(
        {
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid request data',
            details: validatedInput.error.flatten(),
          },
        } satisfies ErrorResponse,
        { status: 400 },
      );
    }

    // 8. Convert file to buffer and upload to Cloudinary
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    const uploadResult = await uploadAppointmentPhoto(
      buffer,
      appointment.salonId,
      appointmentId,
    );

    // 9. Normalize client phone for storage
    const normalizedClientPhone = normalizePhone(appointment.clientPhone);

    // 10. Store photo metadata in database
    const photoId = nanoid();
    const now = new Date();

    await db.insert(appointmentPhotoSchema).values({
      id: photoId,
      appointmentId,
      salonId: appointment.salonId,
      normalizedClientPhone,
      photoType: validatedInput.data.photoType,
      cloudinaryPublicId: uploadResult.publicId,
      imageUrl: uploadResult.imageUrl,
      thumbnailUrl: uploadResult.thumbnailUrl,
      caption: validatedInput.data.caption || null,
      uploadedByTechId: validatedInput.data.uploadedByTechId || null,
      createdAt: now,
    });

    // 11. Return success response
    const response: SuccessResponse = {
      data: {
        photo: {
          id: photoId,
          appointmentId,
          photoType: validatedInput.data.photoType,
          imageUrl: uploadResult.imageUrl,
          thumbnailUrl: uploadResult.thumbnailUrl,
          caption: validatedInput.data.caption || null,
          createdAt: now,
        },
      },
    };

    return Response.json(response, { status: 201 });
  } catch (error) {
    console.error('Error uploading photo:', error);
    return Response.json(
      {
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to upload photo',
          details: error instanceof Error ? error.message : 'Unknown error',
        },
      } satisfies ErrorResponse,
      { status: 500 },
    );
  }
}

// =============================================================================
// GET /api/appointments/[id]/photos - Get photos for an appointment
// =============================================================================

export async function GET(
  _request: Request,
  { params }: { params: { id: string } },
): Promise<Response> {
  try {
    const appointmentId = params.id;

    // 1. Verify appointment exists
    const appointment = await getAppointmentById(appointmentId);
    if (!appointment) {
      return Response.json(
        {
          error: {
            code: 'APPOINTMENT_NOT_FOUND',
            message: `Appointment with ID "${appointmentId}" not found`,
          },
        } satisfies ErrorResponse,
        { status: 404 },
      );
    }

    // 2. Fetch photos for this appointment
    const photos = await db.query.appointmentPhotoSchema.findMany({
      where: (photo, { eq }) => eq(photo.appointmentId, appointmentId),
      orderBy: (photo, { desc }) => [desc(photo.createdAt)],
    });

    // 3. Return photos
    return Response.json({
      data: {
        photos: photos.map(p => ({
          id: p.id,
          appointmentId: p.appointmentId,
          photoType: p.photoType,
          imageUrl: p.imageUrl,
          thumbnailUrl: p.thumbnailUrl,
          caption: p.caption,
          createdAt: p.createdAt,
        })),
      },
    });
  } catch (error) {
    console.error('Error fetching photos:', error);
    return Response.json(
      {
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to fetch photos',
        },
      } satisfies ErrorResponse,
      { status: 500 },
    );
  }
}
