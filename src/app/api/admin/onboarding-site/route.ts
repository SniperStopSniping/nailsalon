import { z } from 'zod';

import {
  getOnboardingSiteHandoff,
  updateOnboardingSiteHandoff,
} from '@/features/onboarding-v1-integration/admin-handoff.server';
import { isOnboardingV1IntegrationEnabled } from '@/features/onboarding-v1-integration/config.server';
import { getAdminSession, requireAdminSalon } from '@/libs/adminAuth';

export const dynamic = 'force-dynamic';

const querySchema = z.object({
  locale: z.enum(['en', 'fr']).default('en'),
  salonSlug: z.string().trim().min(1).max(100),
});

const patchSchema = z.object({
  action: z.enum(['dismiss_welcome', 'complete_tour']),
  siteId: z.string().uuid().optional(),
}).strict();

const notFound = () => Response.json(
  { error: { code: 'NOT_FOUND', message: 'Onboarding site not found.' } },
  { status: 404 },
);

async function authorize(request: Request) {
  if (!isOnboardingV1IntegrationEnabled()) {
    return { error: notFound(), locale: 'en', salon: null } as const;
  }
  const parsed = querySchema.safeParse(
    Object.fromEntries(new URL(request.url).searchParams.entries()),
  );
  if (!parsed.success) {
    return {
      error: Response.json(
        { error: { code: 'VALIDATION_ERROR', message: 'A valid salon is required.' } },
        { status: 400 },
      ),
      locale: 'en',
      salon: null,
    } as const;
  }
  const { error, salon } = await requireAdminSalon(parsed.data.salonSlug);
  return { error, locale: parsed.data.locale, salon } as const;
}

export async function GET(request: Request) {
  const authorization = await authorize(request);
  if (authorization.error || !authorization.salon) {
    return authorization.error!;
  }
  const admin = await getAdminSession();
  const salon = authorization.salon;
  const data = await getOnboardingSiteHandoff({
    canEditSetup: admin?.salons.some(membership => (
      membership.salonId === salon.id && membership.role === 'owner'
    )) ?? false,
    locale: authorization.locale,
    salon,
  });
  if (!data) {
    return notFound();
  }
  return Response.json({ data }, {
    headers: { 'Cache-Control': 'private, no-store' },
  });
}

export async function PATCH(request: Request) {
  const authorization = await authorize(request);
  if (authorization.error || !authorization.salon) {
    return authorization.error!;
  }
  const payload = await request.json().catch(() => null);
  const parsed = patchSchema.safeParse(payload);
  if (!parsed.success) {
    return Response.json(
      { error: { code: 'VALIDATION_ERROR', message: 'That dashboard update is not valid.' } },
      { status: 400 },
    );
  }
  const updated = await updateOnboardingSiteHandoff({
    action: parsed.data.action,
    salonId: authorization.salon.id,
    ...(parsed.data.siteId ? { siteId: parsed.data.siteId } : {}),
  });
  if (!updated) {
    return notFound();
  }
  return Response.json({ ok: true }, {
    headers: { 'Cache-Control': 'private, no-store' },
  });
}
