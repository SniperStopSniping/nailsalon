import { z } from 'zod';

import { isPaymentWorkspaceEnabled } from '@/libs/customerPayments/workspacePolicy';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;
const actionSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('request_payment'), requestId: z.string().uuid(), initializationId: z.string().uuid(), expectedRevision: z.number().int().nonnegative(), expectedInvoiceHash: z.string().regex(/^[a-f0-9]{64}$/), acceptedPolicyRevision: z.number().int().positive() }).strict(),
  z.object({ kind: z.literal('refresh'), operationId: z.string().uuid() }).strict(),
  z.object({ kind: z.literal('resume'), operationId: z.string().uuid() }).strict(),
]);

async function handle(request: Request, token: string, mutate: boolean) {
  if (!isPaymentWorkspaceEnabled()) {
    return new Response(null, { status: 404 });
  }
  const { workspaceError, workspaceHeaders, workspaceOriginAllowed } = await import('@/libs/customerPayments/server/workspaceHttp');
  const headers = { ...workspaceHeaders, 'Referrer-Policy': 'no-referrer' };
  if (mutate && !workspaceOriginAllowed(request)) {
    return Response.json({ error: { code: 'ORIGIN_FORBIDDEN' } }, { status: 403, headers });
  }
  try {
    const { checkEndpointRateLimit, getClientIp } = await import('@/libs/rateLimit');
    if (!checkEndpointRateLimit('customer-payment-workspace', getClientIp(request), mutate ? 'BILLING' : 'GENERAL').allowed) {
      return Response.json({ error: { code: 'RATE_LIMITED' } }, { status: 429, headers });
    }
    const [{ db }, { resolveCustomerWorkspaceActor }, { createPaymentWorkspaceRepository }, { readCustomerWorkspaceView }, { PaymentWorkspaceError, workspaceFailure }] = await Promise.all([
      import('@/libs/DB'),
      import('@/libs/customerPayments/server/workspaceAccess'),
      import('@/libs/customerPayments/server/workspaceRepository'),
      import('@/libs/customerPayments/server/customerWorkspaceService'),
      import('@/libs/customerPayments/server/workspaceContract'),
    ]);
    const actor = await resolveCustomerWorkspaceActor(db, token);
    const repository = createPaymentWorkspaceRepository(db);
    if (!mutate) {
      const data = await readCustomerWorkspaceView(repository, actor);
      return Response.json(data ? { data } : { error: { code: 'PAYMENTS_UNAVAILABLE' } }, { status: data ? 200 : 404, headers });
    }
    const [{ readCustomerJson }, { prepareWorkspaceInvoice }, { readCurrentWorkspaceBinding }, { dispatchWorkspacePayment, reconcileWorkspacePayment }, { readWorkspaceBinding }, { workspaceRuntime }] = await Promise.all([
      import('@/libs/customerAssistant/http.server'),
      import('@/libs/customerPayments/server/workspaceInvoice'),
      import('@/libs/customerPayments/server/workspaceService'),
      import('@/libs/customerPayments/server/workspaceDispatcher'),
      import('@/libs/customerPayments/server/workspacePolicyRepository'),
      import('@/libs/customerPayments/server/workspaceRuntime'),
    ]);
    const input = actionSchema.parse(await readCustomerJson(request));
    let operationId: string;
    if (input.kind === 'request_payment') {
      if (!await repository.read(actor)) {
        try {
          await repository.initialize(actor, input.initializationId, async (tx, appointment) => {
            const material = await prepareWorkspaceInvoice(tx, appointment);
            const binding = await readWorkspaceBinding(tx, appointment.salonId, workspaceRuntime());
            if (!binding || binding.policyRevision !== input.acceptedPolicyRevision) {
              return workspaceFailure('PAYMENT_WORKSPACE_POLICY_ACCEPTANCE_REQUIRED');
            }
            if (material.billSourceHash !== input.expectedInvoiceHash) {
              return workspaceFailure('PAYMENT_WORKSPACE_BILL_CHANGED');
            }
            return material;
          });
        } catch (error) {
          if (!(error instanceof PaymentWorkspaceError) || error.code !== 'PAYMENT_WORKSPACE_ALREADY_EXISTS') {
            throw error;
          }
        }
      }
      const { initializationId: _initializationId, ...command } = input;
      const result = await repository.command(actor, command, readCurrentWorkspaceBinding);
      operationId = result.state.operations.at(-1)?.id ?? workspaceFailure('PAYMENT_WORKSPACE_NOT_FOUND');
    } else {
      operationId = input.operationId;
    }
    const current = await repository.read(actor);
    const operation = current?.operations.find(item => item.id === operationId && item.kind === 'payment');
    if (!operation) {
      return workspaceFailure('PAYMENT_WORKSPACE_NOT_FOUND');
    }
    let checkoutUrl: string | null = null;
    const key = process.env.STRIPE_SECRET_KEY ?? '';
    if (input.kind !== 'refresh' && ['prepared', 'uncertain', 'dispatching'].includes(operation.state) && !operation.providerObjectId) {
      checkoutUrl = (await dispatchWorkspacePayment(repository, actor, operationId, key, readCurrentWorkspaceBinding)).checkoutUrl;
    } else if (operation.providerObjectId && ['open', 'pending', 'uncertain', 'review'].includes(operation.state)) {
      checkoutUrl = (await reconcileWorkspacePayment(repository, { salonId: actor.salonId, appointmentId: actor.appointmentId }, operationId, key)).checkoutUrl;
    }
    const data = await readCustomerWorkspaceView(repository, actor);
    if (!data || data.needsReview || data.activePayment?.id !== operationId || data.activePayment.state !== 'open' || !data.policy.revision) {
      checkoutUrl = null;
    }
    return Response.json({ data, checkoutUrl }, { headers });
  } catch (error) {
    const response = workspaceError(error);
    response.headers.set('Referrer-Policy', 'no-referrer');
    return response;
  }
}

export async function GET(request: Request, props: { params: Promise<{ token: string }> }) {
  return handle(request, (await props.params).token, false);
}
export async function POST(request: Request, props: { params: Promise<{ token: string }> }) {
  return handle(request, (await props.params).token, true);
}
