import 'server-only';

import { eq, sql } from 'drizzle-orm';

import { resolveBookingPageConfig } from '@/libs/bookingPageConfig';
import { resolveBookingPageContent } from '@/libs/bookingPageContent';
import { db } from '@/libs/DB';
import { salonSchema } from '@/models/Schema';

export type BookingPageLifecycleAction = 'publish' | 'revert';

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
  return db.transaction(async (tx) => {
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

    return updated?.settings ?? null;
  });
}
