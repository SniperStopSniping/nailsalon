import { getDateKeyInTimeZone, getTimeKeyInTimeZone } from './timeZone';

/** Display a recovered creation receipt, never today's edited menu/prices. */
export function publicBookingReceiptPresentation(response: any, timeZone: string) {
  const data = response?.data;
  const appointment = data?.appointment;
  const financial = appointment?.bookingTaxSnapshot;
  if (!appointment || !Array.isArray(data.services) || !Array.isArray(data.addOns)
    || !Number.isFinite(Date.parse(appointment.startTime))
    || !Number.isInteger(appointment.totalDurationMinutes)
    || !Number.isInteger(financial?.invoiceTotalCents) || typeof financial.currency !== 'string'
    || data.services.some((item: any) => !item.service?.id || typeof item.service.name !== 'string'
      || !Number.isInteger(item.priceAtBooking) || !Number.isInteger(item.durationAtBooking))
      || data.addOns.some((item: any) => typeof item.nameSnapshot !== 'string'
        || !Number.isInteger(item.unitPriceCentsSnapshot) || !Number.isInteger(item.quantitySnapshot)
        || !Number.isInteger(item.durationMinutesSnapshot))) {
    return null;
  }
  return {
    services: data.services.map((item: any) => ({ id: item.service.id as string, name: item.service.name as string, price: item.priceAtBooking / 100, duration: item.durationAtBooking as number })),
    addOns: data.addOns.map((item: any) => ({ id: (item.addOnId ?? item.id) as string, name: item.nameSnapshot as string, price: item.priceModeSnapshot === 'manual_confirmation' ? 0 : item.unitPriceCentsSnapshot / 100, priceMode: item.priceModeSnapshot ?? 'catalog_priced', duration: item.durationMinutesSnapshot as number, quantity: item.quantitySnapshot as number })),
    technician: data.technician ? { id: data.technician.id as string, name: data.technician.name as string, imageUrl: (data.technician.avatarUrl ?? null) as string | null } : null,
    totalPrice: financial.invoiceTotalCents / 100,
    currency: financial.currency as string,
    totalCents: financial.invoiceTotalCents as number,
    totalDuration: appointment.totalDurationMinutes as number,
    canonicalStartTime: appointment.startTime as string,
    dateStr: getDateKeyInTimeZone(new Date(appointment.startTime), timeZone),
    timeStr: getTimeKeyInTimeZone(new Date(appointment.startTime), timeZone),
  };
}
