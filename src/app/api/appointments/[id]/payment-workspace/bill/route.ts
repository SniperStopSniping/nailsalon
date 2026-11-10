import { isPaymentWorkspaceEnabled } from '@/libs/customerPayments/workspacePolicy';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function handle(request: Request, appointmentId: string, mutate: boolean) {
  if (!isPaymentWorkspaceEnabled()) {
    return new Response(null, { status: 404 });
  }
  const { workspaceError, workspaceHeaders, workspaceOriginAllowed } = await import('@/libs/customerPayments/server/workspaceHttp');
  if (mutate && !workspaceOriginAllowed(request)) {
    return Response.json({ error: { code: 'ORIGIN_FORBIDDEN' } }, { status: 403, headers: workspaceHeaders });
  }
  try {
    const { requireWorkspaceActor } = await import('@/libs/customerPayments/server/workspaceAccess');
    const access = await requireWorkspaceActor(request, appointmentId);
    if (!access.ok) {
      return access.response;
    }
    const [{ db }, { createPaymentWorkspaceRepository }, { readCompletedBill, reviseCompletedBill }] = await Promise.all([
      import('@/libs/DB'),
      import('@/libs/customerPayments/server/workspaceRepository'),
      import('@/libs/customerPayments/server/completedBillService'),
    ]);
    const repository = createPaymentWorkspaceRepository(db);
    if (mutate) {
      const { readCustomerJson } = await import('@/libs/customerAssistant/http.server');
      await reviseCompletedBill(repository, access.actor, await readCustomerJson(request));
      return Response.json({ data: { saved: true } }, { headers: workspaceHeaders });
    }
    return Response.json({ data: await readCompletedBill(repository, access.actor) }, { headers: workspaceHeaders });
  } catch (error) {
    return workspaceError(error);
  }
}

export async function GET(request: Request, props: { params: Promise<{ id: string }> }) {
  return handle(request, (await props.params).id, false);
}

export async function POST(request: Request, props: { params: Promise<{ id: string }> }) {
  return handle(request, (await props.params).id, true);
}
