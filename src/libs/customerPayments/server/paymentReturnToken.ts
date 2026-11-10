import 'server-only';

import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

import { z } from 'zod';

import type { PaymentWorkspaceScope, WorkspaceOperation } from './workspaceContract';
import { paymentWorkspaceScopeSchema, workspaceFailure } from './workspaceContract';

const lifetime = 7 * 24 * 60 * 60 * 1000;
const domain = 'luster.customer-payment.read-status.v1\n';
const claimsSchema = paymentWorkspaceScopeSchema.extend({
  operationId: z.string().uuid(),
  origin: z.string().url().max(500),
  createdAt: z.number().int().nonnegative(),
  expiresAt: z.number().int().nonnegative(),
}).strict();

function signingKey() {
  const key = process.env.CUSTOMER_PAYMENTS_STATUS_SIGNING_SECRET ?? '';
  return /^[\w-]{43,128}$/.test(key) ? key : null;
}

/** Pin the key identity, never its value, before a Checkout request is reserved. */
export function paymentReturnSigningKeyHash() {
  const key = signingKey();
  return key ? createHash('sha256').update(domain).update(key).digest('hex') : null;
}

function sign(payload: string, key: string) {
  return createHmac('sha256', key).update(domain).update(payload).digest();
}

export function createPaymentReturnUrl(scope: PaymentWorkspaceScope, operation: Pick<WorkspaceOperation, 'id' | 'kind' | 'createdAt' | 'binding' | 'returnStatusKeyHash'>) {
  const key = signingKey();
  if (!key || operation.kind !== 'payment' || operation.returnStatusKeyHash !== paymentReturnSigningKeyHash()) {
    // Rotation must not silently change a retry's Stripe idempotency parameters.
    return workspaceFailure('PAYMENT_WORKSPACE_RETURN_CONFIGURATION_CHANGED');
  }
  const claims = claimsSchema.parse({ ...scope, operationId: operation.id, origin: operation.binding.returnOrigin, createdAt: operation.createdAt, expiresAt: operation.createdAt + lifetime });
  const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
  const signature = sign(payload, key).toString('base64url');
  // A fragment is not sent in page requests or HTTP referrers. The page sends
  // this limited read capability only in a same-origin, no-store POST body.
  return `${claims.origin}/payments/result#status=${payload}.${signature}`;
}

export function verifyPaymentReturnToken(token: string, origin: string, now = Date.now()) {
  const key = signingKey();
  if (!key || token.length > 2048 || !/^[\w-]+\.[\w-]{43}$/.test(token)) {
    return null;
  }
  const [payload, signature] = token.split('.') as [string, string];
  const expected = sign(payload, key);
  const supplied = Buffer.from(signature, 'base64url');
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected) || supplied.toString('base64url') !== signature) {
    return null;
  }
  try {
    const claims = claimsSchema.parse(JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')));
    return claims.origin === origin && claims.createdAt <= now && claims.expiresAt === claims.createdAt + lifetime && now < claims.expiresAt
      ? claims
      : null;
  } catch {
    return null;
  }
}
