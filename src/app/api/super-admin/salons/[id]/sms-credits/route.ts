import { eq } from 'drizzle-orm';
import { z } from 'zod';

import { requireSuperAdmin } from '@/libs/adminAuth';
import { logAuditEventTx } from '@/libs/auditLog';
import {
  AdministrativeCreditConflictError,
  grantAdministrativeSmsCredits,
  MAX_ADMINISTRATIVE_SMS_CREDITS,
} from '@/libs/billing/administrativeCredits';
import { computeAvailableBalance } from '@/libs/billing/creditLedger';
import { db } from '@/libs/DB';
import { salonSchema } from '@/models/Schema';

export const dynamic = 'force-dynamic';

const NO_STORE = { headers: { 'Cache-Control': 'no-store' } };

const requestSchema = z.object({
  amount: z.number().int().min(1).max(MAX_ADMINISTRATIVE_SMS_CREDITS),
  reason: z.string().trim().min(1).max(500),
  idempotencyKey: z.string().uuid(),
}).strict();

class SalonCreditTargetError extends Error {
  constructor(readonly code: 'SALON_NOT_FOUND' | 'SALON_DELETED') {
    super(code);
    this.name = 'SalonCreditTargetError';
  }
}

async function requireActiveSalonInTransaction(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  salonId: string,
) {
  const [salon] = await tx
    .select({ id: salonSchema.id, name: salonSchema.name, deletedAt: salonSchema.deletedAt })
    .from(salonSchema)
    .where(eq(salonSchema.id, salonId))
    .limit(1)
    .for('update');
  if (!salon) {
    throw new SalonCreditTargetError('SALON_NOT_FOUND');
  }
  if (salon.deletedAt !== null) {
    throw new SalonCreditTargetError('SALON_DELETED');
  }
  return salon;
}

function errorJson(status: number, code: string, message: string): Response {
  return Response.json({ error: { code, message } }, { status, ...NO_STORE });
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const guard = await requireSuperAdmin();
  if (!guard.ok) {
    return guard.response;
  }

  const { id: salonId } = await params;
  try {
    const result = await db.transaction(async (tx) => {
      await requireActiveSalonInTransaction(tx, salonId);
      return computeAvailableBalance(tx, salonId, new Date());
    });
    return Response.json({
      balance: result.available,
      administrativeBalance: result.byBucket.administrative ?? 0,
    }, NO_STORE);
  } catch (error) {
    if (error instanceof SalonCreditTargetError) {
      return errorJson(
        error.code === 'SALON_NOT_FOUND' ? 404 : 409,
        error.code,
        error.code === 'SALON_NOT_FOUND' ? 'Salon not found.' : 'Credits cannot be added to a deleted salon.',
      );
    }
    return errorJson(500, 'SMS_CREDITS_ERROR', 'SMS credit balance could not be loaded.');
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  // Authorize before parsing caller-controlled route/body data.
  const guard = await requireSuperAdmin();
  if (!guard.ok) {
    return guard.response;
  }

  if (request.headers.get('origin') !== new URL(request.url).origin) {
    return errorJson(403, 'INVALID_ORIGIN', 'Invalid request origin.');
  }
  if (request.headers.get('content-type')?.split(';')[0]?.trim() !== 'application/json') {
    return errorJson(415, 'JSON_REQUIRED', 'Request body must use application/json.');
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorJson(400, 'INVALID_INPUT', 'Request body must be valid JSON.');
  }
  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) {
    return errorJson(
      400,
      'INVALID_INPUT',
      `amount (1-${MAX_ADMINISTRATIVE_SMS_CREDITS}), reason, and idempotencyKey (UUID) are required.`,
    );
  }

  const { id: salonId } = await params;
  try {
    const result = await db.transaction(async (tx) => {
      const salon = await requireActiveSalonInTransaction(tx, salonId);
      const grant = await grantAdministrativeSmsCredits(tx, {
        salonId,
        amount: parsed.data.amount,
        reason: parsed.data.reason,
        idempotencyKey: parsed.data.idempotencyKey,
        actorId: guard.admin.id,
      });

      // This audit insertion shares the exact transaction with the immutable
      // ledger lot. A replay writes neither a second lot nor a second audit.
      if (grant.created) {
        await logAuditEventTx(tx, {
          salonId,
          actorType: 'super_admin',
          actorId: guard.admin.id,
          action: 'sms_credits_administered',
          entityType: 'sms_credit_administrative_grant',
          entityId: grant.lotId,
          metadata: {
            salonName: salon.name,
            amount: parsed.data.amount,
            reason: parsed.data.reason,
            bucket: 'administrative',
          },
          ip: request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null,
          userAgent: request.headers.get('user-agent'),
        });
      }
      return grant;
    });
    return Response.json(result, NO_STORE);
  } catch (error) {
    if (error instanceof AdministrativeCreditConflictError) {
      return errorJson(409, 'IDEMPOTENCY_CONFLICT', error.message);
    }
    if (error instanceof SalonCreditTargetError) {
      return errorJson(
        error.code === 'SALON_NOT_FOUND' ? 404 : 409,
        error.code,
        error.code === 'SALON_NOT_FOUND' ? 'Salon not found.' : 'Credits cannot be added to a deleted salon.',
      );
    }
    return errorJson(500, 'SMS_CREDITS_ERROR', 'SMS credits could not be added.');
  }
}
