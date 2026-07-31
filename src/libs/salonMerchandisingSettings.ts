import { z } from 'zod';

import type { SalonSettings } from '@/types/salonPolicy';

export const DEFAULT_MERCHANDISING_SETTINGS = {
  featureLusterManicure: true,
  showServiceImages: true,
  lusterPromoDismissed: false,
  serviceLibraryIntroDismissed: false,
} as const;

export const merchandisingSettingsSchema = z.object({
  featureLusterManicure: z.boolean().default(DEFAULT_MERCHANDISING_SETTINGS.featureLusterManicure),
  showServiceImages: z.boolean().default(DEFAULT_MERCHANDISING_SETTINGS.showServiceImages),
  lusterPromoDismissed: z.boolean().default(DEFAULT_MERCHANDISING_SETTINGS.lusterPromoDismissed),
  serviceLibraryIntroDismissed: z.boolean().default(DEFAULT_MERCHANDISING_SETTINGS.serviceLibraryIntroDismissed),
});

export type MerchandisingSettings = z.infer<typeof merchandisingSettingsSchema>;

export const merchandisingSettingsUpdateSchema = merchandisingSettingsSchema.partial();

export type MerchandisingSettingsUpdate = z.infer<typeof merchandisingSettingsUpdateSchema>;

export function resolveMerchandisingSettings(
  settings: SalonSettings | null | undefined,
): MerchandisingSettings {
  const stored = settings?.merchandising;
  const values = stored && typeof stored === 'object' && !Array.isArray(stored)
    ? stored as Record<string, unknown>
    : {};

  // Resolve each key independently. One malformed stored value must not reset
  // valid sibling preferences when a later partial PATCH canonicalizes the
  // merchandising block.
  return merchandisingSettingsSchema.parse({
    featureLusterManicure: typeof values.featureLusterManicure === 'boolean'
      ? values.featureLusterManicure
      : undefined,
    showServiceImages: typeof values.showServiceImages === 'boolean'
      ? values.showServiceImages
      : undefined,
    lusterPromoDismissed: typeof values.lusterPromoDismissed === 'boolean'
      ? values.lusterPromoDismissed
      : undefined,
    serviceLibraryIntroDismissed: typeof values.serviceLibraryIntroDismissed === 'boolean'
      ? values.serviceLibraryIntroDismissed
      : undefined,
  });
}
