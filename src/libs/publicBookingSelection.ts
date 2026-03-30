import { getBookingConfigForSalon, resolveIntroPriceLabel } from '@/libs/bookingConfig';
import {
  FIRST_VISIT_DISCOUNT_LABEL,
  FIRST_VISIT_DISCOUNT_PERCENT,
  resolveAutomaticBookingDiscount,
} from '@/libs/firstVisitDiscount';
import { type SelectedAddOnParam } from '@/libs/bookingParams';
import { validatePublicBookingSelection } from '@/libs/bookingQuote';
import { getServicesByIds } from '@/libs/queries';
import type { AddOnCategory, AddOnPricingType, Service, ServiceCategory } from '@/models/Schema';

export type PublicBookingServiceSummary = {
  id: string;
  name: string;
  description: string | null;
  descriptionItems: string[];
  priceCents: number;
  priceDisplayText: string | null;
  durationMinutes: number;
  category: ServiceCategory;
  imageUrl: string | null;
  resolvedIntroPriceLabel: string | null;
};

export type PublicBookingAddOnSummary = {
  id: string;
  name: string;
  descriptionItems: string[];
  category: AddOnCategory;
  pricingType: AddOnPricingType;
  unitLabel: string | null;
  maxQuantity: number | null;
  quantity: number;
  unitPriceCents: number;
  lineTotalCents: number;
  unitDurationMinutes: number;
  lineDurationMinutes: number;
  priceDisplayText: string | null;
};

export type ResolvedPublicBookingSelection = {
  mode: 'base-service' | 'legacy';
  baseServiceId: string | null;
  selectedAddOns: SelectedAddOnParam[];
  requestedServices: Service[];
  services: PublicBookingServiceSummary[];
  addOns: PublicBookingAddOnSummary[];
  subtotalBeforeDiscountCents: number;
  discountAmountCents: number;
  totalPriceCents: number;
  firstVisitDiscountPreview: {
    label: string;
    percent: number;
    amountCents: number;
  } | null;
  visibleDurationMinutes: number;
  blockedDurationMinutes: number;
  bufferMinutes: number;
};

function mapDescriptionItems(
  descriptionItems: string[] | null,
  description: string | null,
): string[] {
  if (Array.isArray(descriptionItems) && descriptionItems.length > 0) {
    return descriptionItems;
  }

  if (!description) {
    return [];
  }

  return description
    .split('\n')
    .map(item => item.trim())
    .filter(Boolean);
}

