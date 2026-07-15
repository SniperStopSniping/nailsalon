import { currentUser } from '@clerk/nextjs/server';
import { and, eq, isNull, or, sql } from 'drizzle-orm';
import { z } from 'zod';

import { formatPhoneE164 } from '@/libs/adminAuth';
import { logAuditEvent } from '@/libs/auditLog';
import { db } from '@/libs/DB';
import { hashOpaqueToken } from '@/libs/lusterSecurity';
import { buildSalonTenantPublicUrl, getCanonicalAppOrigin } from '@/libs/publicUrl';
import { isValidSalonSlug } from '@/libs/tenantSlug';
import {
  adminInviteSchema,
  adminSalonMembershipSchema,
  adminUserSchema,
  appointmentSchema,
  salonLocationSchema,
  salonSchema,
  salonSignupInviteSchema,
  serviceSchema,
  technicianSchema,
  technicianServicesSchema,
} from '@/models/Schema';

export const dynamic = 'force-dynamic';

const timeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const daySchema = z.object({ open: timeSchema, close: timeSchema }).refine(
  value => value.close > value.open,
  { message: 'Closing time must be after opening time.' },
).nullable();
const hoursSchema = z.object({
  monday: daySchema,
  tuesday: daySchema,
  wednesday: daySchema,
  thursday: daySchema,
  friday: daySchema,
  saturday: daySchema,
  sunday: daySchema,
});
const setupSchema = z.object({
  inviteToken: z.string().min(20),
  salonName: z.string().trim().min(2).max(80),
  ownerName: z.string().trim().min(2).max(80),
  ownerPhone: z.string().min(10),
  slug: z.string().trim().toLowerCase(),
  timezone: z.string().trim().min(1).default('America/Toronto'),
  address: z.string().trim().max(200).optional(),
  city: z.string().trim().max(100).optional(),
  province: z.string().trim().max(100).optional(),
  postalCode: z.string().trim().max(20).optional(),
  logoUrl: z.string().url().optional().or(z.literal('')),
  businessHours: hoursSchema,
  services: z.array(z.object({
    name: z.string().trim().min(2).max(100),
    priceCents: z.number().int().min(0).max(1_000_000),
    durationMinutes: z.number().int().min(15).max(480),
    category: z.enum(['manicure', 'builder_gel', 'extensions', 'pedicure', 'combo']),
  })).min(1).max(20),
});

function getUniqueConstraint(error: unknown): string | null {
  let current: unknown = error;
  for (let depth = 0; depth < 4 && current && typeof current === 'object'; depth += 1) {
    const candidate = current as { code?: unknown; constraint?: unknown; cause?: unknown };
    if (candidate.code === '23505') {
      return typeof candidate.constraint === 'string' ? candidate.constraint : '';
    }
    current = candidate.cause;
  }
  return null;
}

function normalizeSetupError(error: unknown): string {
  const constraint = getUniqueConstraint(error);
  if (constraint !== null) {
    if (constraint.includes('salon_slug') || constraint === 'salon_slug_key') {
      return 'SLUG_TAKEN';
    }
    if (
      constraint.includes('admin_user_clerk_user')
      || constraint.includes('admin_user_email')
      || constraint.includes('admin_user_phone')
    ) {
      return constraint.includes('admin_user_phone') ? 'OWNER_PHONE_CONFLICT' : 'OWNER_ACCOUNT_CONFLICT';
    }
  }
  return error instanceof Error ? error.message : 'SETUP_FAILED';
}

const freeSoloFeatures = {
  booking: { onlineBooking: true, staffDashboard: true },
  staff: { scheduleOverrides: false, timeOff: true },
  clients: { clientProfiles: true, clientHistory: true },
  social: { photoUploads: false },
  marketing: { smsReminders: true, referrals: false, rewards: false },
  money: { staffEarnings: false },
  analytics: { dashboard: false, utilization: false },
  controls: { clientBlocking: false, clientFlags: false },
  multiLocation: false,
  advancedAnalytics: false,
  revenueReports: false,
  techPerformance: false,
  customBranding: true,
  apiAccess: false,
};

