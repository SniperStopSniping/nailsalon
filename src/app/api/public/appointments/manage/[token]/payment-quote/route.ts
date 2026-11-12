import { isCustomerPaymentPreparationEnabled } from '@/libs/customerPayments/preparationGate';
import { CUSTOMER_PAYMENT_NO_STORE, readCustomerPaymentJson } from '@/libs/customerPayments/preparationHttp';
import { customerPaymentQuoteRequestSchema } from '@/libs/customerPayments/quoteRequest';
import { hasExactRequestOrigin } from '@/libs/requestOriginGuard';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function fail(code: string, status: number) {
  return Response.json({ error: { code } }, { status, headers: CUSTOMER_PAYMENT_NO_STORE });
}

/** Persists an authoritative TEST DRAFT only. There is no checkout/charge path. */
export async function POST(request: Request, props: { params: Promise<{ token: string }> }) {
  // These gates run before DB, capability or provider-related modules load.
  if (!isCustomerPaymentPreparationEnabled()) {
    return fail('NOT_FOUND', 404);
  }
  if (!hasExactRequestOrigin(request) || request.headers.get('sec-fetch-site') === 'cross-site') {
    return fail('ORIGIN_REQUIRED', 403);
  }
  const { token } = await props.params;
  if (!/^[\w-]{32,128}$/.test(token)) {
    return fail('APPOINTMENT_NOT_FOUND', 404);
  }
  const intent = customerPaymentQuoteRequestSchema.safeParse(await readCustomerPaymentJson(request));
  if (!intent.success) {
    return fail('INVALID_REQUEST', 400);
  }
  try {
    const [{ db }, { prepareCustomerPaymentQuoteForToken }] = await Promise.all([
      import('@/libs/DB'),
      import('@/libs/customerPayments/server/prepareQuoteForToken'),
    ]);
    const quote = await prepareCustomerPaymentQuoteForToken(db, token, intent.data);
    const snapshot = quote.snapshot;
    // Never return account IDs, capability identity, raw financial source rows,
    // provider URLs or the server-only context/fingerprint material.
    return Response.json({ data: {
      quoteId: quote.id,
      fingerprint: quote.fingerprint,
      expiresAt: quote.expiresAt.toISOString(),
      testOnly: true,
      collectionEnabled: false,
      executable: false,
      currency: 'CAD',
      servicesCents: snapshot.servicesCents,
      discountCents: snapshot.discountCents,
      taxCents: snapshot.taxCents,
      tipCents: snapshot.tipCents,
      customerFeeCents: snapshot.customerPlatformFeeCents + snapshot.customerFeeTaxCents,
      totalCents: snapshot.totalCents,
      dueNowCents: snapshot.chargeCents,
      remainingCents: snapshot.remainingCents,
    } }, { headers: CUSTOMER_PAYMENT_NO_STORE });
  } catch (error) {
    const code = error instanceof Error ? error.message : '';
    if (code === 'CUSTOMER_PAYMENT_ACCESS_REQUIRED' || code === 'CUSTOMER_PAYMENT_APPOINTMENT_NOT_FOUND') {
      return fail('APPOINTMENT_NOT_FOUND', 404);
    }
    if (code === 'CUSTOMER_PAYMENT_PREPARATION_DISABLED') {
      return fail('NOT_FOUND', 404);
    }
    if (code === 'CUSTOMER_PAYMENT_QUOTE_STALE' || code === 'CUSTOMER_PAYMENT_QUOTE_REPLAY_CONFLICT') {
      return fail('QUOTE_REVIEW_REQUIRED', 409);
    }
    if (code.startsWith('CUSTOMER_PAYMENT_')) {
      return fail('PAYMENT_QUOTE_UNAVAILABLE', 409);
    }
    return fail('PAYMENT_PREPARATION_UNAVAILABLE', 503);
  }
}