export async function resolvePublicBookingSelection(args: {
  salonId: string;
  baseServiceId?: string | null;
  selectedAddOns?: SelectedAddOnParam[];
  serviceIds?: string[];
  technicianId?: string | null;
  clientPhone?: string | null;
  originalAppointmentId?: string | null;
}): Promise<ResolvedPublicBookingSelection> {
  const bookingConfig = await getBookingConfigForSalon(args.salonId);
  const baseServiceId = args.baseServiceId ?? null;
  const selectedAddOns = args.selectedAddOns ?? [];

  if (baseServiceId) {
    const validated = await validatePublicBookingSelection({
      salonId: args.salonId,
      selection: {
        baseServiceId,
        selectedAddOns,
      },
      technicianId: args.technicianId ?? null,
    });
    const pricing = await resolveAutomaticBookingDiscount({
      salonId: args.salonId,
      services: [validated.baseServiceRecord],
      subtotalBeforeDiscountCents: validated.quote.subtotalCents,
      clientPhone: args.clientPhone ?? null,
      originalAppointmentId: args.originalAppointmentId ?? null,
    });

    return {
      mode: 'base-service',
      baseServiceId,
      selectedAddOns: validated.quote.addOns.map(addOn => ({
        addOnId: addOn.addOnId,
        quantity: addOn.quantity,
      })),
      requestedServices: [validated.baseServiceRecord],
      services: [{
        id: validated.baseServiceRecord.id,
        name: validated.baseServiceRecord.name,
        description: validated.baseServiceRecord.description ?? null,
        descriptionItems: mapDescriptionItems(
          validated.baseServiceRecord.descriptionItems ?? null,
          validated.baseServiceRecord.description ?? null,
        ),
        priceCents: validated.baseServiceRecord.price,
        priceDisplayText: validated.baseServiceRecord.priceDisplayText ?? null,
        durationMinutes: validated.baseServiceRecord.durationMinutes,
        category: validated.baseServiceRecord.category,
        imageUrl: validated.baseServiceRecord.imageUrl ?? null,
        resolvedIntroPriceLabel: validated.quote.baseService.resolvedIntroPriceLabel,
      }],
      addOns: validated.addOnRecords.map((addOnRecord) => {
        const quoteAddOn = validated.quote.addOns.find(item => item.addOnId === addOnRecord.id);
        if (!quoteAddOn) {
          throw new Error(`MISSING_QUOTE_ADD_ON:${addOnRecord.id}`);
        }

        return {
          id: addOnRecord.id,
          name: addOnRecord.name,
          descriptionItems: addOnRecord.descriptionItems ?? [],
          category: addOnRecord.category,
          pricingType: addOnRecord.pricingType,
          unitLabel: addOnRecord.unitLabel ?? null,
          maxQuantity: addOnRecord.maxQuantity ?? null,
          quantity: quoteAddOn.quantity,
          unitPriceCents: quoteAddOn.unitPriceCents,
          lineTotalCents: quoteAddOn.lineTotalCents,
          unitDurationMinutes: quoteAddOn.unitDurationMinutes,
          lineDurationMinutes: quoteAddOn.lineDurationMinutes,
          priceDisplayText: addOnRecord.priceDisplayText ?? null,
        };
      }),
      subtotalBeforeDiscountCents: pricing.subtotalBeforeDiscountCents,
      discountAmountCents: pricing.discountAmountCents,
      totalPriceCents: pricing.finalTotalCents,
      firstVisitDiscountPreview: pricing.kind === 'first_visit'
        ? {
            label: FIRST_VISIT_DISCOUNT_LABEL,
            percent: FIRST_VISIT_DISCOUNT_PERCENT,
            amountCents: pricing.discountAmountCents,
          }
        : null,
      visibleDurationMinutes: validated.quote.visibleDurationMinutes,
      blockedDurationMinutes: validated.quote.blockedDurationMinutes,
      bufferMinutes: validated.quote.bufferMinutes,
    };
  }

  const serviceIds = args.serviceIds ?? [];
  const services = await getServicesByIds(serviceIds, args.salonId);

  if (services.length !== serviceIds.length) {
    throw new Error('INVALID_SERVICES');
  }

  const subtotalBeforeDiscountCents = services.reduce((sum, service) => sum + service.price, 0);
  const pricing = await resolveAutomaticBookingDiscount({
    salonId: args.salonId,
    services,
    subtotalBeforeDiscountCents,
    clientPhone: args.clientPhone ?? null,
    originalAppointmentId: args.originalAppointmentId ?? null,
  });

  return {
    mode: 'legacy',
    baseServiceId: null,
    selectedAddOns: [],
    requestedServices: services,
    services: services.map(service => ({
      id: service.id,
      name: service.name,
      description: service.description ?? null,
      descriptionItems: mapDescriptionItems(service.descriptionItems ?? null, service.description ?? null),
      priceCents: service.price,
      priceDisplayText: service.priceDisplayText ?? null,
      durationMinutes: service.durationMinutes,
      category: service.category,
      imageUrl: service.imageUrl ?? null,
      resolvedIntroPriceLabel: resolveIntroPriceLabel({
        isIntroPrice: service.isIntroPrice,
        introPriceExpiresAt: service.introPriceExpiresAt,
        introPriceLabel: service.introPriceLabel,
        bookingConfig,
      }),
    })),
    addOns: [],
    subtotalBeforeDiscountCents: pricing.subtotalBeforeDiscountCents,
    discountAmountCents: pricing.discountAmountCents,
    totalPriceCents: pricing.finalTotalCents,
    firstVisitDiscountPreview: pricing.kind === 'first_visit'
      ? {
          label: FIRST_VISIT_DISCOUNT_LABEL,
          percent: FIRST_VISIT_DISCOUNT_PERCENT,
          amountCents: pricing.discountAmountCents,
        }
      : null,
    visibleDurationMinutes: services.reduce((sum, service) => sum + service.durationMinutes, 0),
    blockedDurationMinutes: services.reduce((sum, service) => sum + service.durationMinutes, 0) + bookingConfig.bufferMinutes,
    bufferMinutes: bookingConfig.bufferMinutes,
  };
}
