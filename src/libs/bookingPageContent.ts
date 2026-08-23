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
// WRITES — transaction-scoped, targeted jsonb_set (mirrors bookingPageConfig.ts)
// =============================================================================

export type BookingPageContentTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

async function readCurrentBookingPageContent(
  tx: BookingPageContentTransaction,
  salonId: string,
): Promise<BookingPageContent | null> {
  const [existing] = await tx
    .select({ settings: salonSchema.settings })
    .from(salonSchema)
    .where(eq(salonSchema.id, salonId))
    .for('update')
    .limit(1);

  if (!existing) {
    return null;
  }

  return resolveBookingPageContent(existing.settings);
}

async function writeContentSide(
  tx: BookingPageContentTransaction,
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

  const [updated] = await tx
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
 * Transaction-aware content PATCH primitive. The caller owns `tx`; this
 * function acquires the same salon-row lock used by presentation writes and
 * Publish/Revert, resolves DRAFT only after that lock is held, and changes
 * only keys explicitly supplied by the validated patch.
 *
 * Keeping the field updates targeted is intentional defense in depth: the
 * row lock provides cross-session serialization, while the jsonb_set chain
 * makes it impossible for this writer to replace an unrelated content key
 * from a stale whole-side snapshot.
 */
export async function updateBookingPageContentDraftInTransaction(
  tx: BookingPageContentTransaction,
  salonId: string,
  validatedPatch: BookingPageContentPatch,
): Promise<BookingPageContent | null> {
  const current = await readCurrentBookingPageContent(tx, salonId);
  if (!current) {
    return null;
  }

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
  settingsExpression = sql`
    jsonb_set(
      ${settingsExpression},
      '{bookingPageContent,draft}',
      CASE
        WHEN jsonb_typeof(${settingsExpression}#>'{bookingPageContent,draft}') = 'object'
          THEN ${settingsExpression}#>'{bookingPageContent,draft}'
        ELSE ${JSON.stringify(current.draft)}::jsonb
      END
    )
  `;

  if (validatedPatch.heroImageUrl !== undefined) {
    settingsExpression = sql`jsonb_set(${settingsExpression}, '{bookingPageContent,draft,heroImageUrl}', ${JSON.stringify(validatedPatch.heroImageUrl)}::jsonb)`;
  }
  if (validatedPatch.specialtyLine !== undefined) {
    settingsExpression = sql`jsonb_set(${settingsExpression}, '{bookingPageContent,draft,specialtyLine}', ${JSON.stringify(validatedPatch.specialtyLine)}::jsonb)`;
  }
  if (validatedPatch.bio !== undefined) {
    settingsExpression = sql`jsonb_set(${settingsExpression}, '{bookingPageContent,draft,bio}', ${JSON.stringify(validatedPatch.bio)}::jsonb)`;
  }
  if (validatedPatch.locationDisplayMode !== undefined) {
    settingsExpression = sql`jsonb_set(${settingsExpression}, '{bookingPageContent,draft,locationDisplayMode}', ${JSON.stringify(validatedPatch.locationDisplayMode)}::jsonb)`;
  }

  const [updated] = await tx
    .update(salonSchema)
    .set({ settings: settingsExpression })
    .where(eq(salonSchema.id, salonId))
    .returning();

  return updated ? resolveBookingPageContent(updated.settings) : null;
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
  return db.transaction(tx => updateBookingPageContentDraftInTransaction(
    tx,
    salonId,
    validatedPatch,
  ));
}

/** Copies the resolved `draft` side into `live`. Same semantics as `publishBookingPageConfig`. */
export async function publishBookingPageContent(salonId: string): Promise<BookingPageContent | null> {
  return db.transaction(async (tx) => {
    const current = await readCurrentBookingPageContent(tx, salonId);
    if (!current) {
      return null;
    }
    return writeContentSide(tx, salonId, 'live', current.draft);
  });
}

/** Resets `draft` to match `live`. Same semantics as `revertBookingPageDraft`. */
export async function revertBookingPageContentDraft(salonId: string): Promise<BookingPageContent | null> {
  return db.transaction(async (tx) => {
    const current = await readCurrentBookingPageContent(tx, salonId);
    if (!current) {
      return null;
    }
    return writeContentSide(tx, salonId, 'draft', current.live);
  });
}
