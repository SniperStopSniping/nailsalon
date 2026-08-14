import { z } from 'zod';

import {
  releaseHold,
  serializeDepositForRole,
} from '@/libs/deposits/depositLifecycle';
import {
  assertNoDevRoleBypass,
  requireDepositMoneyActor,
} from '@/libs/deposits/depositMoneyGuard';

type RouteContext = { params: Promise<{ id: string }> };

const bodySchema = z.object({
  reason: z.string().trim().min(1).max(500),
}).strict();

export async function POST(
  request: Request,
  { params }: RouteContext,
): Promise<Response> {
  const bypass = await assertNoDevRoleBypass();
  if (bypass) {
    return bypass;
  }

  const { id: appointmentId } = await params;
  const access = await requireDepositMoneyActor({
    request,
    rateLimitKey: 'admin-deposit-release',
    salonSlug: new URL(request.url).searchParams.get('salonSlug'),
    appointmentId,
  });
  if (!access.ok) {
    return access.response;
  }

  const body = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      {
        error: {
          code: 'VALIDATION_ERROR',
          message: 'A reason is required and must be 500 characters or fewer.',
          details: parsed.error.flatten(),
        },
      },
      { status: 400 },
    );
  }

  const result = await releaseHold({
    depositId: access.deposit.id,
    salonId: access.salon.id,
    actor: access.actor,
    reason: parsed.data.reason,
  });
  if (!result.ok) {
    return Response.json(
      { error: { code: result.code, message: result.message } },
      { status: result.status },
    );
  }

  return Response.json({
    disposition: result.disposition,
    deposit: serializeDepositForRole(
      access.admin.isSuperAdmin ? 'super_admin' : 'admin',
      result.deposit,
    ),
  });
}
