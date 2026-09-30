import { and, eq } from 'drizzle-orm';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { z } from 'zod';

import { COOKIE_OPTIONS, getAdminImpersonationForAdmin, getAdminSession } from '@/libs/adminAuth';
import { db } from '@/libs/DB';
import { ACTIVE_SALON_COOKIE } from '@/libs/tenantSlug';
import { adminSalonMembershipSchema } from '@/models/Schema';

export const dynamic = 'force-dynamic';

const visibilitySchema = z.object({ hidden: z.boolean() }).strict();

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ salonId: string }> },
) {
  const { salonId } = await params;
  const admin = await getAdminSession();
  if (!admin) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  if (await getAdminImpersonationForAdmin(admin)) {
    return NextResponse.json({ error: 'Cannot change salons while impersonating' }, { status: 403 });
  }

  const membership = admin.salons.find(
    salon => salon.salonId === salonId && salon.role === 'owner',
  );
  if (!membership) {
    return NextResponse.json({ error: 'Only the salon owner can change this list' }, { status: 403 });
  }

  const parsed = visibilitySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid visibility request' }, { status: 400 });
  }

  const [updated] = await db.update(adminSalonMembershipSchema)
    .set({ hiddenFromChooserAt: parsed.data.hidden ? new Date() : null })
    .where(and(
      eq(adminSalonMembershipSchema.adminId, admin.id),
      eq(adminSalonMembershipSchema.salonId, membership.salonId),
      eq(adminSalonMembershipSchema.role, 'owner'),
    ))
    .returning();

  if (!updated) {
    return NextResponse.json({ error: 'Salon ownership has changed. Refresh and try again.' }, { status: 403 });
  }

  if (parsed.data.hidden) {
    const cookieStore = await cookies();
    if (cookieStore.get(ACTIVE_SALON_COOKIE)?.value?.toLowerCase() === membership.salonSlug.toLowerCase()) {
      cookieStore.set(ACTIVE_SALON_COOKIE, '', { ...COOKIE_OPTIONS, maxAge: 0 });
    }
  }

  return NextResponse.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } });
}
