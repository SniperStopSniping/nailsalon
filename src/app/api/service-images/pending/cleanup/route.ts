import { constantTimeSecretEqual } from '@/libs/authConfig.server';
import { isCloudinaryConfigured } from '@/libs/Cloudinary';
import { cleanupPendingServiceImages } from '@/libs/serviceImagePendingCleanup.server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type ErrorResponse = {
  error: {
    code: string;
    message: string;
  };
};

function errorJson(status: number, code: string, message: string): Response {
  return Response.json(
    { error: { code, message } } satisfies ErrorResponse,
    { status },
  );
}

function cronSecret(request: Request): string | null {
  const headerSecret = request.headers.get('x-cron-secret');
  if (headerSecret) {
    return headerSecret;
  }

  const authorization = request.headers.get('authorization');
  if (authorization?.startsWith('Bearer ')) {
    return authorization.slice('Bearer '.length).trim();
  }

  return null;
}

async function handleCleanup(request: Request): Promise<Response> {
  const expectedSecret = process.env.CRON_SECRET;

  if (!expectedSecret) {
    return errorJson(500, 'MISCONFIGURED', 'Server misconfiguration');
  }
  const submittedSecret = cronSecret(request);
  if (
    !submittedSecret
    || !constantTimeSecretEqual(submittedSecret, expectedSecret)
  ) {
    return errorJson(
      401,
      'UNAUTHORIZED',
      'Invalid or missing cron secret',
    );
  }
  if (!isCloudinaryConfigured()) {
    return errorJson(
      503,
      'IMAGE_STORAGE_UNAVAILABLE',
      'Service image storage is not configured.',
    );
  }

  try {
    const result = await cleanupPendingServiceImages();
    return Response.json({ data: result });
  } catch {
    console.error('Pending service image cleanup failed');
    return errorJson(
      500,
      'INTERNAL_ERROR',
      'Pending service image cleanup failed',
    );
  }
}

export const GET = handleCleanup;
export const POST = handleCleanup;
