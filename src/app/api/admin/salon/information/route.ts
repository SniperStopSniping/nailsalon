/**
 * Owner business information (Booking Page hub → Your Information).
 *
 * GET   /api/admin/salon/information?salonSlug=xxx — the current canonical values.
 * PATCH /api/admin/salon/information?salonSlug=xxx — targeted owner edits.
 *
 * Every write lands on the SAME rows onboarding created — `salon`, the primary
 * `salon_location`, `settings.sharedProfile` and
 * `settings.bookingExperience.socialLinks` — so the dashboard never keeps a
 * second copy of business data. Deliberately out of scope here, because a
 * canonical writer already exists and is reused directly by the editor:
 *   - timezone → `PATCH /api/admin/salon/settings` (`bookingConfig.timezone`)
 *   - street address / city → `PATCH /api/admin/location`
 *   - nail-tech name and photo → `PUT /api/admin/technicians/[id]` and
 *     `POST /api/admin/technicians/[id]/avatar`
 *   - address privacy → `PATCH /api/admin/booking-page` (`content.locationDisplayMode`)
 *
 * Never touched: `admin_user` (the signed-in owner's PRIVATE account profile —
 * `POST /api/admin/profile` is a different record) and
 * `technician.weekly_schedule` (staff availability). Public business hours are
 * the salon row plus the primary location, exactly as onboarding writes them.
 */

import { and, eq, sql } from 'drizzle-orm';
import { z } from 'zod';

import type { AdminWithSalons } from '@/libs/adminAuth';
import { formatPhoneE164, requireAdmin } from '@/libs/adminAuth';
import { logAuditEvent } from '@/libs/auditLog';
import { resolveBookingConfigFromSettings } from '@/libs/bookingConfig';
import { bookingExperienceAppearanceUpdateSchema, resolveBookingExperience } from '@/libs/bookingExperience';
import { resolveBookingPageContent } from '@/libs/bookingPageContent';
import { db } from '@/libs/DB';
import { buildSalonTenantPublicUrl } from '@/libs/publicUrl';
import { getActiveLocationsBySalonId, getSalonBySlug, getTechniciansBySalonId } from '@/libs/queries';
import { resolveSharedSalonProfile } from '@/libs/sharedSalonProfile';
import { type Salon, salonLocationSchema, salonSchema } from '@/models/Schema';

import { resolveInstagramUsername } from '../../../../../../prototypes/site-builder-v2-booking-integration-lab/src/onboarding/model/contact';

export const dynamic = 'force-dynamic';

type Weekday = 'monday' | 'tuesday' | 'wednesday' | 'thursday' | 'friday' | 'saturday' | 'sunday';
type BusinessHours = Record<Weekday, { open: string; close: string } | null>;

const timeOfDaySchema = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/u, 'Use 24-hour HH:MM times');

const dayHoursSchema = z.object({
  open: timeOfDaySchema,
  close: timeOfDaySchema,
}).strict().nullable().superRefine((value, context) => {
  if (value && value.close <= value.open) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Configured hours need a closing time after the opening time.',
    });
  }
});

const businessHoursSchema = z.object({
  monday: dayHoursSchema,
  tuesday: dayHoursSchema,
  wednesday: dayHoursSchema,
  thursday: dayHoursSchema,
  friday: dayHoursSchema,
  saturday: dayHoursSchema,
  sunday: dayHoursSchema,
}).strict();

const optionalText = (maximum: number) => z
  .union([z.string(), z.null()])
  .transform((value) => {
    const trimmed = typeof value === 'string' ? value.trim() : '';
    return trimmed.length > 0 ? trimmed : null;
  })
  .refine(value => value === null || Array.from(value).length <= maximum, {
    message: `Must be ${maximum} characters or fewer`,
  });

const phoneSchema = optionalText(64).transform((value, context) => {
  if (value === null) {
    return null;
  }
  try {
    return formatPhoneE164(value);
  } catch {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'Enter a valid phone number' });
    return z.NEVER;
  }
});

const emailSchema = optionalText(320).transform((value, context) => {
  if (value === null) {
    return null;
  }
  const result = z.string().email().safeParse(value.toLowerCase());
  if (!result.success) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'Enter a valid email address' });
    return z.NEVER;
  }
  return result.data;
});

const instagramUrlSchema = bookingExperienceAppearanceUpdateSchema.shape.socialLinks.shape.instagram;

/** Accepts a username, `@username` or a profile URL; stores the canonical profile URL. */
const instagramSchema = optionalText(200).transform((value, context) => {
  if (value === null) {
    return null;
  }
  const resolution = resolveInstagramUsername(value);
  if (resolution.status === 'empty') {
    return null;
  }
  if (resolution.status !== 'resolved') {
    context.addIssue({ code: z.ZodIssueCode.custom, message: resolution.error });
    return z.NEVER;
  }
  const parsed = instagramUrlSchema.safeParse(`https://www.instagram.com/${resolution.username}/`);
  if (!parsed.success) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'Enter only your Instagram username.' });
    return z.NEVER;
  }
  return parsed.data;
});

