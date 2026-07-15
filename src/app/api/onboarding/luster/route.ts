import { currentUser } from '@clerk/nextjs/server';
import { and, eq, gt, isNull, or } from 'drizzle-orm';
import { z } from 'zod';

import { formatPhoneE164 } from '@/libs/adminAuth';
import { db } from '@/libs/DB';
import { hashOpaqueToken } from '@/libs/lusterSecurity';
import { isValidSalonSlug } from '@/libs/tenantSlug';
import {
  adminSalonMembershipSchema,
  adminUserSchema,
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
      return 'OWNER_EXISTS';
    }
  }
  return error instanceof Error ? error.message : 'SETUP_FAILED';
}

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

  const primaryEmail = clerkUser.emailAddresses.find(item => item.id === clerkUser.primaryEmailAddressId)?.emailAddress
    ?? clerkUser.emailAddresses[0]?.emailAddress;
  if (!primaryEmail) {
    return Response.json({ error: { code: 'EMAIL_REQUIRED', message: 'A verified owner email is required.' } }, { status: 400 });
  }
  const normalizedEmail = primaryEmail.trim().toLowerCase();
  let phoneE164: string;
  try {
    phoneE164 = formatPhoneE164(input.ownerPhone);
  } catch {
    return Response.json({ error: { code: 'INVALID_PHONE', message: 'Enter a valid Canadian or US phone number.' } }, { status: 400 });
  }

  try {
    const result = await db.transaction(async (tx) => {
      const [invite] = await tx
        .select()
        .from(salonSignupInviteSchema)
        .where(and(
          eq(salonSignupInviteSchema.tokenHash, hashOpaqueToken(input.inviteToken)),
          isNull(salonSignupInviteSchema.consumedAt),
          gt(salonSignupInviteSchema.expiresAt, new Date()),
        ))
        .limit(1);
      if (!invite) {
        throw new Error('INVITE_INVALID');
      }
      if (invite.invitedEmail.trim().toLowerCase() !== normalizedEmail) {
        const error = new Error('INVITE_EMAIL_MISMATCH');
        error.cause = invite.invitedEmail;
        throw error;
      }

      const [duplicateSalon] = await tx.select({ id: salonSchema.id }).from(salonSchema).where(eq(salonSchema.slug, input.slug)).limit(1);
      if (duplicateSalon) {
        throw new Error('SLUG_TAKEN');
      }
      const [duplicateOwner] = await tx
        .select({ id: adminUserSchema.id })
        .from(adminUserSchema)
        .where(or(eq(adminUserSchema.clerkUserId, clerkUser.id), eq(adminUserSchema.email, normalizedEmail), eq(adminUserSchema.phoneE164, phoneE164)))
        .limit(1);
      if (duplicateOwner) {
        throw new Error('OWNER_EXISTS');
      }

      const salonId = crypto.randomUUID();
      const adminId = crypto.randomUUID();
      const technicianId = crypto.randomUUID();
      const locationId = crypto.randomUUID();
      const now = new Date();

      await tx.insert(salonSchema).values({
        id: salonId,
        name: input.salonName,
        slug: input.slug,
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
        publicationStatus: 'published',
        publishedAt: now,
        slugLockedAt: now,
        onboardingCompletedAt: now,
        freeSoloEnabled: true,
        invitationSource: invite.campaignSource,
        plan: 'free_solo',
        maxLocations: 1,
        isMultiLocationEnabled: false,
        features: {
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
        },
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
      });
      await tx.insert(adminUserSchema).values({
        id: adminId,
        phoneE164,
        clerkUserId: clerkUser.id,
        name: input.ownerName,
        email: normalizedEmail,
        emailVerifiedAt: now,
      });
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
        await tx.insert(serviceSchema).values({
          id: serviceId,
          salonId,
          name: service.name,
          slug: `${service.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}-${index + 1}`,
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
        .set({ consumedAt: now, consumedByAdminId: adminId })
        .where(and(eq(salonSignupInviteSchema.id, invite.id), isNull(salonSignupInviteSchema.consumedAt)))
        .returning();
      if (consumed.length !== 1) {
        throw new Error('INVITE_INVALID');
      }

      return { salonId, slug: input.slug };
    });

    return Response.json({ data: { ...result, publicUrl: `https://${result.slug}.${process.env.LUSTER_ROOT_DOMAIN || 'luster.com'}` } }, { status: 201 });
  } catch (error) {
    const code = normalizeSetupError(error);
    const invitedEmail = error instanceof Error && error.message === 'INVITE_EMAIL_MISMATCH' && typeof error.cause === 'string'
      ? error.cause
      : null;
    const messages: Record<string, string> = {
      INVITE_INVALID: 'This invitation is invalid, expired, or already used.',
      INVITE_EMAIL_MISMATCH: invitedEmail ? `Sign in with the invited email: ${invitedEmail}` : 'Sign in with the email address that received this invitation.',
      SLUG_TAKEN: 'That salon link is already taken.',
      OWNER_EXISTS: 'An owner account already exists for this email or phone.',
    };
    const status = code === 'SLUG_TAKEN' || code === 'OWNER_EXISTS' ? 409 : code.startsWith('INVITE_') ? 403 : 500;
    if (status >= 500) {
      console.error('[Luster onboarding]', error);
    }
    return Response.json({ error: { code, message: messages[code] || 'Salon setup could not be completed.' } }, { status });
  }
}
