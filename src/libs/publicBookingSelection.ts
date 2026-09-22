import { and, eq, inArray } from 'drizzle-orm';

import { getBookingConfigForSalon, resolveIntroPriceLabel } from '@/libs/bookingConfig';
import type { BookingBasket, SelectedAddOnParam } from '@/libs/bookingParams';
import { type BookingSelectionReadContext, fingerprintBookingBasketReview, validatePublicBookingBasket, validatePublicBookingSelection } from '@/libs/bookingQuote';
import {
  type AutomaticBookingDiscountResult,
  type BookingDiscountReadContext,
  FIRST_VISIT_DISCOUNT_LABEL,
  FIRST_VISIT_DISCOUNT_PERCENT,
  resolveAutomaticBookingDiscount,
} from '@/libs/firstVisitDiscount';
import { type AddOnCategory, type AddOnPricingType, type Service, type ServiceAddOnPriceMode, type ServiceCategory, serviceSchema } from '@/models/Schema';

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
  /** Service this option was validated against; required for basket selections. */
  serviceId?: string;
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
  /** Binding-level price authority, preserved through appointment creation. */
  priceMode: ServiceAddOnPriceMode;
  priceDisplayText: string | null;
};

export type PublicBookingManualConfirmationItem = {
  serviceId?: string;
  addOnId: string;
  name: string;
  /** Owner-authored public qualifier (for example, "$15+"); never calculated. */
  priceDisplayText: string | null;
  quantity: number;
  lineDurationMinutes: number;
  priceStatus: 'to_be_confirmed';
};

