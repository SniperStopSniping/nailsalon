import { isCustomerPaymentPreparationEnabled } from '@/libs/customerPayments/preparationGate';
import { customerPaymentDraftWriteSchema } from '@/libs/customerPayments/settings';

export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' };
function failure(code: string, status: number) {
  return Response.json({ error: { code } }, { status, headers });
}

async function owner(request: Request) {
  const slug = new URL(request.url).searchParams.get('salonSlug');
  if (!slug || slug.length > 200) {
    return { response: failure('SALON_SLUG_REQUIRED', 400) };
  }
  // Gate is checked by each handler before loading auth or any DB dependency.
  const [{ requireAdminOwner }, { getSalonBySlug }] = await Promise.all([
    import('@/libs/adminAuth'),
    import('@/libs/queries'),
  ]);
  const salon = await getSalonBySlug(slug);
  if (!salon) {
    return { response: failure('SALON_NOT_FOUND', 404) };
  }
  const guard = await requireAdminOwner(salon.id);
  if (!guard.ok) {
    return { response: guard.response };
  }
  return { salonId: salon.id, actorId: guard.admin.id };
}

async function repository() {
  const [{ db }, { createCustomerPaymentPreparationRepository }] = await Promise.all([
    import('@/libs/DB'),
    import('@/libs/customerPayments/server/preparationRepository'),
  ]);
  return createCustomerPaymentPreparationRepository(db);
}

export async function GET(request: Request): Promise<Response> {
  if (!isCustomerPaymentPreparationEnabled()) {
    return failure('NOT_FOUND', 404);
  }
  try {
    const access = await owner(request);
    if (access.response) {
      return access.response;
    }
    const result = await (await repository()).readCustomerPaymentSettingsDraft(access.salonId!);
    return Response.json(result, { headers });
  } catch {
    return failure('CUSTOMER_PAYMENT_DRAFT_UNAVAILABLE', 503);
  }
}

export async function PATCH(request: Request): Promise<Response> {
  if (!isCustomerPaymentPreparationEnabled()) {
    return failure('NOT_FOUND', 404);
  }
  if (request.headers.get('origin') !== new URL(request.url).origin || request.headers.get('sec-fetch-site') === 'cross-site') {
    return failure('ORIGIN_FORBIDDEN', 403);
  }
  try {
    const access = await owner(request);
    if (access.response) {
      return access.response;
    }
    const { readCustomerJson } = await import('@/libs/customerAssistant/http.server');
    const parsed = customerPaymentDraftWriteSchema.safeParse(await readCustomerJson(request));
    if (!parsed.success) {
      return failure('INVALID_CUSTOMER_PAYMENT_DRAFT', 400);
    }
    const result = await (await repository()).saveCustomerPaymentSettingsDraft({ ...parsed.data, salonId: access.salonId!, actorId: access.actorId! });
    return Response.json(result, { headers });
  } catch (error) {
    const code = error instanceof Error ? error.message : '';
    if (code === 'CUSTOMER_PAYMENT_DRAFT_REVISION_CONFLICT' || code === 'CUSTOMER_PAYMENT_DRAFT_REPLAY_CONFLICT') {
      return failure(code, 409);
    }
    return failure('CUSTOMER_PAYMENT_DRAFT_UNAVAILABLE', 503);
  }
}
