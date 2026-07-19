import { z } from 'zod';

import type { SalonSettings } from '@/types/salonPolicy';

export const DEFAULT_MERCHANDISING_SETTINGS = {
  featureLusterManicure: true,
  lusterPromoDismissed: false,
  serviceLibraryIntroDismissed: false,
} as const;

export const merchandisingSettingsSchema = z.object({
  featureLusterManicure: z.boolean().default(DEFAULT_MERCHANDISING_SETTINGS.featureLusterManicure),
  lusterPromoDismissed: z.boolean().default(DEFAULT_MERCHANDISING_SETTINGS.lusterPromoDismissed),
  serviceLibraryIntroDismissed: z.boolean().default(DEFAULT_MERCHANDISING_SETTINGS.serviceLibraryIntroDismissed),
});

export type MerchandisingSettings = z.infer<typeof merchandisingSettingsSchema>;

export const merchandisingSettingsUpdateSchema = merchandisingSettingsSchema.partial();

export type MerchandisingSettingsUpdate = z.infer<typeof merchandisingSettingsUpdateSchema>;

export function resolveMerchandisingSettings(
  settings: SalonSettings | null | undefined,
): MerchandisingSettings {
  const parsed = merchandisingSettingsSchema.safeParse(settings?.merchandising ?? {});
  if (parsed.success) {
    return parsed.data;
  }

  return merchandisingSettingsSchema.parse({});
}
