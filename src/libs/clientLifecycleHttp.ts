import 'server-only';

import { ClientLifecycleError } from '@/libs/clientLifecycle';

const PRIVATE_HEADERS = {
  'Cache-Control': 'private, no-store, max-age=0',
  'Pragma': 'no-cache',
  'Vary': 'Cookie',
};

export function privateClientJson(body: unknown, init?: ResponseInit): Response {
  const headers = new Headers(init?.headers);
  for (const [key, value] of Object.entries(PRIVATE_HEADERS)) {
    headers.set(key, value);
  }
  return Response.json(body, { ...init, headers });
}

export function clientLifecycleErrorResponse(
  error: unknown,
  fallbackMessage: string,
): Response {
  if (error instanceof TypeError) {
    return privateClientJson(
      {
        error: {
          code: 'VALIDATION_ERROR',
          message: error.message,
        },
      },
      { status: 400 },
    );
  }

  if (!(error instanceof ClientLifecycleError)) {
    console.error(fallbackMessage, error);
    return privateClientJson(
      {
        error: {
          code: 'INTERNAL_ERROR',
          message: fallbackMessage,
        },
      },
      { status: 500 },
    );
  }

  const status = error.code === 'CLIENT_NOT_FOUND'
    ? 404
    : error.code === 'POSSIBLE_DUPLICATE'
      || error.code === 'STALE_CLIENT'
      || error.code === 'INVALID_CLIENT_STATE'
      || error.code === 'SAME_CLIENT'
      || error.code === 'CLIENT_HAS_HISTORY'
      || error.code === 'CONTACT_ALIAS_CONFLICT'
      ? 409
      : 400;

  return privateClientJson(
    {
      error: {
        code: error.code,
        message: error.message,
      },
      ...(error.duplicates
        ? {
            data: {
              duplicates: error.duplicates,
              possibleDuplicate: error.duplicates[0] ?? null,
            },
          }
        : {}),
      ...(error.dependencies ? { data: { dependencies: error.dependencies } } : {}),
    },
    { status },
  );
}
