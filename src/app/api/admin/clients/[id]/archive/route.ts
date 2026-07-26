import { z } from 'zod';

import { getAdminSession, requireAdminSalon } from '@/libs/adminAuth';
import {
  archiveSalonClient,
  canonicalizeClientVersionToken,
  ClientDeletionError,
} from '@/libs/clientDeletion';

export const dynamic = 'force-dynamic';

const PRIVATE_HEADERS = {
  'Cache-Control': 'private, no-store, max-age=0',
  'Pragma': 'no-cache',
  'Vary': 'Cookie',
};

const VERSION_TOKEN_PATTERN
  = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/;

const archiveRequestSchema = z.object({
  salonSlug: z.string().trim().min(1),
  expectedUpdatedAt: z.string()
    .max(40)
    .datetime({ offset: true })
    .regex(VERSION_TOKEN_PATTERN)
    .transform(value => canonicalizeClientVersionToken(value)),
});

function privateJson(body: unknown, init?: ResponseInit): Response {
  const headers = new Headers(init?.headers);
  for (const [key, value] of Object.entries(PRIVATE_HEADERS)) {
    headers.set(key, value);
  }
  return Response.json(body, { ...init, headers });
}

function withPrivateNoStore(response: Response): Response {
  for (const [key, value] of Object.entries(PRIVATE_HEADERS)) {
    response.headers.set(key, value);
  }
  return response;
}

function deletionErrorResponse(error: ClientDeletionError): Response {
  switch (error.code) {
    case 'CLIENT_NOT_FOUND':
      return privateJson({
        error: {
          code: 'CLIENT_NOT_FOUND',
          message: 'Client not found',
        },
      }, { status: 404 });
    case 'CLIENT_ARCHIVE_CONFLICT':
      return privateJson({
        error: {
          code: 'CLIENT_ARCHIVE_CONFLICT',
          message:
            'This client changed elsewhere. Refresh the profile and try again.',
        },
      }, { status: 409 });
    case 'CLIENT_HAS_ACTIVE_APPOINTMENT':
      return privateJson({
        error: {
          code: 'CLIENT_HAS_ACTIVE_APPOINTMENT',
          message:
            'This client has an active appointment and can’t be deleted from the active list.',
        },
      }, { status: 409 });
    case 'UNSUPPORTED_CLIENT_IDENTITY':
      return privateJson({
        error: {
          code: 'UNSUPPORTED_CLIENT_IDENTITY',
          message: 'This client can’t be changed safely right now.',
        },
      }, { status: 409 });
    case 'CLIENT_LIFECYCLE_BUSY':
      return privateJson({
        error: {
          code: 'CLIENT_ARCHIVE_CONFLICT',
          message:
            'This client is busy right now. Try again in a moment.',
          retryable: true,
        },
      }, { status: 409 });
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const { id: requestedClientId } = await params;
    const parsed = archiveRequestSchema.safeParse(await request.json());
    if (!parsed.success) {
      return privateJson({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid request data',
        },
      }, { status: 400 });
    }

    const { error, salon } = await requireAdminSalon(parsed.data.salonSlug);
    if (error || !salon) {
      return withPrivateNoStore(error!);
    }
    const admin = await getAdminSession();
    if (!admin) {
      return privateJson({
        error: {
          code: 'UNAUTHORIZED',
          message: 'Authentication required',
        },
      }, { status: 401 });
    }

    const result = await archiveSalonClient({
      salonId: salon.id,
      requestedClientId,
      expectedUpdatedAt: parsed.data.expectedUpdatedAt,
      actorAdminId: admin.id,
    });

    return privateJson({
      data: {
        code: result.code,
        clientId: result.terminalClientId,
        updatedAt: result.updatedAt,
      },
      meta: {
        idempotent: result.idempotent,
        redirectedFromStaleSource: result.redirectedFromStaleSource,
      },
    });
  } catch (error) {
    if (error instanceof ClientDeletionError) {
      return deletionErrorResponse(error);
    }
    console.error('Error archiving client');
    return privateJson({
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Failed to delete client from the active list',
      },
    }, { status: 500 });
  }
}
