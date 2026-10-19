import 'server-only';

import { createHash } from 'node:crypto';

import { and, eq, isNull, sql } from 'drizzle-orm';

import { type AuthenticatedOnboardingIdentity, ensureOnboardingIdentityAdmin } from '@/features/onboarding-v1-integration/persistence.server';
import { db } from '@/libs/DB';
import { adminSalonMembershipSchema as memberships, salonSchema as salons } from '@/models/Schema';

import { businessSetupSelfServeEnabled } from './access.server';
import { CLOSED_HOURS, SetupError } from './contracts';

export type AiBuilderEntry = { kind: 'ready'; slug: string } | { kind: 'choose'; salons: { slug: string; name: string }[] };

/** Verified account -> existing owned salon or exactly one private new salon. */
export async function openAiBuilder(identity: AuthenticatedOnboardingIdentity, salonSlug?: string): Promise<AiBuilderEntry> {
  if (!businessSetupSelfServeEnabled()) {
    throw new SetupError('NOT_FOUND', 'AI website setup is not available yet.');
  }
  const suffix = createHash('sha256').update(identity.clerkUserId).digest('hex').slice(0, 32);
  const id = `ai_setup_${suffix}`;
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${id}))`);
    const admin = await ensureOnboardingIdentityAdmin(tx, identity, 'Business owner');
    const owned = await tx.select({ slug: salons.slug, name: salons.name }).from(memberships)
      .innerJoin(salons, eq(salons.id, memberships.salonId))
      .where(and(eq(memberships.adminId, admin.id), eq(memberships.role, 'owner'), isNull(salons.deletedAt)))
      .orderBy(salons.name).limit(50);
    if (salonSlug) {
      const selected = owned.find(salon => salon.slug === salonSlug);
      if (!selected) {
        throw new SetupError('FORBIDDEN', 'Choose a business you own to continue.');
      }
      return { kind: 'ready', slug: selected.slug };
    }
    if (owned.length === 1) {
      return { kind: 'ready', slug: owned[0]!.slug };
    }
    if (owned.length > 1) {
      return { kind: 'choose', salons: owned };
    }
    // A previously removed/deleted membership must never be recreated merely
    // because the same account returns through the new-owner entry.
    const [existing] = await tx.select({ id: salons.id }).from(salons).where(eq(salons.id, id));
    if (existing) {
      throw new SetupError('FORBIDDEN', 'This saved business is unavailable for your account.');
    }
    const slug = `studio-${suffix.slice(0, 16)}`;
    await tx.insert(salons).values({ id, slug, name: 'Untitled business', ownerName: identity.name?.trim() || 'Business owner', ownerClerkUserId: identity.clerkUserId, ownerEmail: identity.email.trim().toLowerCase(), publicationStatus: 'draft', publishedAt: null, onlineBookingEnabled: false, businessHours: CLOSED_HOURS, smsRemindersEnabled: false, plan: 'free', freeSoloEnabled: true, maxLocations: 1, settings: { rebookingPrompt: { enabled: false } }, isActive: true, status: 'active' });
    await tx.insert(memberships).values({ adminId: admin.id, salonId: id, role: 'owner' });
    // No services, appointments, trial/paid credits or external actions.
    // The existing setup loader and exact publisher own the remaining draft.
    return { kind: 'ready', slug };
  });
}
