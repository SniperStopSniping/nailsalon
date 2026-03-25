import { v2 as cloudinary } from 'cloudinary';
import { and, eq } from 'drizzle-orm';
import { mkdir, readdir, unlink, writeFile } from 'fs/promises';
import path from 'path';

import { requireAdminSalon } from '@/libs/adminAuth';
import { isCloudinaryConfigured } from '@/libs/Cloudinary';
import { db } from '@/libs/DB';
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

type ErrorResponse = {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
};

const LOCAL_AVATAR_EXTENSIONS = ['jpg', 'jpeg', 'png', 'webp'] as const;

function getAvatarExtension(file: File): string | null {
  switch (file.type) {
    case 'image/jpeg':
      return 'jpg';
    case 'image/png':
      return 'png';
    case 'image/webp':
      return 'webp';
    default:
      return null;
  }
}

async function removeLocalAvatarVariants(directory: string, avatarBaseName: string) {
  try {
    const entries = await readdir(directory);
    await Promise.all(
      entries
        .filter(name => LOCAL_AVATAR_EXTENSIONS.some(ext => name === `${avatarBaseName}.${ext}`))
        .map(name => unlink(path.join(directory, name)).catch(() => {})),
    );
  } catch {
    // Ignore cleanup failures; upload/delete should still proceed.
  }
}

async function saveLocalAvatar({
  file,
  salonId,
  technicianId,
}: {
  file: File;
  salonId: string;
  technicianId: string;
}): Promise<string> {
  const extension = getAvatarExtension(file);
  if (!extension) {
    throw new Error('Only JPEG, PNG, and WebP images are allowed');
  }

  const avatarBaseName = `avatar_${technicianId}`;
  const relativeDirectory = path.join('uploads', 'staff', salonId);
  const absoluteDirectory = path.join(process.cwd(), 'public', relativeDirectory);
  const fileName = `${avatarBaseName}.${extension}`;
  const absolutePath = path.join(absoluteDirectory, fileName);
  const relativeUrl = `/${path.posix.join(relativeDirectory.replaceAll(path.sep, '/'), fileName)}`;

  await mkdir(absoluteDirectory, { recursive: true });
  await removeLocalAvatarVariants(absoluteDirectory, avatarBaseName);

  const arrayBuffer = await file.arrayBuffer();
  await writeFile(absolutePath, Buffer.from(arrayBuffer));

  return relativeUrl;
}

async function deleteLocalAvatarIfPresent(avatarUrl: string | null) {
  if (!avatarUrl?.startsWith('/uploads/staff/')) {
    return;
  }

  const cleanPath = avatarUrl.split('?')[0];
  if (!cleanPath) {
    return;
  }

  const absolutePath = path.join(process.cwd(), 'public', cleanPath.replace(/^\//, ''));
  try {
    await unlink(absolutePath);
  } catch {
    // Ignore missing-file cleanup errors.
  }
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

    const { error, salon } = await requireAdminSalon(salonSlug);
    if (error || !salon) {
      return error!;
    }

    const canUseCloudinary = isCloudinaryConfigured();
    const canUseLocalFallback = process.env.NODE_ENV !== 'production';

    if (!canUseCloudinary && !canUseLocalFallback) {
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

    let avatarUrl: string;
    if (canUseCloudinary) {
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

      avatarUrl = uploadResult.secure_url;
    } else {
      avatarUrl = await saveLocalAvatar({
        file,
        salonId: salon.id,
        technicianId: id,
      });
    }

    // Update technician's avatarUrl
    const [_updated] = await db
      .update(technicianSchema)
      .set({
        avatarUrl,
        updatedAt: new Date(),
      })
      .where(eq(technicianSchema.id, id))
      .returning();

    return Response.json({
      data: {
        technicianId: id,
        avatarUrl,
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

    const { error, salon } = await requireAdminSalon(salonSlug);
    if (error || !salon) {
      return error!;
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

    await deleteLocalAvatarIfPresent(technician.avatarUrl);

    // Clear avatarUrl
    const [_updated] = await db
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
