import 'server-only';

import { eq, sql } from 'drizzle-orm';

import {
  applyPreparedCanonicalProfileMediaPromotion,
  completeCanonicalProfileMediaPromotion,
  discardPreparedCanonicalProfileMediaPromotion,
  prepareCanonicalProfileMediaForPublish,
} from '@/features/onboarding-v1-integration/canonical-profile-media-lifecycle.server';
import {
  type BookingPageDraftPatch,
  bookingPageDraftPatchSchema,
  resolveBookingPageConfig,
  updateBookingPageDraftInTransaction,
} from '@/libs/bookingPageConfig';
import {
  type BookingPageContentPatch,
  bookingPageContentPatchSchema,
  resolveBookingPageContent,
  updateBookingPageContentDraftInTransaction,
} from '@/libs/bookingPageContent';
import { db } from '@/libs/DB';
import { salonSchema } from '@/models/Schema';

export type BookingPageLifecycleAction = 'publish' | 'revert';

type BookingPageDraftStatePatch = {
  config?: BookingPageDraftPatch;
  content?: BookingPageContentPatch;
};

/**
 * Applies a raw owner draft request through one transaction. The route allows
 * config and content subsets in the same PATCH, so committing those subsets in
 * separate transactions would let Publish/Revert split one HTTP operation.
 * Both transaction-aware primitives acquire the same salon-row lock (a
 * repeated lock by the same transaction is harmless), and the transaction
 * rolls both updates back if either fails.
 */
export async function updateBookingPageDraftState(
  salonId: string,
  patch: BookingPageDraftStatePatch,
): Promise<unknown | null> {
  // Caller data is validated before the transaction begins, keeping the lock
  // duration bounded and preserving the existing strict API contract.
  const configPatch = patch.config === undefined
    ? undefined
    : bookingPageDraftPatchSchema.parse(patch.config);
  const contentPatch = patch.content === undefined
    ? undefined
    : bookingPageContentPatchSchema.parse(patch.content);

  return db.transaction(async (tx) => {
    if (configPatch !== undefined) {
      const updatedConfig = await updateBookingPageDraftInTransaction(
        tx,
        salonId,
        configPatch,
      );
      if (!updatedConfig) {
        return null;
      }
    }

    if (contentPatch !== undefined) {
      const updatedContent = await updateBookingPageContentDraftInTransaction(
        tx,
        salonId,
        contentPatch,
      );
      if (!updatedContent) {
        return null;
      }
    }

    const [updated] = await tx
      .select({ settings: salonSchema.settings })
      .from(salonSchema)
      .where(eq(salonSchema.id, salonId))
      .limit(1);

    return updated?.settings ?? null;
  });
}

/**
 * Publishes or reverts presentation and owner-editable page content from one
 * locked salon snapshot and one JSONB update. The booking-page owner surface
 * promises that both pairs move together; two independent commits could leave
 * a partially published page if the second write failed.
 */
export async function synchronizeBookingPageLifecycle(
  salonId: string,
  action: BookingPageLifecycleAction,
): Promise<unknown | null> {
  // Identity media remains private while a published business is editing an
  // onboarding draft. Prepare immutable, revision-addressed projections now,
  // then publish their canonical references in the same locked transaction as
  // the booking-page draft. A newer onboarding revision makes the apply step
  // fail closed, so an older slow upload can never replace a newer image.
  const preparedMedia = action === 'publish'
    ? await prepareCanonicalProfileMediaForPublish(salonId)
    : null;
  try {
    const synchronized = await db.transaction(async (tx) => {
      const [existing] = await tx
        .select({ settings: salonSchema.settings })
        .from(salonSchema)
        .where(eq(salonSchema.id, salonId))
        .for('update')
        .limit(1);

      if (!existing) {
        return null;
      }

      const config = resolveBookingPageConfig(existing.settings);
      const content = resolveBookingPageContent(existing.settings);
      const configSource = action === 'publish' ? config.draft : config.live;
      const contentSource = action === 'publish' ? content.draft : content.live;
      const presetSource = action === 'publish'
        ? config.draftPresetBase
        : config.livePresetBase;
      const configTargetPath = action === 'publish'
        ? sql.raw(`'{bookingPage,live}'`)
        : sql.raw(`'{bookingPage,draft}'`);
      const presetTargetPath = action === 'publish'
        ? sql.raw(`'{bookingPage,livePresetBase}'`)
        : sql.raw(`'{bookingPage,draftPresetBase}'`);
      const contentTargetPath = action === 'publish'
        ? sql.raw(`'{bookingPageContent,live}'`)
        : sql.raw(`'{bookingPageContent,draft}'`);

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
        '{bookingPage}',
        CASE
          WHEN jsonb_typeof(${settingsExpression}->'bookingPage') = 'object'
            THEN ${settingsExpression}->'bookingPage'
          ELSE '{}'::jsonb
        END
      )
    `;
      settingsExpression = sql`jsonb_set(${settingsExpression}, '{bookingPage,version}', '1'::jsonb)`;
      settingsExpression = sql`jsonb_set(${settingsExpression}, ${configTargetPath}, ${JSON.stringify(configSource)}::jsonb)`;
      settingsExpression = sql`jsonb_set(${settingsExpression}, ${presetTargetPath}, ${JSON.stringify(presetSource)}::jsonb)`;

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
      settingsExpression = sql`jsonb_set(${settingsExpression}, ${contentTargetPath}, ${JSON.stringify(contentSource)}::jsonb)`;

      const [updated] = await tx
        .update(salonSchema)
        .set({ settings: settingsExpression })
        .where(eq(salonSchema.id, salonId))
        .returning();

      if (updated && preparedMedia) {
        await applyPreparedCanonicalProfileMediaPromotion(tx, preparedMedia);
      }
      return updated?.settings ?? null;
    });
    if (preparedMedia && synchronized) {
      await completeCanonicalProfileMediaPromotion(preparedMedia);
    } else if (preparedMedia) {
      await discardPreparedCanonicalProfileMediaPromotion(preparedMedia);
    }
    return synchronized;
  } catch (error) {
    if (preparedMedia) {
      await discardPreparedCanonicalProfileMediaPromotion(preparedMedia);
    }
    throw error;
  }
}
