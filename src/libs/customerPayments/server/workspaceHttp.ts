import 'server-only';

import { ZodError } from 'zod';

import { PaymentWorkspaceError } from './workspaceContract';

export const workspaceHeaders = { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' };

export function workspaceError(error: unknown): Response {
  const code = error instanceof PaymentWorkspaceError ? error.code : error instanceof ZodError ? 'PAYMENT_WORKSPACE_INVALID_REQUEST' : 'PAYMENT_WORKSPACE_UNAVAILABLE';
  const status = code.endsWith('ACCESS_REQUIRED') || code.endsWith('OWNER_REQUIRED') || code.endsWith('ACTION_FORBIDDEN')
    ? 403
    : code.endsWith('NOT_FOUND') ? 404 : code.endsWith('INVALID_REQUEST') ? 400 : code.endsWith('UNAVAILABLE') ? 503 : 409;
  return Response.json({ error: { code, message: status === 503 ? 'Payment status could not be confirmed. Refresh before trying again.' : status === 403 ? 'You do not have permission to manage these payments.' : 'The payment details changed or need review. Refresh to see the current balance.' } }, { status, headers: workspaceHeaders });
}

export function workspaceOriginAllowed(request: Request) {
  return request.headers.get('origin') === new URL(request.url).origin && request.headers.get('sec-fetch-site') !== 'cross-site';
}
