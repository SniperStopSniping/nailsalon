import { z } from 'zod';

import { isPaymentWorkspaceEnabled } from '@/libs/customerPayments/workspacePolicy';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const actionSchema = z.object({
  kind: z.enum(['initialize', 'refresh', 'cancel_request', 'dispatch', 'reconcile_deposits']),
  requestId: z.string().uuid(),
  expectedRevision: z.number().int().min(0).max(2147483646),
  operationId: z.string().uuid().optional(),
}).strict();

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
    const actor = access.actor;
    const scope = { salonId: actor.salonId, appointmentId: actor.appointmentId };
    const [{ db }, { createPaymentWorkspaceRepository }, { readCurrentWorkspaceBinding, readPaymentWorkspaceView }] = await Promise.all([
      import('@/libs/DB'),
      import('@/libs/customerPayments/server/workspaceRepository'),
      import('@/libs/customerPayments/server/workspaceService'),
    ]);
    const repository = createPaymentWorkspaceRepository(db);
    if (!mutate) {
      return Response.json({ data: await readPaymentWorkspaceView(repository, actor) }, { headers: workspaceHeaders });
    }
    const [{ readCustomerJson }, { paymentWorkspaceCommandSchema, workspaceFailure }, { prepareWorkspaceInvoice }, { dispatchWorkspacePayment, reconcileWorkspacePayment, cancelWorkspacePayment }] = await Promise.all([
      import('@/libs/customerAssistant/http.server'),
      import('@/libs/customerPayments/server/workspaceContract'),
      import('@/libs/customerPayments/server/workspaceInvoice'),
      import('@/libs/customerPayments/server/workspaceDispatcher'),
    ]);
    const input = z.union([paymentWorkspaceCommandSchema, actionSchema]).parse(await readCustomerJson(request));
    let operationId: string | null = null;
    let checkoutUrl: string | null = null;
    if (input.kind === 'initialize') {
      if (input.expectedRevision !== 0 || input.operationId) {
        workspaceFailure('PAYMENT_WORKSPACE_INVALID_REQUEST');
      }
      await repository.initialize(actor, input.requestId, prepareWorkspaceInvoice);
    } else if (input.kind === 'reconcile_deposits') {
      if ((await repository.reconcileDeposits(scope, actor)).held) {
        workspaceFailure('PAYMENT_WORKSPACE_DEPOSIT_REVIEW_REQUIRED');
      }
    } else if (['request_payment', 'request_refund', 'approve_refund', 'reject_refund'].includes(input.kind)) {
      const command = paymentWorkspaceCommandSchema.parse(input);
      const result = await repository.command(actor, command, readCurrentWorkspaceBinding);
      operationId = command.kind === 'approve_refund'
        ? command.operationId
        : command.kind === 'request_payment' || command.kind === 'request_refund' ? result.state.operations.at(-1)?.id ?? null : null;
    } else {
      operationId = actionSchema.parse(input).operationId ?? workspaceFailure('PAYMENT_WORKSPACE_INVALID_REQUEST');
    }
    if (operationId) {
      // An immutable retry response is not today's operation state. Always read
      // current state before choosing a retry, retrieval, or no provider action.
      const current = await repository.read(actor);
      const operation = current?.operations.find(item => item.id === operationId);
      if (!operation) {
        return workspaceFailure('PAYMENT_WORKSPACE_NOT_FOUND');
      }
      const key = process.env.STRIPE_SECRET_KEY ?? '';
      if (input.kind === 'cancel_request') {
        if (operation.firstDispatchAt === null) {
          await repository.cancelUndispatched(actor, { requestId: input.requestId, expectedRevision: input.expectedRevision, operationId });
        } else {
          await cancelWorkspacePayment(repository, actor, input.expectedRevision, operationId, key);
        }
      } else if (input.kind === 'refresh') {
        if (operation.providerObjectId) {
          checkoutUrl = (await reconcileWorkspacePayment(repository, scope, operationId, key)).checkoutUrl;
        }
      } else if (['prepared', 'uncertain', 'dispatching'].includes(operation.state) && !operation.providerObjectId) {
        checkoutUrl = (await dispatchWorkspacePayment(repository, actor, operationId, key, readCurrentWorkspaceBinding)).checkoutUrl;
      } else if (['open', 'pending', 'review', 'uncertain'].includes(operation.state) && operation.providerObjectId) {
        checkoutUrl = (await reconcileWorkspacePayment(repository, scope, operationId, key)).checkoutUrl;
      }
    }
    const view = await readPaymentWorkspaceView(repository, actor);
    // Return the transient Stripe capability only while that same operation is open.
    if (view.sourceChanged || !view.operations.some(item => item.id === operationId && item.state === 'open')) {
      checkoutUrl = null;
    }
    return Response.json({ data: view, checkoutUrl }, { headers: workspaceHeaders });
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