export async function POST(request: Request) {
  const clerkUser = await currentUser();
  if (!clerkUser) {
    return Response.json({ error: { code: 'UNAUTHENTICATED', message: 'Sign in to finish setup.' } }, { status: 401 });
  }

  const parsed = setupSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: { code: 'INVALID_SETUP', message: 'Check the required setup fields.', details: parsed.error.flatten() } }, { status: 400 });
  }
  const input = parsed.data;
  if (!isValidSalonSlug(input.slug)) {
    return Response.json({ error: { code: 'INVALID_SLUG', message: 'Choose a lowercase salon link using letters, numbers, or hyphens.' } }, { status: 400 });
  }
  if (!Object.values(input.businessHours).some(Boolean)) {
    return Response.json({ error: { code: 'NO_BOOKABLE_HOURS', message: 'Add at least one bookable day.' } }, { status: 400 });
  }
  try {
    new Intl.DateTimeFormat('en-CA', { timeZone: input.timezone }).format(new Date());
  } catch {
    return Response.json({ error: { code: 'INVALID_TIMEZONE', message: 'Choose a valid timezone.' } }, { status: 400 });
  }

  const primaryEmail = clerkUser.emailAddresses.find(item => item.id === clerkUser.primaryEmailAddressId);
  if (!primaryEmail || primaryEmail.verification?.status !== 'verified') {
    return Response.json({ error: { code: 'EMAIL_NOT_VERIFIED', message: 'Verify the invited email before finishing setup.' } }, { status: 403 });
  }
  const normalizedEmail = primaryEmail.emailAddress.trim().toLowerCase();
  let phoneE164: string;
  try {
    phoneE164 = formatPhoneE164(input.ownerPhone);
  } catch {
    return Response.json({ error: { code: 'INVALID_PHONE', message: 'Enter a valid Canadian or US phone number.' } }, { status: 400 });
  }

  const inviteTokenHash = hashOpaqueToken(input.inviteToken);
  let claimAuditSalonId: string | null = null;
  let claimAuditInviteId: string | null = null;
  try {
    const result = await db.transaction(async (tx) => {
      await tx.execute(sql`select id from ${salonSignupInviteSchema} where ${salonSignupInviteSchema.tokenHash} = ${inviteTokenHash} for update`);
      const [invite] = await tx
        .select()
        .from(salonSignupInviteSchema)
        .where(eq(salonSignupInviteSchema.tokenHash, inviteTokenHash))
        .limit(1);
      if (!invite) {
        throw new Error('INVITE_INVALID');
      }
      if (invite.invitedEmail.trim().toLowerCase() !== normalizedEmail) {
        throw new Error('INVITE_EMAIL_MISMATCH');
      }

      const now = new Date();
      const identityOwners = await tx
        .select({
          id: adminUserSchema.id,
          clerkUserId: adminUserSchema.clerkUserId,
          email: adminUserSchema.email,
        })
        .from(adminUserSchema)
        .where(or(
          eq(adminUserSchema.clerkUserId, clerkUser.id),
          eq(adminUserSchema.email, normalizedEmail),
        ))
        .limit(2);

      const clerkOwner = identityOwners.find(owner => owner.clerkUserId === clerkUser.id);
      const emailOwner = identityOwners.find(owner => owner.email?.trim().toLowerCase() === normalizedEmail);
      if (clerkOwner && emailOwner && clerkOwner.id !== emailOwner.id) {
        throw new Error('OWNER_ACCOUNT_CONFLICT');
      }
      const identityOwner = clerkOwner ?? emailOwner;

      if (identityOwner?.clerkUserId && identityOwner.clerkUserId !== clerkUser.id) {
        throw new Error('OWNER_ACCOUNT_CONFLICT');
      }

      const adminId = identityOwner?.id ?? crypto.randomUUID();
      if (identityOwner && !identityOwner.clerkUserId) {
        const linked = await tx
          .update(adminUserSchema)
          .set({ clerkUserId: clerkUser.id, emailVerifiedAt: now })
          .where(and(
            eq(adminUserSchema.id, identityOwner.id),
            isNull(adminUserSchema.clerkUserId),
          ))
          .returning();
        if (linked.length !== 1) {
          throw new Error('OWNER_ACCOUNT_CONFLICT');
        }
      }

      if (invite.consumedAt) {
        if (!invite.resultSalonId || invite.consumedByAdminId !== adminId) {
          throw new Error('INVITE_INVALID');
        }
        const [completedSalon] = await tx
          .select({
            id: salonSchema.id,
            slug: salonSchema.slug,
            customDomain: salonSchema.customDomain,
          })
          .from(salonSchema)
          .where(eq(salonSchema.id, invite.resultSalonId))
          .limit(1);
        if (!completedSalon) {
          throw new Error('INVITE_INVALID');
        }
        return {
          salonId: completedSalon.id,
          slug: completedSalon.slug,
          customDomain: completedSalon.customDomain,
          intent: invite.intent,
          created: false,
        };
      }
      if (invite.revokedAt || invite.expiresAt <= now) {
        throw new Error('INVITE_INVALID');
      }

      if (!identityOwner) {
        const [phoneOwner] = await tx
          .select({ id: adminUserSchema.id })
          .from(adminUserSchema)
          .where(eq(adminUserSchema.phoneE164, phoneE164))
          .limit(1);
        if (phoneOwner) {
          throw new Error('OWNER_PHONE_CONFLICT');
        }
      }

      let salonId: string;
      let salonName = input.salonName;
      let slug = input.slug;
      let customDomain: string | null = null;
      const isClaim = invite.intent === 'claim_existing';
      if (isClaim) {
        claimAuditSalonId = invite.salonId;
        claimAuditInviteId = invite.id;
        if (!invite.salonId) {
          throw new Error('CLAIM_REQUIRES_REVIEW');
        }
        await tx.execute(sql`select id from ${salonSchema} where ${salonSchema.id} = ${invite.salonId} for update`);
        const [claimSalon] = await tx
          .select({
            id: salonSchema.id,
            name: salonSchema.name,
            slug: salonSchema.slug,
            customDomain: salonSchema.customDomain,
            ownerEmail: salonSchema.ownerEmail,
            ownerClerkUserId: salonSchema.ownerClerkUserId,
          })
          .from(salonSchema)
          .where(eq(salonSchema.id, invite.salonId))
          .limit(1);
        const [membershipCount] = await tx
          .select({ count: sql<number>`count(*)` })
          .from(adminSalonMembershipSchema)
          .where(eq(adminSalonMembershipSchema.salonId, invite.salonId));
        const [appointmentCount] = await tx
          .select({ count: sql<number>`count(*)` })
          .from(appointmentSchema)
          .where(eq(appointmentSchema.salonId, invite.salonId));
        if (
          !claimSalon
          || claimSalon.ownerClerkUserId
          || claimSalon.ownerEmail?.trim().toLowerCase() !== normalizedEmail
          || Number(membershipCount?.count ?? 0) > 0
          || Number(appointmentCount?.count ?? 0) > 0
        ) {
          throw new Error('CLAIM_REQUIRES_REVIEW');
        }
        salonId = claimSalon.id;
        salonName = claimSalon.name;
        slug = claimSalon.slug;
        customDomain = claimSalon.customDomain;
      } else {
        const [duplicateSalon] = await tx.select({ id: salonSchema.id }).from(salonSchema).where(eq(salonSchema.slug, input.slug)).limit(1);
        if (duplicateSalon) {
          throw new Error('SLUG_TAKEN');
        }
        salonId = crypto.randomUUID();
      }

      const technicianId = crypto.randomUUID();
      const locationId = crypto.randomUUID();
      const salonValues = {
        name: salonName,
        slug,
        logoUrl: input.logoUrl || null,
        phone: phoneE164,
        email: normalizedEmail,
        address: input.address || null,
        city: input.city || null,
        state: input.province || null,
        zipCode: input.postalCode || null,
        businessHours: input.businessHours,
        ownerName: input.ownerName,
        ownerEmail: normalizedEmail,
        ownerPhone: phoneE164,
        ownerClerkUserId: clerkUser.id,
        status: 'active',
        isActive: true,
        publicationStatus: 'published',
        publishedAt: now,
        slugLockedAt: now,
        onboardingCompletedAt: now,
        freeSoloEnabled: true,
        invitationSource: invite.campaignSource,
        plan: 'free',
        maxLocations: 1,
        isMultiLocationEnabled: false,
        features: freeSoloFeatures,
        settings: {
          booking: {
            bufferMinutes: 10,
            slotIntervalMinutes: 15,
            currency: 'CAD',
            timezone: input.timezone,
            firstVisitDiscountEnabled: false,
          },
          modules: {
            smsReminders: true,
            referrals: false,
            rewards: false,
            scheduleOverrides: false,
            staffEarnings: false,
            clientFlags: false,
            clientBlocking: false,
            analyticsDashboard: false,
            utilization: false,
          },
        },
        rewardsEnabled: false,
        reviewsEnabled: false,
        smsRemindersEnabled: false,
        bookingFlowCustomizationEnabled: false,
        bookingFlow: ['service', 'time', 'confirm'],
      };

      if (isClaim) {
        await tx.update(salonSchema).set(salonValues).where(eq(salonSchema.id, salonId));
        await tx.update(serviceSchema).set({ isActive: false }).where(eq(serviceSchema.salonId, salonId));
        await tx.update(adminInviteSchema).set({ usedAt: now }).where(and(
          eq(adminInviteSchema.salonId, salonId),
          isNull(adminInviteSchema.usedAt),
        ));
      } else {
        await tx.insert(salonSchema).values({ id: salonId, ...salonValues });
      }

      if (!identityOwner) {
        await tx.insert(adminUserSchema).values({
          id: adminId,
          phoneE164,
          clerkUserId: clerkUser.id,
          name: input.ownerName,
          email: normalizedEmail,
          emailVerifiedAt: now,
        });
      }
      await tx.insert(adminSalonMembershipSchema).values({ adminId, salonId, role: 'owner' });
      await tx.insert(salonLocationSchema).values({
        id: locationId,
        salonId,
        name: 'Primary location',
        address: input.address || null,
        city: input.city || null,
        state: input.province || null,
        zipCode: input.postalCode || null,
        phone: phoneE164,
        email: normalizedEmail,
        businessHours: input.businessHours,
        isPrimary: true,
        isActive: true,
      });
      await tx.insert(technicianSchema).values({
        id: technicianId,
        salonId,
        name: input.ownerName,
        email: normalizedEmail,
        phone: phoneE164,
        weeklySchedule: Object.fromEntries(
          Object.entries(input.businessHours).map(([day, value]) => [
            day,
            value ? { start: value.open, end: value.close } : null,
          ]),
        ),
        primaryLocationId: locationId,
        onboardingStatus: 'completed',
        isActive: true,
      });

      for (const [index, service] of input.services.entries()) {
        const serviceId = crypto.randomUUID();
        const baseSlug = service.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'service';
        await tx.insert(serviceSchema).values({
          id: serviceId,
          salonId,
          name: service.name,
          slug: `${baseSlug}-${index + 1}-${serviceId.slice(0, 8)}`,
          price: service.priceCents,
          durationMinutes: service.durationMinutes,
          category: service.category,
          sortOrder: index,
          isActive: true,
        });
        await tx.insert(technicianServicesSchema).values({ technicianId, serviceId, priority: index, enabled: true });
      }

      const consumed = await tx
        .update(salonSignupInviteSchema)
        .set({ consumedAt: now, consumedByAdminId: adminId, resultSalonId: salonId })
        .where(and(
          eq(salonSignupInviteSchema.id, invite.id),
          isNull(salonSignupInviteSchema.consumedAt),
          isNull(salonSignupInviteSchema.revokedAt),
        ))
        .returning();
      if (consumed.length !== 1) {
        throw new Error('INVITE_INVALID');
      }

      return { salonId, slug, customDomain, intent: invite.intent, created: true };
    });

    if (result.intent === 'claim_existing') {
      await logAuditEvent({
        salonId: result.salonId,
        actorType: 'admin',
        actorId: clerkUser.id,
        action: 'salon_claim_completed',
        entityType: 'salon',
        entityId: result.salonId,
      });
    }

    const publicUrl = buildSalonTenantPublicUrl('/', {
      slug: result.slug,
      customDomain: result.customDomain,
    });
    return Response.json({
      data: {
        salonId: result.salonId,
        slug: result.slug,
        publicUrl,
        bookingUrl: buildSalonTenantPublicUrl('/book/service', {
          slug: result.slug,
          customDomain: result.customDomain,
        }),
        dashboardUrl: `${getCanonicalAppOrigin()}/en/admin?salon=${encodeURIComponent(result.slug)}`,
      },
    }, { status: result.created ? 201 : 200 });
  } catch (error) {
    const code = normalizeSetupError(error);
    if (claimAuditSalonId) {
      await logAuditEvent({
        salonId: claimAuditSalonId,
        actorType: 'admin',
        actorId: clerkUser.id,
        action: 'salon_claim_failed',
        entityType: 'salon_signup_invite',
        entityId: claimAuditInviteId,
        metadata: { failureCode: code },
      });
    }
    const messages: Record<string, string> = {
      INVITE_INVALID: 'This invitation is invalid, expired, or already used.',
      INVITE_EMAIL_MISMATCH: 'Sign in with the email address that received this invitation.',
      CLAIM_REQUIRES_REVIEW: 'This salon changed after the invitation was issued. Ask Luster support to review it.',
      SLUG_TAKEN: 'That salon link is already taken.',
      OWNER_ACCOUNT_CONFLICT: 'This email is connected to a different owner login. Sign in with the invited email or reset its password.',
      OWNER_PHONE_CONFLICT: 'That phone number belongs to another owner account. Sign in to that account or use a different contact number.',
    };
    const status = code === 'SLUG_TAKEN' || code.startsWith('OWNER_') || code === 'CLAIM_REQUIRES_REVIEW'
      ? 409
      : code.startsWith('INVITE_')
        ? 403
        : 500;
    if (status >= 500) {
      console.error('[Luster onboarding] Setup failed');
    }
    return Response.json({ error: { code, message: messages[code] || 'Salon setup could not be completed.' } }, { status });
  }
}