const logoUrlSchema = z.union([z.string(), z.null()]).transform((value, context) => {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  if (!trimmed) {
    return null;
  }
  const result = z.string().url().safeParse(trimmed);
  if (!result.success || !/^https?:$/u.test(new URL(result.data).protocol)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'Logo must be an absolute image URL' });
    return z.NEVER;
  }
  return result.data;
});

const contactPreferencesSchema = z.object({
  bookingOnlyContact: z.boolean().optional(),
  callEnabled: z.boolean().optional(),
  textEnabled: z.boolean().optional(),
  textNumber: optionalText(64).optional(),
}).strict();

const patchSchema = z.object({
  name: z.string().trim().min(1, 'Business name is required').max(80, 'Business name must be 80 characters or fewer').optional(),
  logoUrl: logoUrlSchema.optional(),
  phone: phoneSchema.optional(),
  email: emailSchema.optional(),
  instagram: instagramSchema.optional(),
  contactPreferences: contactPreferencesSchema.optional(),
  businessHours: businessHoursSchema.optional(),
}).strict().refine(value => Object.keys(value).length > 0, { message: 'No fields to update' });

export type SalonInformationPatch = z.infer<typeof patchSchema>;

type AuthorizedSalon = { ok: true; salon: Salon; admin: AdminWithSalons } | { ok: false; error: Response };

function error(status: number, code: string, message: string, details?: unknown): Response {
  return Response.json({ error: { code, message, ...(details ? { details } : {}) } }, { status });
}

/**
 * Same resolution order as every other owner route (`getSalonBySlug` then
 * `requireAdmin(salon.id)`), plus an owner-role requirement: business
 * identity, contact and hours are the owner's to change. Super admins pass
 * through `requireAdmin` (including a locked impersonation of this salon).
 */
async function resolveOwnerSalon(request: Request): Promise<AuthorizedSalon> {
  const salonSlug = new URL(request.url).searchParams.get('salonSlug');
  if (!salonSlug) {
    return { ok: false, error: error(400, 'MISSING_SALON_SLUG', 'salonSlug query parameter is required') };
  }
  const salon = await getSalonBySlug(salonSlug);
  if (!salon) {
    return { ok: false, error: error(404, 'SALON_NOT_FOUND', 'Salon not found') };
  }
  const guard = await requireAdmin(salon.id);
  if (!guard.ok) {
    return { ok: false, error: guard.response };
  }
  const isOwner = guard.admin.isSuperAdmin
    || guard.admin.salons.some(membership => membership.salonId === salon.id && membership.role === 'owner');
  if (!isOwner) {
    return { ok: false, error: error(403, 'OWNER_REQUIRED', 'Only the salon owner can change business information') };
  }
  return { ok: true, salon, admin: guard.admin };
}

async function buildInformation(salon: Salon) {
  const [locations, technicians] = await Promise.all([
    getActiveLocationsBySalonId(salon.id),
    getTechniciansBySalonId(salon.id),
  ]);
  const location = locations.find(item => item.isPrimary) ?? locations[0] ?? null;
  const soleTechnician = technicians.length === 1 ? technicians[0]! : null;
  const content = resolveBookingPageContent(salon.settings);
  const sharedProfile = resolveSharedSalonProfile(salon.settings);

  return {
    salon: {
      id: salon.id,
      slug: salon.slug,
      name: salon.name,
      publicationStatus: salon.publicationStatus,
      slugLocked: Boolean(salon.slugLockedAt) || salon.publicationStatus === 'published',
      customDomain: salon.customDomain ?? null,
      publicUrl: buildSalonTenantPublicUrl('/', { slug: salon.slug, customDomain: salon.customDomain }),
      logoUrl: salon.logoUrl ?? null,
      phone: salon.phone ?? null,
      email: salon.email ?? null,
    },
    technician: soleTechnician
      ? { id: soleTechnician.id, name: soleTechnician.name, avatarUrl: soleTechnician.avatarUrl ?? null }
      : null,
    technicianCount: technicians.length,
    instagram: resolveBookingExperience(salon.settings).socialLinks.instagram,
    location: location
      ? {
          id: location.id,
          name: location.name,
          address: location.address,
          city: location.city,
          state: location.state,
          zipCode: location.zipCode,
        }
      : null,
    addressPrivacy: {
      draft: content.draft.locationDisplayMode,
      live: content.live.locationDisplayMode,
    },
    contactPreferences: {
      bookingOnlyContact: sharedProfile.bookingOnlyContact,
      callEnabled: sharedProfile.callEnabled,
      textEnabled: sharedProfile.textEnabled,
      textNumber: sharedProfile.textNumber,
    },
    businessHours: (location?.businessHours ?? salon.businessHours ?? null) as BusinessHours | null,
    timezone: resolveBookingConfigFromSettings(salon.settings).timezone,
  };
}

export async function GET(request: Request): Promise<Response> {
  const resolved = await resolveOwnerSalon(request);
  if (!resolved.ok) {
    return resolved.error;
  }
  return Response.json({ data: await buildInformation(resolved.salon) });
}

