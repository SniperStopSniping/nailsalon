import 'server-only';

import { and, eq } from 'drizzle-orm';

import type { BookingBasket } from '@/libs/bookingParams';
import {
  addCalendarWeeks,
  buildConfirmationRebookingFallbackUrl,
  buildConfirmationRebookingUrl,
} from '@/libs/confirmationRebooking';
import { db } from '@/libs/DB';
import { resolvePublicBookingSelection } from '@/libs/publicBookingSelection';
import { resolvePublicBookingTechnicianContext } from '@/libs/publicBookingTechnicians';
import { getLocationById } from '@/libs/queries';
import type { RebookingPromptSettings } from '@/libs/rebookingPromptSettings';
import { getDateKeyInTimeZone } from '@/libs/timeZone';
import {
  appointmentAddOnSchema,
  appointmentSchema,
  appointmentServicesSchema,
} from '@/models/Schema';

type AppointmentSource = {
  id: string;
  salonId: string;
  startTime: Date;
  technicianId: string | null;
  locationId: string | null;
};

type RebookingResult = {
  bookingUrl: string;
  message?: string;
};

function normalizeIntervalWeeks(settings: RebookingPromptSettings): number {
  return settings.intervalWeeks;
}

/**
 * Recreates a booking selection only from current, public catalogue authority.
 * Snapshot rows intentionally serve only as IDs and quantities; current service,
 * add-on, technician and location rules remain authoritative.
 */
export async function createConfirmationRebookingHandoff(args: {
  appointment: AppointmentSource;
  salonSlug: string;
  locale: string;
  salonTimeZone: string;
  settings: RebookingPromptSettings;
}): Promise<RebookingResult> {
  const [serviceRows, addOnRows, location] = await Promise.all([
    db.select({
      id: appointmentServicesSchema.id,
      serviceId: appointmentServicesSchema.serviceId,
    })
      .from(appointmentServicesSchema)
      .innerJoin(appointmentSchema, and(
        eq(appointmentSchema.id, appointmentServicesSchema.appointmentId),
        eq(appointmentSchema.salonId, args.appointment.salonId),
      ))
      .where(eq(appointmentServicesSchema.appointmentId, args.appointment.id)),
    db.select({
      appointmentServiceId: appointmentAddOnSchema.appointmentServiceId,
      addOnId: appointmentAddOnSchema.addOnId,
      quantity: appointmentAddOnSchema.quantitySnapshot,
    })
      .from(appointmentAddOnSchema)
      .innerJoin(appointmentSchema, and(
        eq(appointmentSchema.id, appointmentAddOnSchema.appointmentId),
        eq(appointmentSchema.salonId, args.appointment.salonId),
      ))
      .where(eq(appointmentAddOnSchema.appointmentId, args.appointment.id)),
    args.appointment.locationId
      ? getLocationById(args.appointment.locationId, args.appointment.salonId)
      : Promise.resolve(null),
  ]);

  const fallback = (message = 'Your previous service has changed. Please choose a service for your next visit.', bookingBasket: BookingBasket | null = null) => ({
    bookingUrl: buildConfirmationRebookingFallbackUrl({
      salonSlug: args.salonSlug,
      locale: args.locale,
      locationId: location?.id ?? null,
      rebookingFallback: 'catalogue_changed',
      bookingBasket,
    }),
    message,
  });

  if (serviceRows.length === 0 || new Set(serviceRows.map(row => row.serviceId)).size !== serviceRows.length) {
    return fallback();
  }

  const addOnsByService = new Map<string, Array<{ addOnId: string; quantity: number }>>();
  const appointmentServiceIds = new Set(serviceRows.map(service => service.id));
  for (const addOn of addOnRows) {
    if (!addOn.appointmentServiceId
      || !appointmentServiceIds.has(addOn.appointmentServiceId)
      || !addOn.addOnId
      || addOn.quantity < 1) {
      return fallback();
    }
    const current = addOnsByService.get(addOn.appointmentServiceId) ?? [];
    current.push({ addOnId: addOn.addOnId, quantity: addOn.quantity });
    addOnsByService.set(addOn.appointmentServiceId, current);
  }

  const bookingBasket = {
    version: 2 as const,
    items: serviceRows.map(service => ({
      serviceId: service.serviceId,
      selectedAddOns: addOnsByService.get(service.id) ?? [],
    })),
  };

  try {
    const technicianContext = await resolvePublicBookingTechnicianContext({
      salonId: args.appointment.salonId,
      bookingBasket,
      technicianId: args.appointment.technicianId,
      locationId: location?.id ?? null,
    });
    // A prior technician is only carried when still publicly compatible. The
    // normal flow then retains full availability and may choose another artist.
    const technicianId = technicianContext.hasValidExplicitTechnician
      ? args.appointment.technicianId
      : null;
    const sourceDate = getDateKeyInTimeZone(args.appointment.startTime, args.salonTimeZone);
    const suggestedDate = addCalendarWeeks(sourceDate, normalizeIntervalWeeks(args.settings));
    return {
      bookingUrl: buildConfirmationRebookingUrl({
        salonSlug: args.salonSlug,
        locale: args.locale,
        bookingBasket,
        locationId: location?.id ?? null,
        technicianId,
        suggestedDate,
      }),
    };
  } catch {
    // Retain one still-valid selection on the service step where it can be
    // visibly reviewed. A multi-service basket has no safe partial editor on
    // that step, so it intentionally asks for a fresh choice instead of
    // dropping items without telling the customer.
    const validItems = [] as typeof bookingBasket.items;
    for (const item of bookingBasket.items) {
      try {
        await resolvePublicBookingSelection({
          salonId: args.appointment.salonId,
          bookingBasket: { version: 2, items: [item] },
        });
        validItems.push(item);
      } catch {
        // Retain the current base and every add-on that still validates. The
        // service page's visible fallback notice makes any omitted selection
        // explicit and the normal catalogue rules recalculate the quote.
        try {
          const carriedAddOns = [] as typeof item.selectedAddOns;
          const withoutChangedAddOns = { ...item, selectedAddOns: carriedAddOns };
          await resolvePublicBookingSelection({
            salonId: args.appointment.salonId,
            bookingBasket: { version: 2, items: [withoutChangedAddOns] },
          });
          for (const addOn of item.selectedAddOns) {
            const candidate = [...carriedAddOns, addOn];
            try {
              await resolvePublicBookingSelection({
                salonId: args.appointment.salonId,
                bookingBasket: { version: 2, items: [{ ...item, selectedAddOns: candidate }] },
              });
              carriedAddOns.push(addOn);
            } catch {
              // This selected add-on no longer validates with the current menu.
            }
          }
          validItems.push({ ...item, selectedAddOns: carriedAddOns });
        } catch {
          // A changed base service cannot be carried into a new quote.
        }
      }
    }
    return fallback(undefined, validItems.length === 1 ? { version: 2, items: validItems } : null);
  }
}
