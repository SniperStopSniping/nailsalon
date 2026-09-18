import { type BookingConfig, resolveBookingConfigFromSettings } from '@/libs/bookingConfig.shared';
import type { SalonSettings } from '@/types/salonPolicy';

export * from '@/libs/bookingConfig.shared';

export async function getBookingConfigForSalon(salonId: string): Promise<BookingConfig> {
  const { getSalonById } = await import('@/libs/queries');
  const salon = await getSalonById(salonId);
  return resolveBookingConfigFromSettings((salon?.settings as SalonSettings | null | undefined) ?? null);
}
