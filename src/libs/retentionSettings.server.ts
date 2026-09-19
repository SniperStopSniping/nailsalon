import 'server-only';

import { eq } from 'drizzle-orm';

import { db } from '@/libs/DB';
import { mergeRetentionSettings, resolveRetentionSettings } from '@/libs/retentionAssistant';
import { applyReviewPolicyTransitionWithHandle, getReviewSettings, lockSalonReviewMutation } from '@/libs/reviewRequests.server';
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
  const row = await db.transaction(async (transaction) => {
    await lockSalonReviewMutation(transaction, salonId);
    await transaction.select({ id: salonSchema.id }).from(salonSchema).where(eq(salonSchema.id, salonId)).for('no key update');
    const old = await getReviewSettings(salonId, transaction);
    const transition = await applyReviewPolicyTransitionWithHandle(transaction, salonId, old, {
      mode: old.policy.mode,
      googleReviewUrl: settings.googleReviewUrl,
    });
    const [saved] = await transaction
      .insert(salonRetentionSettingsSchema)
      .values({
        salonId,
        ...settings,
        ...transition,
      })
      .onConflictDoUpdate({
        target: salonRetentionSettingsSchema.salonId,
        set: {
          ...settings,
          ...transition,
          updatedAt: new Date(),
        },
      })
      .returning();
    return saved;
  });

  return resolveRetentionSettings(row ?? settings);
}

/** Merge a PATCH under the review fence so unrelated writes cannot restore a stale URL. */
export async function patchRetentionSettingsForSalon(
  salonId: string,
  patch: Parameters<typeof mergeRetentionSettings>[1],
): Promise<RetentionSettings> {
  return db.transaction(async (transaction) => {
    await lockSalonReviewMutation(transaction, salonId);
    await transaction.select({ id: salonSchema.id }).from(salonSchema).where(eq(salonSchema.id, salonId)).for('no key update');
    const old = await getReviewSettings(salonId, transaction);
    const [row] = await transaction.select().from(salonRetentionSettingsSchema)
      .where(eq(salonRetentionSettingsSchema.salonId, salonId)).limit(1);
    const [salon] = row
      ? []
      : await transaction.select({ settings: salonSchema.settings }).from(salonSchema)
        .where(eq(salonSchema.id, salonId)).limit(1);
    const legacyUrl = (salon?.settings as SalonSettings | null | undefined)?.googleReviewUrl ?? null;
    const safeLegacyUrl = (() => {
      try {
        return legacyUrl && new URL(legacyUrl).protocol === 'https:' ? legacyUrl : null;
      } catch {
        return null;
      }
    })();
    const current = resolveRetentionSettings(row ?? { googleReviewUrl: safeLegacyUrl });
    const next = mergeRetentionSettings(current, patch);
    const transition = await applyReviewPolicyTransitionWithHandle(transaction, salonId, old, {
      mode: old.policy.mode,
      googleReviewUrl: next.googleReviewUrl,
    });
    const [saved] = await transaction.insert(salonRetentionSettingsSchema).values({ salonId, ...next, ...transition })
      .onConflictDoUpdate({ target: salonRetentionSettingsSchema.salonId, set: { ...next, ...transition, updatedAt: new Date() } }).returning();
    return resolveRetentionSettings(saved ?? next);
  });
}
