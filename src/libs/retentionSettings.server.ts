import 'server-only';

import { eq } from 'drizzle-orm';

import { db } from '@/libs/DB';
import { resolveRetentionSettings } from '@/libs/retentionAssistant';
import { salonRetentionSettingsSchema, salonSchema } from '@/models/Schema';
import type { RetentionSettings } from '@/types/retention';
import type { SalonSettings } from '@/types/salonPolicy';

export async function getRetentionSettingsForSalon(salonId: string): Promise<RetentionSettings> {
  const [row] = await db
    .select()
    .from(salonRetentionSettingsSchema)
    .where(eq(salonRetentionSettingsSchema.salonId, salonId))
    .limit(1);

  if (row) {
    return resolveRetentionSettings(row);
  }

  // Compatibility for salons that configured their review link before the
  // retention settings table existed (migration 0055 also backfills it).
  const [legacySalon] = await db
    .select({ settings: salonSchema.settings })
    .from(salonSchema)
    .where(eq(salonSchema.id, salonId))
    .limit(1);
  const legacyReviewUrl = (legacySalon?.settings as SalonSettings | null | undefined)
    ?.googleReviewUrl
    ?? null;
  const safeLegacyReviewUrl = (() => {
    if (!legacyReviewUrl) {
      return null;
    }
    try {
      return new URL(legacyReviewUrl).protocol === 'https:' ? legacyReviewUrl : null;
    } catch {
      return null;
    }
  })();

  return resolveRetentionSettings({
    ...(row ?? {}),
    googleReviewUrl: safeLegacyReviewUrl,
  });
}

export async function saveRetentionSettingsForSalon(
  salonId: string,
  settings: RetentionSettings,
): Promise<RetentionSettings> {
  const [row] = await db
    .insert(salonRetentionSettingsSchema)
    .values({
      salonId,
      ...settings,
    })
    .onConflictDoUpdate({
      target: salonRetentionSettingsSchema.salonId,
      set: {
        ...settings,
        updatedAt: new Date(),
      },
    })
    .returning();

  return resolveRetentionSettings(row ?? settings);
}
