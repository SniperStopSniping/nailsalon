/**
 * Admin Booking Page API (Luster UI/UX plan rev 3, PR 5 — owner Booking Page surface).
 *
 * GET   /api/admin/booking-page?salonSlug=xxx   — read the draft/live config + content pairs.
 * PATCH /api/admin/booking-page?salonSlug=xxx   — write into the draft side of either pair.
 * POST  /api/admin/booking-page?salonSlug=xxx   — { action: 'publish' | 'revert' } on both pairs.
 *
 * Thin route: draft writes go through the canonical booking-page config and
 * content helpers; publish/revert goes through one transaction-scoped
 * lifecycle helper so both pairs move atomically. Auth and salon resolution follow the
 * exact pattern in `@/app/api/admin/salon/settings/route.ts`: resolve the
 * salon by slug, then `requireAdmin(salon.id)`.
 *
 * `config.hiddenSections`/`sectionOrder` are re-validated server-side by
 * `validateSectionOrder` inside `updateBookingPageDraft` regardless of what
 * this route is sent — the floor-protected ids can never end up hidden or
 * removed through this endpoint, even given a hand-crafted request that
 * never went through the owner UI's toggle list.
 *
 * S6 (Stage 1) comment correction: this previously named only
 * `serviceMenu`/`bookingCta`. `REQUIRED_SECTION_IDS` has since gained
 * `salonProfile`, so THREE ids are protected. The list is read from
 * `bookingPageConfig.ts` rather than restated here so it cannot drift again.
 */

import { z } from 'zod';

import type { AdminWithSalons } from '@/libs/adminAuth';
import { requireAdmin } from '@/libs/adminAuth';
import { logAuditEvent } from '@/libs/auditLog';
import { resolveBookingConfigFromSettings } from '@/libs/bookingConfig';
import { resolveBookingExperience } from '@/libs/bookingExperience';
import { applyBookingPageBuilderOperation } from '@/libs/bookingPageBuilder';
import {
  bookingPageBuilderOperationSchema,
  BookingPageBuilderWriteError,
  bookingPageDraftPatchSchema,
  getBookingPageDraftPresentationState,
  resolveBookingPageConfig,
  updateBookingPageDraft,
} from '@/libs/bookingPageConfig';
import {
  bookingPageContentPatchSchema,
  resolveBookingPageContent,
  updateBookingPageContentDraft,
} from '@/libs/bookingPageContent';
import {
  synchronizeBookingPageLifecycle,
  updateBookingPageDraftState,
} from '@/libs/bookingPageLifecycle';
import { getActiveLocationsBySalonId, getSalonById, getSalonBySlug, getTechniciansBySalonId } from '@/libs/queries';
import type { Salon } from '@/models/Schema';

export const dynamic = 'force-dynamic';

const patchBodySchema = z.object({
  config: bookingPageDraftPatchSchema.optional(),
  content: bookingPageContentPatchSchema.optional(),
  builderOperation: bookingPageBuilderOperationSchema.optional(),
}).strict().superRefine((value, context) => {
  if (value.builderOperation && (value.config || value.content)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'A builder operation cannot be combined with raw config or content changes.',
    });
  }
});

const postBodySchema = z.object({
  action: z.enum(['publish', 'revert']),
}).strict();

type AuthorizedSalonSuccess = { ok: true; salon: Salon; admin: AdminWithSalons };
type AuthorizedSalonFailure = { ok: false; error: Response };
type AuthorizedSalonResult = AuthorizedSalonSuccess | AuthorizedSalonFailure;

async function resolveAuthorizedSalon(request: Request): Promise<AuthorizedSalonResult> {
  const { searchParams } = new URL(request.url);
  const salonSlug = searchParams.get('salonSlug');

  if (!salonSlug) {
    return {
      ok: false,
      error: Response.json({ error: 'salonSlug query parameter is required' }, { status: 400 }),
    };
  }

  const salon = await getSalonBySlug(salonSlug);
  if (!salon) {
    return { ok: false, error: Response.json({ error: 'Salon not found' }, { status: 404 }) };
  }

  const guard = await requireAdmin(salon.id);
  if (!guard.ok) {
    return { ok: false, error: guard.response };
  }

  return { ok: true, salon, admin: guard.admin };
}

// =============================================================================
// GET
// =============================================================================

export async function GET(request: Request): Promise<Response> {
  const resolved = await resolveAuthorizedSalon(request);
  if (!resolved.ok) {
    return resolved.error;
  }

  const { salon } = resolved;

  // Owner-only current values: never derive these from a historical onboarding
  // snapshot, and never include this payload in a public customer renderer.
  let savedDetails: Record<string, string[]> | undefined;
  if (new URL(request.url).searchParams.get('include') === 'information') {
    const [locations, technicians] = await Promise.all([
      getActiveLocationsBySalonId(salon.id),
      getTechniciansBySalonId(salon.id),
    ]);
    const location = locations.find(item => item.isPrimary) ?? locations[0];
    const instagram = resolveBookingExperience(salon.settings).socialLinks.instagram;
    const present = (values: Array<string | null | undefined>) => values.filter((value): value is string => Boolean(value));
    savedDetails = {
      'Business identity': present([salon.name, ...technicians.map(item => item.name), salon.logoUrl ? 'Logo saved' : null, technicians.some(item => item.avatarUrl) ? 'Profile photo saved' : null]),
      'Location': present([location?.city ?? salon.city, location?.address ?? salon.address, location?.state, location?.zipCode]),
      'Contact': present([salon.phone, salon.email, instagram]),
      'Hours': [
        ...Object.entries(salon.businessHours ?? {}).map(([day, hours]) => `${day}: ${hours ? `${hours.open}–${hours.close}` : 'Closed'}`),
        resolveBookingConfigFromSettings(salon.settings).timezone,
      ],
    };
  }

  return Response.json({
    ...(savedDetails ? { savedDetails } : {}),
    config: resolveBookingPageConfig(salon.settings),
    content: resolveBookingPageContent(salon.settings),
    // Phase A (draft/publish split): lets the owner Booking Page surface
    // show its own "publish the salon" affordance (distinct from the
    // Publish/Revert below, which only ever moves the draft/live config
    // pair) without a second round trip — this route already resolves and
    // authorizes the salon.
    salon: { publicationStatus: salon.publicationStatus },
  });
}

