import { customerPaymentCreditReviewPreviewSchema, customerPaymentCreditReviewRequestSchema, customerPaymentCreditReviewResultSchema } from '@/libs/customerPayments/creditReviewContract';
import { isCustomerPaymentCreditReviewTestEnabled } from '@/libs/customerPayments/creditReviewTestGate';
import { CUSTOMER_PAYMENT_NO_STORE, readCustomerPaymentJson } from '@/libs/customerPayments/preparationHttp';

export const dynamic = 'force-dynamic';
type Context = { params: Promise<{ id: string }> };
function failure(code: string, status: number) {
  return Response.json({ error: { code } }, { status, headers: CUSTOMER_PAYMENT_NO_STORE });
}
async function access(request: Request, context: Context) {
  const slug = new URL(request.url).searchParams.get('salonSlug');
  const { id } = await context.params;
  if (!slug?.trim() || slug.length > 200 || !id.trim() || id.length > 200) {
    return { response: failure('INVALID_SCOPE', 400) };
  }
  const [{ requireRealSalonOwner }, { getSalonBySlug }] = await Promise.all([import('@/libs/adminAuth'), import('@/libs/queries')]);
  const salon = await getSalonBySlug(slug);
  if (!salon) {
    return { response: failure('NOT_FOUND', 404) };
  }
  const guard = await requireRealSalonOwner(salon.id);
  if (!guard.ok) {
    return { response: new Response(guard.response.body, { status: guard.response.status, headers: { ...CUSTOMER_PAYMENT_NO_STORE, 'Content-Type': 'application/json' } }) };
  }
  return { scope: { salonId: salon.id, appointmentId: id }, actor: { adminId: guard.admin.id, authenticated: true as const, impersonating: false as const } };
}
function caught(error: unknown) {
  const code = error instanceof Error ? error.message : '';
  if (code === 'CUSTOMER_PAYMENT_CREDIT_APPOINTMENT_NOT_FOUND') {
    return failure('NOT_FOUND', 404);
  }
  if (code === 'CUSTOMER_PAYMENT_CREDIT_OWNER_REQUIRED') {
    return failure('OWNER_REQUIRED', 403);
  }
  if (code.startsWith('CUSTOMER_PAYMENT_CREDIT_')) {
    return failure('CREDIT_REVIEW_REQUIRED', 409);
  }
  return failure('CREDIT_REVIEW_UNAVAILABLE', 503);
}
export async function GET(request: Request, context: Context) {
  if (!isCustomerPaymentCreditReviewTestEnabled()) {
    return failure('NOT_FOUND', 404);
  }
  try {
    const auth = await access(request, context);
    if (auth.response) {
      return auth.response;
    }
    const [{ db }, { previewSyntheticCreditReview }] = await Promise.all([import('@/libs/DB'), import('@/libs/customerPayments/server/recordSyntheticCreditDecision')]);
    const result = await previewSyntheticCreditReview(db, auth.actor!, auth.scope!);
    // Serialize dates, then strip every field outside the explicit public DTO.
    return Response.json(customerPaymentCreditReviewPreviewSchema.parse(JSON.parse(JSON.stringify(result))), { headers: CUSTOMER_PAYMENT_NO_STORE });
  } catch (error) {
    return caught(error);
  }
}
export async function POST(request: Request, context: Context) {
  if (!isCustomerPaymentCreditReviewTestEnabled()) {
    return failure('NOT_FOUND', 404);
  }
  if (request.headers.get('origin') !== new URL(request.url).origin || request.headers.get('sec-fetch-site') === 'cross-site') {
    return failure('ORIGIN_FORBIDDEN', 403);
  }
  const body = customerPaymentCreditReviewRequestSchema.safeParse(await readCustomerPaymentJson(request));
  if (!body.success) {
    return failure('INVALID_CREDIT_REVIEW', 400);
  }
  try {
    const auth = await access(request, context);
    if (auth.response) {
      return auth.response;
    }
    const [{ db }, { recordSyntheticCreditDecision }] = await Promise.all([import('@/libs/DB'), import('@/libs/customerPayments/server/recordSyntheticCreditDecision')]);
    const result = await recordSyntheticCreditDecision(db, auth.actor!, { ...body.data, ...auth.scope! });
    return Response.json(customerPaymentCreditReviewResultSchema.parse(JSON.parse(JSON.stringify(result))), { headers: CUSTOMER_PAYMENT_NO_STORE });
  } catch (error) {
    return caught(error);
  }
}
