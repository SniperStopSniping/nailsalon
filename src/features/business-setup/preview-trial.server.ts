import 'server-only';

import { createHash } from 'node:crypto';

import { and, eq, sql } from 'drizzle-orm';

import type { AuthenticatedOnboardingIdentity } from '@/features/onboarding-v1-integration/persistence.server';
import { ensureOnboardingIdentityAdmin } from '@/features/onboarding-v1-integration/persistence.server';
import { db } from '@/libs/DB';
import { adminSalonMembershipSchema, salonSchema } from '@/models/Schema';

import { setupPreviewTrialEnabled } from './access.server';
import { CLOSED_HOURS, SetupError } from './contracts';

/** Private Preview entry only. Existing owners/salons are never reset or copied. */
export async function openPreviewTrial(identity: AuthenticatedOnboardingIdentity) {
  if (!setupPreviewTrialEnabled()) {
    throw new SetupError('NOT_FOUND', 'This test is not available.');
  }
  const suffix = createHash('sha256').update(identity.clerkUserId).digest('hex').slice(0, 32);
  const id = `ai_trial_${suffix}`;
  const slug = `ai-test-${suffix.slice(0, 16)}`;
  return db.transaction(async (tx) => {
    // Environment identity is checked by DB.ts as well; fail closed here even
    // when a caller supplies an already connected transaction in a test.
    const marker = await tx.execute(sql`SELECT environment FROM public.luster_environment`);
    if (marker.rows.length !== 1 || marker.rows[0]?.environment !== 'preview') {
      throw new SetupError('FORBIDDEN', 'This test requires the isolated test database.');
    }
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${id}))`);
    const admin = await ensureOnboardingIdentityAdmin(tx, identity, 'Test owner');
    const [existing] = await tx.select().from(salonSchema).where(eq(salonSchema.id, id));
    if (existing) {
      const [membership] = await tx.select().from(adminSalonMembershipSchema).where(and(eq(adminSalonMembershipSchema.salonId, id), eq(adminSalonMembershipSchema.adminId, admin.id), eq(adminSalonMembershipSchema.role, 'owner')));
      if (!membership || existing.deletedAt) {
        throw new SetupError('FORBIDDEN', 'This saved test is unavailable for your account.');
      }
      return existing.slug;
    }
    await tx.insert(salonSchema).values({ id, slug, name: 'My test business', ownerName: identity.name || 'Test owner', ownerClerkUserId: identity.clerkUserId, ownerEmail: identity.email, publicationStatus: 'draft', onlineBookingEnabled: false, businessHours: CLOSED_HOURS, settings: {}, isActive: true, status: 'active' });
    await tx.insert(adminSalonMembershipSchema).values({ adminId: admin.id, salonId: id, role: 'owner' });
    // Services, staff, prices and hours will come from the approved setup draft.
    // No starter credits, notifications, integrations or appointments are created.
    return slug;
  });
}
