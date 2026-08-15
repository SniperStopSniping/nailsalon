import { z } from 'zod';

import { db } from '@/libs/DB';
import {
  DepositForfeitureBlockedError,
  DepositForfeitureInvalidStateError,
  forfeitCancelledAppointmentDepositForOwnerInTx,
} from '@/libs/deposits/depositForfeiture';
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
    rateLimitKey: 'admin-deposit-forfeit',
    salonSlug: new URL(request.url).searchParams.get('salonSlug'),
    appointmentId,
  });
  if (!access.ok) {
    return access.response;
  }

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
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

  try {
    const result = await db.transaction(tx =>
      forfeitCancelledAppointmentDepositForOwnerInTx({
        tx,
        salonId: access.salon.id,
        appointmentId,
        invoiceCurrency: access.appointment?.invoiceCurrency ?? null,
        forfeitedAt: new Date(),
        appointmentLockHeld: true,
        ownerAction: {
          performedBy: access.actor.performedBy,
          performedByName: access.actor.performedByName,
          reason: parsed.data.reason,
        },
      }));

    return Response.json({
      disposition: result.disposition,
      depositIds: result.depositIds,
      forfeitedCents: result.forfeitedCents,
    });
  } catch (error) {
    if (error instanceof DepositForfeitureInvalidStateError) {
      return Response.json(
        { error: { code: error.code, message: error.message } },
        { status: 409 },
      );
    }
    if (error instanceof DepositForfeitureBlockedError) {
      return Response.json(
        {
          error: {
            code: error.code,
            message: error.detail,
            details: { depositIds: error.depositIds },
          },
        },
        { status: 409 },
      );
    }
    throw error;
  }
}