// =============================================================================
// PATCH — draft-only edits
// =============================================================================

export async function PATCH(request: Request): Promise<Response> {
  const resolved = await resolveAuthorizedSalon(request);
  if (!resolved.ok) {
    return resolved.error;
  }

  const { salon, admin } = resolved;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'Invalid request data' }, { status: 400 });
  }

  const validated = patchBodySchema.safeParse(body);
  if (!validated.success) {
    return Response.json(
      { error: 'Invalid request data', details: validated.error.flatten() },
      { status: 400 },
    );
  }

  const {
    config: configPatch,
    content: contentPatch,
    builderOperation,
  } = validated.data;

  if (!configPatch && !contentPatch && !builderOperation) {
    return Response.json({ error: 'No fields to update' }, { status: 400 });
  }

  if (builderOperation) {
    const current = resolveBookingPageConfig(salon.settings);
    const result = applyBookingPageBuilderOperation(
      getBookingPageDraftPresentationState(current),
      builderOperation,
    );
    if (!result.ok) {
      const status = result.code === 'STALE_PRESENTATION' ? 409 : 400;
      return Response.json(
        { error: 'Invalid builder operation', code: result.code },
        { status },
      );
    }
    try {
      await updateBookingPageDraft(salon.id, result.patch, { builderOperation });
    } catch (error) {
      if (error instanceof BookingPageBuilderWriteError) {
        const status = error.code === 'STALE_PRESENTATION' ? 409 : 400;
        return Response.json(
          { error: 'Invalid builder operation', code: error.code },
          { status },
        );
      }
      throw error;
    }
  } else if (configPatch && contentPatch) {
    const updated = await updateBookingPageDraftState(salon.id, {
      config: configPatch,
      content: contentPatch,
    });
    if (!updated) {
      return Response.json(
        { error: 'Booking page state changed before the update completed' },
        { status: 409 },
      );
    }
  } else if (configPatch) {
    await updateBookingPageDraft(salon.id, configPatch);
  } else if (contentPatch) {
    await updateBookingPageContentDraft(salon.id, contentPatch);
  }

  void logAuditEvent({
    salonId: salon.id,
    actorType: 'admin',
    actorId: admin.id,
    action: 'settings_updated',
    entityType: 'booking_page_draft',
    entityId: salon.id,
    metadata: {
      configFields: configPatch ? Object.keys(configPatch) : [],
      contentFields: contentPatch ? Object.keys(contentPatch) : [],
      builderOperation: builderOperation?.type ?? null,
      presetId: builderOperation?.type === 'apply_preset'
        ? builderOperation.presetId
        : null,
      presetVersion: builderOperation?.type === 'apply_preset'
        ? builderOperation.presetVersion
        : null,
    },
  });

  // Re-read from the DB rather than trusting the individual write results —
  // each writer only returns the one pair it touched (config or content),
  // and both may have been patched in the same request.
  const freshState = await resolveFreshState(salon.id);

  return Response.json(freshState);
}

// =============================================================================
// POST — publish / revert
// =============================================================================

export async function POST(request: Request): Promise<Response> {
  const resolved = await resolveAuthorizedSalon(request);
  if (!resolved.ok) {
    return resolved.error;
  }

  const { salon, admin } = resolved;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'Invalid request data' }, { status: 400 });
  }

  const validated = postBodySchema.safeParse(body);
  if (!validated.success) {
    return Response.json(
      { error: 'Invalid request data', details: validated.error.flatten() },
      { status: 400 },
    );
  }

  const { action } = validated.data;

  const synchronizedSettings = await synchronizeBookingPageLifecycle(salon.id, action);
  if (!synchronizedSettings) {
    return Response.json(
      { error: 'Booking page state changed before the action completed' },
      { status: 409 },
    );
  }

  void logAuditEvent({
    salonId: salon.id,
    actorType: 'admin',
    actorId: admin.id,
    action: 'settings_updated',
    entityType: 'booking_page_draft',
    entityId: salon.id,
    metadata: { bookingPageAction: action },
  });

  return Response.json({
    config: resolveBookingPageConfig(synchronizedSettings),
    content: resolveBookingPageContent(synchronizedSettings),
    salon: { publicationStatus: salon.publicationStatus },
  });
}

// =============================================================================
// Shared re-read helper — every write helper above only returns the pair it
// touched (config or content), so every mutating response re-fetches the
// salon row once and resolves both pairs from the same settings snapshot.
// =============================================================================

async function resolveFreshState(salonId: string) {
  const salon = await getSalonById(salonId);

  return {
    config: resolveBookingPageConfig(salon?.settings ?? null),
    content: resolveBookingPageContent(salon?.settings ?? null),
    salon: { publicationStatus: salon?.publicationStatus ?? 'published' },
  };
}
