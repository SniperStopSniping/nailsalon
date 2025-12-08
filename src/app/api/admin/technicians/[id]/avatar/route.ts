import { eq, and } from 'drizzle-orm';
import { v2 as cloudinary } from 'cloudinary';

import { db } from '@/libs/DB';
import { getSalonBySlug } from '@/libs/queries';
import { isCloudinaryConfigured } from '@/libs/Cloudinary';
import { technicianSchema } from '@/models/Schema';

// Force dynamic rendering for this API route
export const dynamic = 'force-dynamic';

// Configure Cloudinary
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// =============================================================================
// RESPONSE TYPES
// =============================================================================

interface ErrorResponse {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

// =============================================================================
// POST /api/admin/technicians/[id]/avatar - Upload staff photo
// =============================================================================

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const { id } = await params;

    // Check Cloudinary configuration
    if (!isCloudinaryConfigured()) {
      return Response.json(
        {
          error: {
            code: 'CLOUDINARY_NOT_CONFIGURED',
            message: 'Image upload is not configured',
          },
        } satisfies ErrorResponse,
        { status: 500 },
      );
    }

    // Parse form data
    const formData = await request.formData();
    const file = formData.get('file') as File | null;
    const salonSlug = formData.get('salonSlug') as string | null;

    if (!file) {
      return Response.json(
        {
          error: {
            code: 'VALIDATION_ERROR',
            message: 'No file provided',
          },
        } satisfies ErrorResponse,
        { status: 400 },
      );
    }

    if (!salonSlug) {
      return Response.json(
        {
          error: {
            code: 'VALIDATION_ERROR',
            message: 'salonSlug is required',
          },
        } satisfies ErrorResponse,
        { status: 400 },
      );
    }

    // Validate file type
    const allowedTypes = ['image/jpeg', 'image/png', 'image/webp'];
    if (!allowedTypes.includes(file.type)) {
      return Response.json(
        {
          error: {
            code: 'INVALID_FILE_TYPE',
            message: 'Only JPEG, PNG, and WebP images are allowed',
          },
        } satisfies ErrorResponse,
        { status: 400 },
      );
    }

    // Validate file size (5MB max)
    const maxSize = 5 * 1024 * 1024; // 5MB
    if (file.size > maxSize) {
      return Response.json(
        {
          error: {
            code: 'FILE_TOO_LARGE',
            message: 'File size must be less than 5MB',
          },
        } satisfies ErrorResponse,
        { status: 400 },
      );
    }

    // Get salon
    const salon = await getSalonBySlug(salonSlug);
    if (!salon) {
      return Response.json(
        {
          error: {
            code: 'SALON_NOT_FOUND',
            message: 'Salon not found',
          },
        } satisfies ErrorResponse,
        { status: 404 },
      );
    }

    // Verify technician exists and belongs to salon
    const [technician] = await db
      .select()
      .from(technicianSchema)
      .where(
        and(
          eq(technicianSchema.id, id),
          eq(technicianSchema.salonId, salon.id),
        ),
      )
      .limit(1);

    if (!technician) {
      return Response.json(
        {
          error: {
            code: 'TECHNICIAN_NOT_FOUND',
            message: 'Technician not found',
          },
        } satisfies ErrorResponse,
        { status: 404 },
      );
    }

    // Convert file to buffer
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // Upload to Cloudinary
    const folder = `salons/${salon.id}/staff`;

    const uploadResult = await new Promise<{ secure_url: string; public_id: string }>((resolve, reject) => {
      cloudinary.uploader
        .upload_stream(
          {
            folder,
            resource_type: 'image',
            public_id: `avatar_${id}`,
            overwrite: true,
            transformation: [
              { width: 400, height: 400, crop: 'fill', gravity: 'face' },
            ],
          },
          (error, result) => {
            if (error) {
              reject(new Error(`Cloudinary upload failed: ${error.message}`));
              return;
            }
            if (!result) {
              reject(new Error('Cloudinary upload returned no result'));
              return;
            }
            resolve({ secure_url: result.secure_url, public_id: result.public_id });
          },
        )
        .end(buffer);
    });

    // Update technician's avatarUrl
    const [updated] = await db
      .update(technicianSchema)
      .set({
        avatarUrl: uploadResult.secure_url,
        updatedAt: new Date(),
      })
      .where(eq(technicianSchema.id, id))
      .returning();

    return Response.json({
      data: {
        technicianId: id,
        avatarUrl: uploadResult.secure_url,
      },
      meta: {
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error('Error uploading avatar:', error);
    return Response.json(
      {
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to upload avatar',
        },
      } satisfies ErrorResponse,
      { status: 500 },
    );
  }
}

// =============================================================================
// DELETE /api/admin/technicians/[id]/avatar - Remove avatar
// =============================================================================

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const { id } = await params;
    const { searchParams } = new URL(request.url);
    const salonSlug = searchParams.get('salonSlug');

    if (!salonSlug) {
      return Response.json(
        {
          error: {
            code: 'VALIDATION_ERROR',
            message: 'salonSlug is required',
          },
        } satisfies ErrorResponse,
        { status: 400 },
      );
    }

    // Get salon
    const salon = await getSalonBySlug(salonSlug);
    if (!salon) {
      return Response.json(
        {
          error: {
            code: 'SALON_NOT_FOUND',
            message: 'Salon not found',
          },
        } satisfies ErrorResponse,
        { status: 404 },
      );
    }

    // Verify technician exists and belongs to salon
    const [technician] = await db
      .select()
      .from(technicianSchema)
      .where(
        and(
          eq(technicianSchema.id, id),
          eq(technicianSchema.salonId, salon.id),
        ),
      )
      .limit(1);

    if (!technician) {
      return Response.json(
        {
          error: {
            code: 'TECHNICIAN_NOT_FOUND',
            message: 'Technician not found',
          },
        } satisfies ErrorResponse,
        { status: 404 },
      );
    }

    // Try to delete from Cloudinary if configured
    if (isCloudinaryConfigured() && technician.avatarUrl) {
      try {
        const publicId = `salons/${salon.id}/staff/avatar_${id}`;
        await cloudinary.uploader.destroy(publicId);
      } catch (cloudinaryError) {
        console.error('Failed to delete from Cloudinary:', cloudinaryError);
        // Continue anyway - we'll still clear the URL
      }
    }

    // Clear avatarUrl
    const [updated] = await db
      .update(technicianSchema)
      .set({
        avatarUrl: null,
        updatedAt: new Date(),
      })
      .where(eq(technicianSchema.id, id))
      .returning();

    return Response.json({
      data: {
        technicianId: id,
        avatarUrl: null,
      },
      meta: {
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error('Error deleting avatar:', error);
    return Response.json(
      {
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to delete avatar',
        },
      } satisfies ErrorResponse,
      { status: 500 },
    );
  }
}
