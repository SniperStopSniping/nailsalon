import 'server-only';

/**
 * bookingPage owner-editable content fields (Luster UI/UX plan rev 3, PR 5).
 *
 * PR 5's spec asks for a hero/profile image, specialty line, bio and
 * "location presentation" to be editable from the new owner Booking Page
 * surface, writing "into existing storage such as salon columns or
 * bookingExperience settings, or, if genuinely new, into a small JSONB
 * settings field only, with no migration."
 *
 * None of these four fields have existing storage:
 *   - `src/libs/salonContent.ts` (`SalonContentIdentity.specialtyLine`/`.bio`)
 *     documents both as "no salon-level field exists yet" — genuinely absent,
 *     not merely unwired.
 *   - There is no salon-level hero/profile image column distinct from
 *     `salon.logoUrl` (a logo, not a hero image), and no "how should the
 *     location be presented" toggle anywhere in `bookingExperience` or
 *     `salon_location`.
 *
 * So this module is the "genuinely new JSONB field" branch of that
 * instruction: a new `salon.settings.bookingPageContent` key, deliberately
 * NOT folded into `@/libs/bookingPageConfig`'s `BookingPageConfigSide` shape
 * (that side's zod schema is a plain `z.object(...)`, which strips unknown
 * keys by default — adding fields there would require editing PR 2's already
 *-tested schema/shape, a foundational contract this PR should not reshape).
 * Instead this is its own small module, mirroring bookingPageConfig.ts's
 * pattern exactly: a DEFAULTS constant, zod schemas, a resolver that never
 * throws (safeParse + documented fallback), and a targeted concurrency-safe
 * jsonb_set writer — plus the same draft/live pair and Publish/Revert
 * semantics as the picker/toggle config, since they are edited from the same
 * form and the plan's Preview/Publish/Revert promise should cover everything
 * the owner surface lets them change, not just layout/section fields.
 *
 * DEBT (recorded, not guessed at silently): these fields are not yet read by
 * `resolveSalonContent` (`@/libs/salonContent`) or rendered by any layout —
 * wiring a reader is a follow-up PR's job, not this one's. Storing the value
 * safely, with Preview/Publish/Revert working correctly, is this PR's whole
 * job. This mirrors "no visual change on merge": nothing here changes what
 * renders anywhere yet.
 */
import { eq, sql } from 'drizzle-orm';
import { z } from 'zod';

import { db } from '@/libs/DB';
import { salonSchema } from '@/models/Schema';

// =============================================================================
// LOCATION PRESENTATION
// =============================================================================

/**
 * "Location presentation" (spec wording) is genuinely new — no existing
 * toggle governs how much of the address an owner wants shown on their
 * booking page. Conservative, documented interpretation: a two-value privacy
 * choice between the full street address (today's de-facto behaviour, since
 * `SalonContent.place.address` already surfaces the full address whenever one
 * exists) and city-only. `full_address` is the default so storing this field
 * with no owner edit yet is a no-op — "no visual change on merge" holds here
 * too, once a future PR wires a reader.
 */
export const LOCATION_DISPLAY_MODES = ['full_address', 'city_only'] as const;
export type LocationDisplayMode = (typeof LOCATION_DISPLAY_MODES)[number];
const DEFAULT_LOCATION_DISPLAY_MODE: LocationDisplayMode = 'full_address';

// =============================================================================
// SIDE SHAPE
// =============================================================================

export type BookingPageContentSide = {
  heroImageUrl: string | null;
  specialtyLine: string | null;
  bio: string | null;
  locationDisplayMode: LocationDisplayMode;
};

export type BookingPageContent = {
  version: 1;
  draft: BookingPageContentSide;
  live: BookingPageContentSide;
};

function createDefaultContentSide(): BookingPageContentSide {
  return {
    heroImageUrl: null,
    specialtyLine: null,
    bio: null,
    locationDisplayMode: DEFAULT_LOCATION_DISPLAY_MODE,
  };
}

export const BOOKING_PAGE_CONTENT_SIDE_DEFAULTS: BookingPageContentSide = createDefaultContentSide();

export function createDefaultBookingPageContent(): BookingPageContent {
  return {
    version: 1,
    draft: createDefaultContentSide(),
    live: createDefaultContentSide(),
  };
}

export const BOOKING_PAGE_CONTENT_DEFAULTS: BookingPageContent = createDefaultBookingPageContent();

// =============================================================================
// VALIDATION
// =============================================================================

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function resolveWithDefault<T>(schema: z.ZodType<T>, value: unknown, fallback: T): T {
  const result = schema.safeParse(value);
  return result.success ? result.data : fallback;
}

const nullableTrimmedStringSchema = z.union([z.string(), z.null()]).transform((value) => {
  if (value === null) {
    return null;
  }
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
});

/** Mirrors the existing `avatarUrl: z.string().url().nullable().optional()` pattern (`@/app/api/admin/technicians/[id]/route.ts`). */
const nullableUrlSchema = z.union([z.string(), z.null()]).transform((value, context) => {
  if (value === null) {
    return null;
  }
  const trimmed = value.trim();
  if (trimmed === '') {
    return null;
  }
  const result = z.string().url().safeParse(trimmed);
  if (!result.success) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'heroImageUrl must be a valid URL',
    });
    return z.NEVER;
  }
  return result.data;
});

