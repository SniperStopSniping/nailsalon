import { StripeCustomerPaymentReceiptError, verifyStripeCustomerPaymentReceipt } from '@/libs/customerPayments/liveProvider/stripeReceipt';
import { reconcileWorkspacePayment } from '@/libs/customerPayments/server/workspaceDispatcher';
import { createPaymentWorkspaceRepository } from '@/libs/customerPayments/server/workspaceRepository';
import { db } from '@/libs/DB';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;
const headers = { 'Cache-Control': 'no-store' };

export async function POST(request: Request): Promise<Response> {
  const environment = process.env.APP_ENV;
  const signingSecret = process.env.STRIPE_CUSTOMER_PAYMENTS_WEBHOOK_SECRET;
  const endpointId = process.env.CUSTOMER_PAYMENTS_STRIPE_WEBHOOK_ENDPOINT_ID;
  const platformAccountId = process.env.CUSTOMER_PAYMENTS_STRIPE_PLATFORM_ACCOUNT_ID;
  const secretKey = process.env.STRIPE_SECRET_KEY;
  if (!['production', 'preview', 'development', 'test'].includes(environment ?? '') || !signingSecret || !endpointId || !platformAccountId || !secretKey) {
    return Response.json({ error: { code: 'PAYMENT_WEBHOOK_UNAVAILABLE' } }, { status: 503, headers });
  }
  const signature = request.headers.get('stripe-signature');
  if (!signature || !request.body) {
    return Response.json({ error: { code: 'PAYMENT_WEBHOOK_SIGNATURE_REQUIRED' } }, { status: 400, headers });
  }
  const reader = request.body.getReader();
  let size = 0;
  const chunks: Uint8Array[] = [];
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) {
        break;
      }
      size += value.byteLength;
      if (size > 512 * 1024) {
        await reader.cancel();
        return Response.json({ error: { code: 'PAYMENT_WEBHOOK_TOO_LARGE' } }, { status: 413, headers });
      }
      chunks.push(value);
    }
    const receipt = verifyStripeCustomerPaymentReceipt(Buffer.concat(chunks), signature, {
      endpointId,
      platformAccountId,
      signingSecret,
      livemode: environment === 'production',
      apiVersion: '2024-06-20',
    });
    const repository = createPaymentWorkspaceRepository(db);
    const saved = await repository.retainReceipt(receipt);
    const association = await repository.associateReceipt(saved.receiptId);
    if (association && !association.held) {
      // Await accounting before acknowledgement. A failed read returns 503 so
      // Stripe retries; the immutable ingress record already survives a crash.
      await reconcileWorkspacePayment(repository, association.scope, association.operationId, secretKey);
    }
    return Response.json({ received: true }, { headers });
  } catch (error) {
    if (error instanceof StripeCustomerPaymentReceiptError && error.code !== 'STRIPE_RECEIPT_INVALID_CONFIGURATION') {
      return Response.json({ error: { code: 'PAYMENT_WEBHOOK_REJECTED' } }, { status: 400, headers });
    }
    return Response.json({ error: { code: 'PAYMENT_WEBHOOK_RETRY' } }, { status: 503, headers });
  } finally {
    reader.releaseLock();
  }
}
