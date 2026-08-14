import {
  requestDepositRefund,
  serializeDepositForRole,
} from '@/libs/deposits/depositLifecycle';
import {
  assertNoDevRoleBypass,
  requireDepositMoneyActor,
} from '@/libs/deposits/depositMoneyGuard';

type RouteContext = { params: Promise<{ id: string }> };

function resultResponse(
  result: Awaited<ReturnType<typeof requestDepositRefund>>,
  role: 'admin' | 'super_admin',
): Response {
  if (!result.ok) {
    return Response.json(
      { error: { code: result.code, message: result.message } },
      { status: result.status },
    );
  }

  return Response.json({
    disposition: result.disposition,
    deposit: serializeDepositForRole(role, result.deposit),
    ...(result.refundId ? { refundId: result.refundId } : {}),
  });
}

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
    rateLimitKey: 'admin-deposit-refund',
    salonSlug: new URL(request.url).searchParams.get('salonSlug'),
    appointmentId,
  });
  if (!access.ok) {
    return access.response;
  }

  return resultResponse(
    await requestDepositRefund({
      depositId: access.deposit.id,
      salonId: access.salon.id,
      actor: access.actor,
    }),
    access.admin.isSuperAdmin ? 'super_admin' : 'admin',
  );
}