const locationDisplayModeSchema = z.enum(LOCATION_DISPLAY_MODES);

const bookingPageContentSideSchema = z.object({
  heroImageUrl: nullableUrlSchema,
  specialtyLine: nullableTrimmedStringSchema,
  bio: nullableTrimmedStringSchema,
  locationDisplayMode: locationDisplayModeSchema,
});

export type BookingPageContentPatch = Partial<BookingPageContentSide>;

export const bookingPageContentPatchSchema = bookingPageContentSideSchema.partial();

function resolveContentSide(raw: unknown): BookingPageContentSide {
  const source = isRecord(raw) ? raw : {};

  return {
    heroImageUrl: resolveWithDefault(nullableUrlSchema, source.heroImageUrl, null),
    specialtyLine: resolveWithDefault(nullableTrimmedStringSchema, source.specialtyLine, null),
    bio: resolveWithDefault(nullableTrimmedStringSchema, source.bio, null),
    locationDisplayMode: resolveWithDefault(
      locationDisplayModeSchema,
      source.locationDisplayMode,
      DEFAULT_LOCATION_DISPLAY_MODE,
    ),
  };
}

/**
 * Resolves whatever is stored at `settings.bookingPageContent` into a valid,
 * fully-typed value. Never throws — same contract as
 * `resolveBookingPageConfig` (`@/libs/bookingPageConfig`).
 */
export function resolveBookingPageContent(settings: unknown): BookingPageContent {
  const settingsRecord = isRecord(settings) ? settings : {};
  const raw = isRecord(settingsRecord.bookingPageContent) ? settingsRecord.bookingPageContent : {};

  const version = resolveWithDefault(z.literal(1), raw.version, 1);

  return {
    version,
    draft: resolveContentSide(raw.draft),
    live: resolveContentSide(raw.live),
  };
}

// =============================================================================
// WRITES — targeted, concurrency-safe jsonb_set (mirrors bookingPageConfig.ts)
// =============================================================================

async function readCurrentBookingPageContent(salonId: string): Promise<BookingPageContent | null> {
  const [existing] = await db
    .select({ settings: salonSchema.settings })
    .from(salonSchema)
    .where(eq(salonSchema.id, salonId))
    .limit(1);

  if (!existing) {
    return null;
  }

  return resolveBookingPageContent(existing.settings);
}

async function writeContentSide(
  salonId: string,
  targetSide: 'draft' | 'live',
  value: BookingPageContentSide,
): Promise<BookingPageContent | null> {
  let settingsExpression = sql`
    CASE
      WHEN jsonb_typeof(${salonSchema.settings}) = 'object'
        THEN ${salonSchema.settings}
      ELSE '{}'::jsonb
    END
  `;

  settingsExpression = sql`
    jsonb_set(
      ${settingsExpression},
      '{bookingPageContent}',
      CASE
        WHEN jsonb_typeof(${settingsExpression}->'bookingPageContent') = 'object'
          THEN ${settingsExpression}->'bookingPageContent'
        ELSE '{}'::jsonb
      END
    )
  `;
  settingsExpression = sql`jsonb_set(${settingsExpression}, '{bookingPageContent,version}', '1'::jsonb)`;

  const targetPath = targetSide === 'draft'
    ? sql.raw(`'{bookingPageContent,draft}'`)
    : sql.raw(`'{bookingPageContent,live}'`);
  settingsExpression = sql`jsonb_set(${settingsExpression}, ${targetPath}, ${JSON.stringify(value)}::jsonb)`;

  const [updated] = await db
    .update(salonSchema)
    .set({ settings: settingsExpression })
    .where(eq(salonSchema.id, salonId))
    .returning();

  if (!updated) {
    return null;
  }

  return resolveBookingPageContent(updated.settings);
}

/**
 * Writes a patch into `salon.settings.bookingPageContent.draft` only. The
 * patch must already be valid (validate with `bookingPageContentPatchSchema`
 * upstream) — an invalid patch throws here, same contract as
 * `updateBookingPageDraft`.
 */
export async function updateBookingPageContentDraft(
  salonId: string,
  patch: BookingPageContentPatch,
): Promise<BookingPageContent | null> {
  const validatedPatch = bookingPageContentPatchSchema.parse(patch);

  const current = await readCurrentBookingPageContent(salonId);
  if (!current) {
    return null;
  }

  const nextDraft: BookingPageContentSide = { ...current.draft, ...validatedPatch };
  return writeContentSide(salonId, 'draft', nextDraft);
}

/** Copies the resolved `draft` side into `live`. Same semantics as `publishBookingPageConfig`. */
export async function publishBookingPageContent(salonId: string): Promise<BookingPageContent | null> {
  const current = await readCurrentBookingPageContent(salonId);
  if (!current) {
    return null;
  }
  return writeContentSide(salonId, 'live', current.draft);
}

/** Resets `draft` to match `live`. Same semantics as `revertBookingPageDraft`. */
export async function revertBookingPageContentDraft(salonId: string): Promise<BookingPageContent | null> {
  const current = await readCurrentBookingPageContent(salonId);
  if (!current) {
    return null;
  }
  return writeContentSide(salonId, 'draft', current.live);
}
