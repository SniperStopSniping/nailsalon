import { and, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';

import { getBookingConfigForSalon, resolveIntroPriceLabel } from '@/libs/bookingConfig';
import { mapAddOnToCatalogSummary, mapServiceAddOnRule, mapServiceToCatalogSummary } from '@/libs/bookingCatalog';
import {
  addOnSchema,
  type AddOn,
  type AddOnCategory,
  type AddOnPricingType,
  type Service,
  type ServiceCategory,
  serviceAddOnSchema,
} from '@/models/Schema';

export const selectedAddOnInputSchema = z.object({
  addOnId: z.string().min(1, 'Add-on ID is required'),
  quantity: z.number().int().min(1).max(20).optional(),
});

export const publicBookingSelectionSchema = z.object({
  baseServiceId: z.string().min(1, 'Base service is required'),
  selectedAddOns: z.array(selectedAddOnInputSchema).default([]),
});

export type SelectedAddOnInput = z.infer<typeof selectedAddOnInputSchema>;
export type PublicBookingSelection = z.infer<typeof publicBookingSelectionSchema>;

export type BookingQuote = {
  baseService: {
    id: string;
    name: string;
    category: ServiceCategory;
    priceCents: number;
    durationMinutes: number;
    resolvedIntroPriceLabel: string | null;
  };
  addOns: Array<{
    addOnId: string;
    name: string;
    category: AddOnCategory;
    pricingType: AddOnPricingType;
    quantity: number;
    unitPriceCents: number;
    lineTotalCents: number;
    unitDurationMinutes: number;
    lineDurationMinutes: number;
  }>;
  subtotalCents: number;
  baseDurationMinutes: number;
  addOnsDurationMinutes: number;
  visibleDurationMinutes: number;
  bufferMinutes: number;
  blockedDurationMinutes: number;
};

type ValidatedSelectionResult = {
  baseServiceRecord: Service;
  addOnRecords: AddOn[];
  baseService: ReturnType<typeof mapServiceToCatalogSummary>;
  addOns: Array<ReturnType<typeof mapAddOnToCatalogSummary> & {
    quantity: number;
    lineTotalCents: number;
    lineDurationMinutes: number;
  }>;
  quote: BookingQuote;
};

export function mergeSelectedAddOns(selectedAddOns: SelectedAddOnInput[]): SelectedAddOnInput[] {
  const merged = new Map<string, number>();

  for (const input of selectedAddOns) {
    const existing = merged.get(input.addOnId) ?? 0;
    merged.set(input.addOnId, existing + (input.quantity ?? 1));
  }

  return Array.from(merged.entries()).map(([addOnId, quantity]) => ({ addOnId, quantity }));
}

export function calculateAppointmentPrice(args: {
  basePriceCents: number;
  addOns: Array<{ lineTotalCents: number }>;
}): number {
  return args.basePriceCents + args.addOns.reduce((sum, addOn) => sum + addOn.lineTotalCents, 0);
}

export function calculateAppointmentDuration(args: {
  baseDurationMinutes: number;
  addOns: Array<{ lineDurationMinutes: number }>;
}): number {
  return args.baseDurationMinutes + args.addOns.reduce((sum, addOn) => sum + addOn.lineDurationMinutes, 0);
}

export function getBlockedEndTimeWithBuffer(startTime: Date, blockedDurationMinutes: number): Date {
  return new Date(startTime.getTime() + blockedDurationMinutes * 60 * 1000);
}

export async function getAllowedAddOnsForService(salonId: string, serviceId: string) {
  const { db } = await import('@/libs/DB');
  const rules = await db
    .select()
    .from(serviceAddOnSchema)
    .where(and(eq(serviceAddOnSchema.salonId, salonId), eq(serviceAddOnSchema.serviceId, serviceId)));

  if (rules.length === 0) {
    return [];
  }

  const addOns = await db
    .select()
    .from(addOnSchema)
    .where(
      and(
        eq(addOnSchema.salonId, salonId),
        inArray(addOnSchema.id, rules.map(rule => rule.addOnId)),
        eq(addOnSchema.isActive, true),
      ),
    );

  const addOnsById = new Map(addOns.map(addOn => [addOn.id, addOn]));

  return rules
    .sort((a, b) => (a.displayOrder ?? 0) - (b.displayOrder ?? 0))
    .map((rule) => {
      const addOn = addOnsById.get(rule.addOnId);
      if (!addOn) {
        return null;
      }

      return {
        rule: mapServiceAddOnRule(rule),
        addOn: mapAddOnToCatalogSummary(addOn),
      };
    })
    .filter(Boolean);
}

export function buildBookingQuote(args: {
  baseService: ReturnType<typeof mapServiceToCatalogSummary>;
  addOns: Array<ReturnType<typeof mapAddOnToCatalogSummary> & {
    quantity: number;
  }>;
  bufferMinutes: number;
  resolvedIntroPriceLabel: string | null;
}): BookingQuote {
  const normalizedAddOns = args.addOns.map((addOn) => {
    const quantity = addOn.quantity;
    const lineTotalCents = addOn.priceCents * quantity;
    const lineDurationMinutes = addOn.durationMinutes * quantity;

    return {
      addOnId: addOn.id,
      name: addOn.name,
      category: addOn.category,
      pricingType: addOn.pricingType,
      quantity,
      unitPriceCents: addOn.priceCents,
      lineTotalCents,
      unitDurationMinutes: addOn.durationMinutes,
      lineDurationMinutes,
    };
  });

  const baseDurationMinutes = args.baseService.durationMinutes;
  const addOnsDurationMinutes = normalizedAddOns.reduce((sum, addOn) => sum + addOn.lineDurationMinutes, 0);
  const visibleDurationMinutes = calculateAppointmentDuration({
    baseDurationMinutes,
    addOns: normalizedAddOns,
  });
  const subtotalCents = calculateAppointmentPrice({
    basePriceCents: args.baseService.priceCents,
    addOns: normalizedAddOns,
  });
  const blockedDurationMinutes = visibleDurationMinutes + args.bufferMinutes;

  return {
    baseService: {
      id: args.baseService.id,
      name: args.baseService.name,
      category: args.baseService.category,
      priceCents: args.baseService.priceCents,
      durationMinutes: args.baseService.durationMinutes,
      resolvedIntroPriceLabel: args.resolvedIntroPriceLabel,
    },
    addOns: normalizedAddOns,
    subtotalCents,
    baseDurationMinutes,
    addOnsDurationMinutes,
    visibleDurationMinutes,
    bufferMinutes: args.bufferMinutes,
    blockedDurationMinutes,
  };
}

export async function validatePublicBookingSelection(args: {
  salonId: string;
  selection: PublicBookingSelection;
  technicianId?: string | null;
}): Promise<ValidatedSelectionResult> {
  const { db } = await import('@/libs/DB');
  const selection = publicBookingSelectionSchema.parse(args.selection);
  const normalizedAddOns = mergeSelectedAddOns(selection.selectedAddOns);

  const baseService = await db.query.serviceSchema.findFirst({
    where: (service, { and, eq }) => and(
      eq(service.id, selection.baseServiceId),
      eq(service.salonId, args.salonId),
      eq(service.isActive, true),
    ),
  });

  if (!baseService) {
    throw new Error('INVALID_BASE_SERVICE');
  }

  if (args.technicianId) {
    const technicianAssignment = await db.query.technicianServicesSchema.findFirst({
      where: (assignment, { and, eq }) => and(
        eq(assignment.technicianId, args.technicianId!),
        eq(assignment.serviceId, baseService.id),
        eq(assignment.enabled, true),
      ),
    });

    if (!technicianAssignment) {
      throw new Error('TECHNICIAN_SERVICE_UNSUPPORTED');
    }
  }

  const rules = await db
    .select()
    .from(serviceAddOnSchema)
    .where(and(eq(serviceAddOnSchema.salonId, args.salonId), eq(serviceAddOnSchema.serviceId, baseService.id)));

  const rulesByAddOnId = new Map(rules.map(rule => [rule.addOnId, rule]));

  if (normalizedAddOns.length === 0) {
    const bookingConfig = await getBookingConfigForSalon(args.salonId);
    const serviceSummary = mapServiceToCatalogSummary(baseService);
    const quote = buildBookingQuote({
      baseService: serviceSummary,
      addOns: [],
      bufferMinutes: bookingConfig.bufferMinutes,
      resolvedIntroPriceLabel: resolveIntroPriceLabel({
        isIntroPrice: baseService.isIntroPrice,
        introPriceExpiresAt: baseService.introPriceExpiresAt,
        introPriceLabel: baseService.introPriceLabel,
        bookingConfig,
      }),
    });

    return {
      baseServiceRecord: baseService,
      addOnRecords: [],
      baseService: serviceSummary,
      addOns: [],
      quote,
    };
  }

  const addOnIds = normalizedAddOns.map(addOn => addOn.addOnId);
  const addOns = await db
    .select()
    .from(addOnSchema)
    .where(
      and(
        eq(addOnSchema.salonId, args.salonId),
        eq(addOnSchema.isActive, true),
        inArray(addOnSchema.id, addOnIds),
      ),
    );

  if (addOns.length !== addOnIds.length) {
    throw new Error('INVALID_ADD_ON');
  }

  const addOnsById = new Map(addOns.map(addOn => [addOn.id, addOn]));
  const resolvedAddOns = normalizedAddOns.map((input) => {
    const addOn = addOnsById.get(input.addOnId);
    const rule = rulesByAddOnId.get(input.addOnId);

    if (!addOn || !rule) {
      throw new Error('ADD_ON_NOT_ALLOWED');
    }

    const quantity = input.quantity ?? 1;
    if (addOn.pricingType === 'per_unit') {
      if (!Number.isInteger(quantity) || quantity < 1) {
        throw new Error('INVALID_ADD_ON_QUANTITY');
      }
      const maxQuantity = rule.maxQuantityOverride ?? addOn.maxQuantity ?? 10;
      if (quantity > maxQuantity) {
        throw new Error('INVALID_ADD_ON_QUANTITY');
      }
    } else if (quantity !== 1) {
      throw new Error('FIXED_ADD_ON_QUANTITY_NOT_ALLOWED');
    }

    return {
      ...mapAddOnToCatalogSummary(addOn),
      quantity,
      lineTotalCents: addOn.priceCents * quantity,
      lineDurationMinutes: addOn.durationMinutes * quantity,
    };
  });

  const bookingConfig = await getBookingConfigForSalon(args.salonId);
  const serviceSummary = mapServiceToCatalogSummary(baseService);
  const quote = buildBookingQuote({
    baseService: serviceSummary,
    addOns: resolvedAddOns,
    bufferMinutes: bookingConfig.bufferMinutes,
    resolvedIntroPriceLabel: resolveIntroPriceLabel({
      isIntroPrice: baseService.isIntroPrice,
      introPriceExpiresAt: baseService.introPriceExpiresAt,
      introPriceLabel: baseService.introPriceLabel,
      bookingConfig,
    }),
  });

  return {
    baseServiceRecord: baseService,
    addOnRecords: addOns,
    baseService: serviceSummary,
    addOns: resolvedAddOns,
    quote,
  };
}

export function getBlockedEndTimeForAppointment(appointment: {
  startTime: Date;
  blockedDurationMinutes: number | null;
  totalDurationMinutes: number;
  bufferMinutes?: number | null;
}): Date {
  const blockedDurationMinutes = appointment.blockedDurationMinutes
    ?? (appointment.totalDurationMinutes + (appointment.bufferMinutes ?? 0));
  return getBlockedEndTimeWithBuffer(appointment.startTime, blockedDurationMinutes);
}

export function isSlotBookable(args: {
  startAt: Date;
  blockedDurationMinutes: number;
  technicianSchedule: { start: string; end: string } | null;
  conflicts: Array<{ id: string; startTime: Date; blockedDurationMinutes: number | null; totalDurationMinutes: number; bufferMinutes?: number | null }>;
}): boolean {
  if (!args.technicianSchedule) {
    return false;
  }

  const startMinutes = args.startAt.getHours() * 60 + args.startAt.getMinutes();
  const scheduleStart = args.technicianSchedule.start.split(':').map(Number);
  const scheduleEnd = args.technicianSchedule.end.split(':').map(Number);
  const scheduleStartMinutes = (scheduleStart[0] ?? 0) * 60 + (scheduleStart[1] ?? 0);
  const scheduleEndMinutes = (scheduleEnd[0] ?? 0) * 60 + (scheduleEnd[1] ?? 0);
  const blockedEnd = getBlockedEndTimeWithBuffer(args.startAt, args.blockedDurationMinutes);
  const blockedEndMinutes = blockedEnd.getHours() * 60 + blockedEnd.getMinutes();

  if (startMinutes < scheduleStartMinutes || blockedEndMinutes > scheduleEndMinutes) {
    return false;
  }

  return !args.conflicts.some((conflict) => {
    const conflictStart = conflict.startTime;
    const conflictEnd = getBlockedEndTimeForAppointment(conflict);
    return args.startAt < conflictEnd && blockedEnd > conflictStart;
  });
}
