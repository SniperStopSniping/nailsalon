import { z } from 'zod';

import { requireAdminSalon } from '@/libs/adminAuth';

export const dynamic = 'force-dynamic';

// Staff profiles and scheduling remain owner-managed. Do not send links to
// retired staff authentication, including requests from older owner screens.
export async function POST(request: Request, _props: { params: Promise<{ id: string }> }): Promise<Response> {
  const parsed = z.object({ salonSlug: z.string().min(1) }).safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success) {
    return Response.json({ error: { code: 'VALIDATION_ERROR', message: 'Salon slug is required' } }, { status: 400 });
  }
  const { error, salon } = await requireAdminSalon(parsed.data.salonSlug);
  if (error || !salon) {
    return error!;
  }
  return Response.json({ error: {
    code: 'STAFF_ACCESS_UNAVAILABLE',
    message: 'Staff sign-in invitations are unavailable. Manage technician profiles, services and schedules in Team.',
  } }, { status: 410 });
}