export type ResolvedPublicBookingSelection = {
  mode: 'base-service' | 'legacy';
  l1ConfirmationMode?: 'instant' | 'request_approval' | 'consultation' | null;
  catalogAcknowledgment?: { serviceId: string; resolutionFingerprint: string };
  eligibleTechnicianIds?: string[];
  requestedSelectedAddOns?: SelectedAddOnParam[];
  /** Present for versioned multi-service selections. */
  bookingBasket?: BookingBasket;
  basketReviewFingerprint?: string;
  baseServiceId: string | null;
  selectedAddOns: SelectedAddOnParam[];
  requestedServices: Service[];
  services: PublicBookingServiceSummary[];
  addOns: PublicBookingAddOnSummary[];
  manualConfirmationItems: PublicBookingManualConfirmationItem[];
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
  /** Canonical pricing authority for callers that need the committed result. */
  automaticDiscount: AutomaticBookingDiscountResult;
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
  bookingBasket?: BookingBasket | null;
  serviceIds?: string[];
  technicianId?: string | null;
  clientPhone?: string | null;
  originalAppointmentId?: string | null;
  readContext?: BookingSelectionReadContext;
}): Promise<ResolvedPublicBookingSelection> {
  if (args.readContext && args.readContext.salonId !== args.salonId) {
    throw new Error('BOOKING_READ_CONTEXT_SALON_MISMATCH');
  }
  const readContext: BookingDiscountReadContext | undefined = args.readContext;
  const bookingConfig = readContext?.bookingConfig ?? await getBookingConfigForSalon(args.salonId);
  const baseServiceId = args.baseServiceId ?? null;
  const selectedAddOns = args.selectedAddOns ?? [];
  const bookingBasket = args.bookingBasket ?? null;

  if (bookingBasket) {
    const validatedBasket = await validatePublicBookingBasket({
      salonId: args.salonId,
      basket: bookingBasket,
      technicianId: args.technicianId ?? null,
      readContext,
    });
    const requestedServices = validatedBasket.items.map(item => item.validated.baseServiceRecord);
    const pricing = await resolveAutomaticBookingDiscount({
      salonId: args.salonId,
      services: requestedServices,
      subtotalBeforeDiscountCents: validatedBasket.subtotalCents,
      clientPhone: args.clientPhone ?? null,
      originalAppointmentId: args.originalAppointmentId ?? null,
      readContext,
    });

    return {
      // Exact service assignment is required for every basket item, the same
      // compatibility policy the single base-service path already uses.
      mode: 'base-service',
      bookingBasket: validatedBasket.basket,
      basketReviewFingerprint: fingerprintBookingBasketReview(validatedBasket),
      l1ConfirmationMode: validatedBasket.items.some(item => item.validated.l1?.confirmationMode === 'request_approval')
        ? 'request_approval'
        : validatedBasket.items.some(item => item.validated.l1?.confirmationMode === 'consultation')
          ? 'consultation'
          : validatedBasket.items.some(item => item.validated.l1)
            ? 'instant'
            : null,
      eligibleTechnicianIds: validatedBasket.items.reduce<string[] | undefined>((eligible, item) => {
        const current = item.validated.l1?.eligibleTechnicianIds;
        if (!current) {
          return eligible;
        }
        return eligible === undefined ? current : eligible.filter(id => current.includes(id));
      }, undefined),
      baseServiceId: validatedBasket.basket.items[0]!.serviceId,
      selectedAddOns: [],
      requestedServices,
      services: validatedBasket.items.map(({ validated }) => ({
        id: validated.baseServiceRecord.id,
        name: validated.baseServiceRecord.name,
        description: validated.baseServiceRecord.description ?? null,
        descriptionItems: mapDescriptionItems(
          validated.baseServiceRecord.descriptionItems ?? null,
          validated.baseServiceRecord.description ?? null,
        ),
        priceCents: validated.quote.baseService.priceCents,
        priceDisplayText: validated.baseServiceRecord.priceDisplayText ?? null,
        durationMinutes: validated.quote.baseService.durationMinutes,
        category: validated.baseServiceRecord.category,
        imageUrl: validated.baseServiceRecord.imageUrl ?? null,
        resolvedIntroPriceLabel: validated.quote.baseService.resolvedIntroPriceLabel,
      })),
      addOns: validatedBasket.items.flatMap(({ serviceId, validated }) => validated.addOnRecords.map((addOnRecord) => {
        const quoteAddOn = validated.quote.addOns.find(item => item.addOnId === addOnRecord.id);
        if (!quoteAddOn) {
          throw new Error(`MISSING_QUOTE_ADD_ON:${serviceId}:${addOnRecord.id}`);
        }
        return {
          serviceId,
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
          priceMode: quoteAddOn.priceMode,
          priceDisplayText: addOnRecord.priceDisplayText ?? null,
        };
      })),
      manualConfirmationItems: validatedBasket.items.flatMap(({ serviceId, validated }) =>
        validated.quote.manualConfirmationItems.map(item => ({ ...item, serviceId }))),
      subtotalBeforeDiscountCents: pricing.subtotalBeforeDiscountCents,
      discountAmountCents: pricing.discountAmountCents,
      totalPriceCents: pricing.finalTotalCents,
      firstVisitDiscountPreview: pricing.kind === 'first_visit'
        ? { label: FIRST_VISIT_DISCOUNT_LABEL, percent: FIRST_VISIT_DISCOUNT_PERCENT, amountCents: pricing.discountAmountCents }
        : null,
      visibleDurationMinutes: validatedBasket.visibleDurationMinutes,
      blockedDurationMinutes: validatedBasket.blockedDurationMinutes,
      bufferMinutes: validatedBasket.bufferMinutes,
      automaticDiscount: pricing,
    };
  }

  if (baseServiceId) {
    const validated = await validatePublicBookingSelection({
      salonId: args.salonId,
      selection: {
        baseServiceId,
        selectedAddOns,
      },
      technicianId: args.technicianId ?? null,
      readContext,
    });
    const pricing = await resolveAutomaticBookingDiscount({
      salonId: args.salonId,
      services: [validated.baseServiceRecord],
      subtotalBeforeDiscountCents: validated.quote.subtotalCents,
      clientPhone: args.clientPhone ?? null,
      originalAppointmentId: args.originalAppointmentId ?? null,
      readContext,
    });

    return {
      mode: 'base-service',
      ...(validated.l1 ? { l1ConfirmationMode: validated.l1.confirmationMode, catalogAcknowledgment: { serviceId: baseServiceId, resolutionFingerprint: validated.l1.fingerprint }, eligibleTechnicianIds: validated.l1.eligibleTechnicianIds, requestedSelectedAddOns: selectedAddOns } : {}),
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
        priceCents: validated.quote.baseService.priceCents,
        priceDisplayText: validated.baseServiceRecord.priceDisplayText ?? null,
        durationMinutes: validated.quote.baseService.durationMinutes,
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
          serviceId: validated.baseServiceRecord.id,
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
          priceMode: quoteAddOn.priceMode,
          priceDisplayText: addOnRecord.priceDisplayText ?? null,
        };
      }),
      manualConfirmationItems: validated.quote.manualConfirmationItems.map((item) => {
        const priceDisplayText = validated.addOnRecords.find(addOn => addOn.id === item.addOnId)?.priceDisplayText ?? null;
        return {
          serviceId: validated.baseServiceRecord.id,
          addOnId: item.addOnId,
          name: item.name,
          priceDisplayText,
          quantity: item.quantity,
          lineDurationMinutes: item.lineDurationMinutes,
          priceStatus: item.priceStatus,
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
      automaticDiscount: pricing,
    };
  }

  const serviceIds = args.serviceIds ?? [];
  const services = readContext
    ? await readContext.database.select().from(serviceSchema).where(and(inArray(serviceSchema.id, serviceIds), eq(serviceSchema.salonId, args.salonId), eq(serviceSchema.isActive, true)))
    : await (await import('@/libs/queries')).getServicesByIds(serviceIds, args.salonId);

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
    readContext,
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
    manualConfirmationItems: [],
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
    automaticDiscount: pricing,
  };
}
