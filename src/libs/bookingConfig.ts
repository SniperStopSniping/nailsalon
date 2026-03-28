import { z } from 'zod';

import type { SalonSettings } from '@/types/salonPolicy';

export const SUPPORTED_BOOKING_SLOT_INTERVALS = [5, 10, 15, 30] as const;
export const SUPPORTED_BOOKING_CURRENCIES = ['CAD', 'USD'] as const;
export const DEFAULT_BOOKING_CONFIG = {
  bufferMinutes: 10,
  slotIntervalMinutes: 15,
  currency: 'CAD',
  timezone: 'America/Toronto',
  introPriceDefaultLabel: null,
} as const;

export const bookingConfigSchema = z.object({
  bufferMinutes: z.number().int().min(0).max(60).default(DEFAULT_BOOKING_CONFIG.bufferMinutes),
  slotIntervalMinutes: z.union(SUPPORTED_BOOKING_SLOT_INTERVALS.map(value => z.literal(value)) as [
    z.ZodLiteral<5>,
    z.ZodLiteral<10>,
    z.ZodLiteral<15>,
    z.ZodLiteral<30>,
  ]).default(DEFAULT_BOOKING_CONFIG.slotIntervalMinutes),
  currency: z.union(SUPPORTED_BOOKING_CURRENCIES.map(value => z.literal(value)) as [
    z.ZodLiteral<'CAD'>,
    z.ZodLiteral<'USD'>,
  ]).default(DEFAULT_BOOKING_CONFIG.currency),
  timezone: z.string().default(DEFAULT_BOOKING_CONFIG.timezone).refine((value) => {
    try {
      Intl.DateTimeFormat(undefined, { timeZone: value });
      return true;
    } catch {
      return false;
    }
  }, 'Invalid timezone'),
  introPriceDefaultLabel: z.string().trim().max(120).nullable().default(DEFAULT_BOOKING_CONFIG.introPriceDefaultLabel),
});

export type BookingConfig = z.infer<typeof bookingConfigSchema>;

export function resolveBookingConfigFromSettings(settings: SalonSettings | null | undefined): BookingConfig {
  const parsed = bookingConfigSchema.safeParse(settings?.booking ?? {});
  if (parsed.success) {
    return parsed.data;
  }

  return bookingConfigSchema.parse({});
}

export async function getBookingConfigForSalon(salonId: string): Promise<BookingConfig> {
  const { getSalonById } = await import('@/libs/queries');
  const salon = await getSalonById(salonId);
  return resolveBookingConfigFromSettings((salon?.settings as SalonSettings | null | undefined) ?? null);
}

export function resolveIntroPriceLabel(args: {
  isIntroPrice?: boolean | null;
  introPriceExpiresAt?: Date | null;
  introPriceLabel?: string | null;
  bookingConfig: BookingConfig;
  now?: Date;
}): string | null {
  const {
    isIntroPrice = false,
    introPriceExpiresAt = null,
    introPriceLabel = null,
    bookingConfig,
    now = new Date(),
  } = args;

  if (!isIntroPrice) {
    return null;
  }

  if (introPriceExpiresAt && introPriceExpiresAt.getTime() < now.getTime()) {
    return null;
  }

  const serviceLabel = introPriceLabel?.trim() || null;
  if (serviceLabel) {
    return serviceLabel;
  }

  return bookingConfig.introPriceDefaultLabel?.trim() || null;
}