export async function PATCH(request: Request): Promise<Response> {
  const resolved = await resolveOwnerSalon(request);
  if (!resolved.ok) {
    return resolved.error;
  }
  const { salon, admin } = resolved;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return error(400, 'INVALID_REQUEST', 'Invalid request data');
  }
  const validated = patchSchema.safeParse(body);
  if (!validated.success) {
    return error(400, 'INVALID_REQUEST', validated.error.issues[0]?.message ?? 'Invalid request data', validated.error.flatten());
  }
  const patch = validated.data;

  const salonUpdates: Partial<typeof salonSchema.$inferInsert> = {};
  if (patch.name !== undefined) {
    salonUpdates.name = patch.name;
  }
  if (patch.logoUrl !== undefined) {
    salonUpdates.logoUrl = patch.logoUrl;
  }
  if (patch.phone !== undefined) {
    salonUpdates.phone = patch.phone;
  }
  if (patch.email !== undefined) {
    salonUpdates.email = patch.email;
  }
  if (patch.businessHours !== undefined) {
    salonUpdates.businessHours = patch.businessHours;
  }

  // Settings keys are written with targeted jsonb_set chains (the same pattern
  // as `/api/admin/salon/settings`), so an Instagram or contact-permission
  // edit can never replace an unrelated key from a stale snapshot.
  if (patch.instagram !== undefined || patch.contactPreferences) {
    let settingsExpression = sql`
      CASE
        WHEN jsonb_typeof(${salonSchema.settings}) = 'object'
          THEN ${salonSchema.settings}
        ELSE '{}'::jsonb
      END
    `;
    if (patch.instagram !== undefined) {
      settingsExpression = sql`
        jsonb_set(
          ${settingsExpression},
          '{bookingExperience}',
          CASE
            WHEN jsonb_typeof(${settingsExpression}->'bookingExperience') = 'object'
              THEN ${settingsExpression}->'bookingExperience'
            ELSE '{}'::jsonb
          END
        )
      `;
      settingsExpression = sql`
        jsonb_set(
          ${settingsExpression},
          '{bookingExperience,socialLinks}',
          CASE
            WHEN jsonb_typeof(${settingsExpression}#>'{bookingExperience,socialLinks}') = 'object'
              THEN ${settingsExpression}#>'{bookingExperience,socialLinks}'
            ELSE '{}'::jsonb
          END
        )
      `;
      settingsExpression = sql`jsonb_set(${settingsExpression}, '{bookingExperience,socialLinks,instagram}', ${JSON.stringify(patch.instagram)}::jsonb)`;
    }
    if (patch.contactPreferences) {
      settingsExpression = sql`
        jsonb_set(
          ${settingsExpression},
          '{sharedProfile}',
          CASE
            WHEN jsonb_typeof(${settingsExpression}->'sharedProfile') = 'object'
              THEN ${settingsExpression}->'sharedProfile'
            ELSE '{}'::jsonb
          END
        )
      `;
      for (const key of ['bookingOnlyContact', 'callEnabled', 'textEnabled', 'textNumber'] as const) {
        const value = patch.contactPreferences[key];
        if (value !== undefined) {
          settingsExpression = sql`jsonb_set(${settingsExpression}, ${sql.raw(`'{sharedProfile,${key}}'`)}, ${JSON.stringify(value)}::jsonb)`;
        }
      }
    }
    salonUpdates.settings = settingsExpression as unknown as typeof salonSchema.$inferInsert.settings;
  }

  const mirrorToLocation = patch.phone !== undefined || patch.email !== undefined || patch.businessHours !== undefined;

  const updatedSalon = await db.transaction(async (tx) => {
    const [updated] = await tx
      .update(salonSchema)
      .set({ ...salonUpdates, updatedAt: new Date() })
      .where(eq(salonSchema.id, salon.id))
      .returning();
    if (!updated) {
      return null;
    }
    if (mirrorToLocation) {
      // Public contact and hours live on the primary location too (the
      // customer renderer prefers it). Staff schedules are untouched.
      const locations = await getActiveLocationsBySalonId(salon.id);
      const primary = locations.find(item => item.isPrimary) ?? locations[0] ?? null;
      if (primary) {
        await tx
          .update(salonLocationSchema)
          .set({
            ...(patch.phone !== undefined ? { phone: patch.phone } : {}),
            ...(patch.email !== undefined ? { email: patch.email } : {}),
            ...(patch.businessHours !== undefined ? { businessHours: patch.businessHours } : {}),
            updatedAt: new Date(),
          })
          .where(and(eq(salonLocationSchema.id, primary.id), eq(salonLocationSchema.salonId, salon.id)));
      }
    }
    return updated;
  });

  if (!updatedSalon) {
    return error(404, 'SALON_NOT_FOUND', 'Salon not found');
  }

  void logAuditEvent({
    salonId: salon.id,
    actorType: 'admin',
    actorId: admin.id,
    action: 'settings_updated',
    entityType: 'salon',
    entityId: salon.id,
    metadata: {
      via: 'booking_page_information',
      fields: Object.keys(patch),
      contactPreferenceFields: patch.contactPreferences ? Object.keys(patch.contactPreferences) : [],
    },
  });

  return Response.json({ data: await buildInformation(updatedSalon) });
}
