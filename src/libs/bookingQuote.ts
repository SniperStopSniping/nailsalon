import { and, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';

import { mapAddOnToCatalogSummary, mapServiceAddOnRule, mapServiceToCatalogSummary } from '@/libs/bookingCatalog';
import { getBookingConfigForSalon, resolveIntroPriceLabel } from '@/libs/bookingConfig';
import type { BookingDiscountReadContext } from '@/libs/firstVisitDiscount';
import {
  getPublicTechnicianCompatibility as resolveSharedPublicTechnicianCompatibility,
  type PublicRequestedService,
  type PublicTechnicianPreview,
} from '@/libs/publicTechnicianCompatibility';
import {
  type AddOn,
  type AddOnCategory,
  type AddOnPricingType,
  addOnSchema,
  type Service,
  serviceAddOnSchema,
  type ServiceCategory,
  serviceSchema,
  technicianSchema,
  technicianServicesSchema,
} from '@/models/Schema';

export type BookingSelectionErrorCode
  = | 'invalid_service'
  | 'unsupported_technician'
  | 'invalid_add_on'
  | 'missing_required_add_on';

export class BookingSelectionError extends Error {
  /**
   * `missingRequiredAddOnIds` is only populated for the
   * `missing_required_add_on` code, so a caller that blocks a booking can log
   * which required add-ons were missing without re-running the evaluation.
   * Add-on ids only — never client data.
   */
  constructor(
    public readonly code: BookingSelectionErrorCode,
    public readonly missingRequiredAddOnIds: string[] = [],
  ) {
    super(code);
    this.name = 'BookingSelectionError';
  }
}

export function getPublicBookingSelectionMessage(error: BookingSelectionError): string {
  if (error.code === 'unsupported_technician') {
    return 'This service is not available with the selected technician. Please choose another technician.';
  }
  if (error.code === 'invalid_add_on') {
    return 'One of the selected add-ons is no longer available. Please review your services.';
  }
  if (error.code === 'missing_required_add_on') {
    return 'This service requires an additional add-on before it can be booked online. Please review the required add-ons for this service.';
  }
  return 'This service is no longer available for online booking. Please choose another service.';
}

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

export type PublicTechnicianCompatibility =
  | { bookable: true; reason: null }
  | { bookable: false; reason: 'service_unsupported' };

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

export type BookingSelectionReadContext = BookingDiscountReadContext;

function assertReadContextSalon(salonId: string, readContext?: BookingSelectionReadContext): void {
  if (readContext && readContext.salonId !== salonId) {
    throw new Error('BOOKING_READ_CONTEXT_SALON_MISMATCH');
  }
}

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
  /**
   * Required service_add_on rows (selectionMode: 'required') this selection
   * did not satisfy.
   *
   * Only ever non-empty when the salon has NOT enabled
   * settings.booking.enforceRequiredAddOns (the default): with the gate off the
   * gap is observed and the booking proceeds, and with the gate on the same gap
   * throws `missing_required_add_on` instead of returning. Observation
   * therefore keeps working exactly as before for every salon that has not
   * opted in.
   */
  observedRequiredAddOnGaps: string[];
  l1?: { confirmationMode: 'instant' | 'request_approval' | 'consultation' | null; fingerprint: string; eligibleTechnicianIds: string[]; requestedSelection: PublicBookingSelection };

};

export function mergeSelectedAddOns(selectedAddOns: SelectedAddOnInput[]): SelectedAddOnInput[] {
  const merged = new Map<string, number>();

  for (const input of selectedAddOns) {
    const existing = merged.get(input.addOnId) ?? 0;
    merged.set(input.addOnId, existing + (input.quantity ?? 1));
  }

  return Array.from(merged.entries()).map(([addOnId, quantity]) => ({ addOnId, quantity }));
}

export type RequiredAddOnRuleInput = {
  addOnId: string;
  selectionMode: 'optional' | 'required' | 'conditional';
};

export type RequiredAddOnEvaluation = {
  satisfied: boolean;
  missingRequiredAddOnIds: string[];
};

/**
 * Pure check of whether a selection covers every `required` service_add_on
 * rule for the service being booked. `conditional` rules have no evaluator
 * yet (§11 gap 11 of the UI/UX plan) and are treated as satisfied — this
 * function only ever reports the unconditional `required` case.
 *
 * This function itself never throws. Whether an unsatisfied result blocks the
 * booking is decided by the caller: see assertRequiredAddOnsSatisfied, which
 * only blocks for a salon that has opted in via
 * settings.booking.enforceRequiredAddOns (default false).
 */
export function evaluateRequiredAddOnRules(args: {
  rules: RequiredAddOnRuleInput[];
  selectedAddOnIds: string[];
}): RequiredAddOnEvaluation {
  const selected = new Set(args.selectedAddOnIds);
  const missingRequiredAddOnIds = args.rules
    .filter(rule => rule.selectionMode === 'required' && !selected.has(rule.addOnId))
    .map(rule => rule.addOnId);

  return {
    satisfied: missingRequiredAddOnIds.length === 0,
    missingRequiredAddOnIds,
  };
}

/**
 * Stage (e) of the required-add-on rollout: turn an unsatisfied required rule
 * into a blocked booking — but only for a salon that has explicitly opted in
 * via settings.booking.enforceRequiredAddOns.
 *
 * The gate is default-off for every salon (see DEFAULT_BOOKING_CONFIG), because
 * the plan only allows hard enforcement "after observation shows existing flows
 * are compatible" and no observation data exists yet. With the gate off this is
 * a no-op and the selection stays observation-only.
 *
 * Deliberate, documented consequence when the gate is ON: a required rule that
 * points at a deactivated add-on cannot be satisfied by any client, because
 * validatePublicBookingSelection refuses inactive add-ons with
 * `invalid_add_on`. Such a service becomes unbookable online (blocked either
 * way) until the owner reactivates the add-on or drops the rule. This is the
 * exact condition `npm run db:report:required-addon-rules` exists to surface,
 * and it is why the gate must stay off until a salon's inventory is clean.
 */
function assertRequiredAddOnsSatisfied(args: {
  enforceRequiredAddOns: boolean;
  evaluation: RequiredAddOnEvaluation;
}): void {
  if (!args.enforceRequiredAddOns || args.evaluation.satisfied) {
    return;
  }

  throw new BookingSelectionError('missing_required_add_on', args.evaluation.missingRequiredAddOnIds);
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

export function getPublicTechnicianCompatibility(args: {
  selectionMode: 'base-service' | 'legacy';
  technician: Pick<PublicTechnicianPreview, 'enabledServiceIds' | 'serviceIds' | 'specialties'>;
  requestedServices: PublicRequestedService[];
}): PublicTechnicianCompatibility {
  return resolveSharedPublicTechnicianCompatibility(args);
}

export async function getAllowedAddOnsForService(salonId: string, serviceId: string, readContext?: BookingSelectionReadContext) {
  assertReadContextSalon(salonId, readContext);
  const database = readContext?.database ?? (await import('@/libs/DB')).db;
  const rules = await database
    .select()
    .from(serviceAddOnSchema)
    .where(and(eq(serviceAddOnSchema.salonId, salonId), eq(serviceAddOnSchema.serviceId, serviceId)));

  if (rules.length === 0) {
    return [];
  }

  const addOns = await database
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
  readContext?: BookingSelectionReadContext;
}): Promise<ValidatedSelectionResult> {
  assertReadContextSalon(args.salonId, args.readContext);
  const database = args.readContext?.database ?? (await import('@/libs/DB')).db;
  const parsedSelection = publicBookingSelectionSchema.safeParse(args.selection);
  if (!parsedSelection.success) {
    throw new BookingSelectionError('invalid_service');
  }
  const selection = parsedSelection.data;
  const normalizedAddOns = mergeSelectedAddOns(selection.selectedAddOns);

  const baseService = args.readContext
    ? (await database.select().from(serviceSchema).where(and(eq(serviceSchema.id, selection.baseServiceId), eq(serviceSchema.salonId, args.salonId), eq(serviceSchema.isActive, true))).limit(1))[0]
    : await (await import('@/libs/DB')).db.query.serviceSchema.findFirst({
      where: (service, { and, eq }) => and(
        eq(service.id, selection.baseServiceId),
        eq(service.salonId, args.salonId),
        eq(service.isActive, true),
      ),
    });

  if (!baseService) {
    throw new BookingSelectionError('invalid_service');
  }

  if (args.technicianId) {
    const technician = args.readContext
      ? (await database.select().from(technicianSchema).where(and(eq(technicianSchema.id, args.technicianId), eq(technicianSchema.salonId, args.salonId), eq(technicianSchema.isActive, true))).limit(1))[0]
      : await (await import('@/libs/DB')).db.query.technicianSchema.findFirst({
        where: (technician, { and, eq }) => and(
          eq(technician.id, args.technicianId!),
          eq(technician.salonId, args.salonId),
          eq(technician.isActive, true),
        ),
      });

    if (!technician) {
      throw new BookingSelectionError('unsupported_technician');
    }

    const enabledAssignments = await database
      .select({ serviceId: technicianServicesSchema.serviceId })
      .from(technicianServicesSchema)
      .where(
        and(
          eq(technicianServicesSchema.technicianId, args.technicianId),
          inArray(technicianServicesSchema.serviceId, [baseService.id]),
          eq(technicianServicesSchema.enabled, true),
        ),
      );

    const compatibility = getPublicTechnicianCompatibility({
      selectionMode: 'base-service',
      technician: {
        enabledServiceIds: enabledAssignments.map(assignment => assignment.serviceId),
        serviceIds: enabledAssignments.map(assignment => assignment.serviceId),
        specialties: [],
      },
      requestedServices: [baseService],
    });

    if (!compatibility.bookable) {
      throw new BookingSelectionError('unsupported_technician');
    }
  }

  const { resolveL1BookingAuthority, L1BookingAuthorityError } = await import('@/libs/l1BookingAuthority.server');
  const l1 = await resolveL1BookingAuthority({
    salonId: args.salonId,
    selection: { serviceId: selection.baseServiceId, selectedAddOns: selection.selectedAddOns, technicianId: args.technicianId },
    readContext: args.readContext,
  }).catch((error: unknown) => {
    if (error instanceof L1BookingAuthorityError && error.code !== 'unavailable') {
      throw new BookingSelectionError(error.code === 'unsupported_technician' ? 'unsupported_technician' : 'invalid_add_on');
    }
    throw error;
  });
  if (l1) {
    const config = args.readContext?.bookingConfig ?? await getBookingConfigForSalon(args.salonId);
    const ids = l1.resolution.addOns.map(line => line.addOnId);
    const records = ids.length
      ? await database.select().from(addOnSchema).where(and(
        eq(addOnSchema.salonId, args.salonId),
        eq(addOnSchema.isActive, true),
        inArray(addOnSchema.id, ids),
      ))
      : [];
    if (records.length !== ids.length) {
      throw new BookingSelectionError('invalid_add_on');
    }
    // Review and transaction comparisons use the resolver's canonical order.
    records.sort((left, right) => ids.indexOf(left.id) - ids.indexOf(right.id));
    const { resolveCatalogBindingSourceRows } = await import('@/libs/catalogResolverCore');
    const parentId = l1.snapshot.services.find(service => service.id === baseService.id)?.parentServiceId;
    const rawRules = await database.select().from(serviceAddOnSchema).where(and(
      eq(serviceAddOnSchema.salonId, args.salonId),
      inArray(serviceAddOnSchema.serviceId, parentId ? [baseService.id, parentId] : [baseService.id]),
    ));
    const requiredAddOnEvaluation = evaluateRequiredAddOnRules({
      rules: resolveCatalogBindingSourceRows(rawRules.filter(rule => rule.serviceId === baseService.id), parentId ? rawRules.filter(rule => rule.serviceId === parentId) : []),
      selectedAddOnIds: ids,
    });
    assertRequiredAddOnsSatisfied({ enforceRequiredAddOns: config.enforceRequiredAddOns, evaluation: requiredAddOnEvaluation });
    const bufferMinutes = Math.max(config.bufferMinutes, baseService.preparationBufferMinutes + baseService.cleanupBufferMinutes);
    const summary = mapServiceToCatalogSummary(baseService);
    const lines = l1.resolution.addOns.map((line) => {
      const record = records.find(item => item.id === line.addOnId)!;
      return { addOnId: line.addOnId, name: record.name, category: record.category, pricingType: record.pricingType, quantity: line.quantity, unitPriceCents: line.unitPriceCents, lineTotalCents: line.lineTotalCents, unitDurationMinutes: line.unitDurationMinutes, lineDurationMinutes: line.lineDurationMinutes };
    });
    return {
      baseServiceRecord: baseService,
      addOnRecords: records,
      baseService: summary,
      addOns: records.map((record) => {
        const line = l1.resolution.addOns.find(item => item.addOnId === record.id)!;
        return { ...mapAddOnToCatalogSummary(record), quantity: line.quantity, lineTotalCents: line.lineTotalCents, lineDurationMinutes: line.lineDurationMinutes };
      }),
      quote: {
        baseService: { id: baseService.id, name: baseService.name, category: baseService.category, priceCents: l1.resolution.basePriceCents, durationMinutes: l1.resolution.baseDurationMinutes, resolvedIntroPriceLabel: resolveIntroPriceLabel({ ...baseService, bookingConfig: config }) },
        addOns: lines,
        subtotalCents: l1.resolution.subtotalCents,
        baseDurationMinutes: l1.resolution.baseDurationMinutes,
        addOnsDurationMinutes: l1.resolution.totalDurationMinutes - l1.resolution.baseDurationMinutes,
        visibleDurationMinutes: l1.resolution.totalDurationMinutes,
        bufferMinutes,
        blockedDurationMinutes: l1.resolution.totalDurationMinutes + bufferMinutes,
      },
      observedRequiredAddOnGaps: requiredAddOnEvaluation.missingRequiredAddOnIds,
      l1: { confirmationMode: l1.snapshot.services.find(service => service.id === baseService.id)?.explicitConfirmationMode ?? null, fingerprint: l1.fingerprint, eligibleTechnicianIds: l1.eligibleTechnicianIds, requestedSelection: selection },
    };
  }

  const rules = await database
    .select()
    .from(serviceAddOnSchema)
    .where(and(eq(serviceAddOnSchema.salonId, args.salonId), eq(serviceAddOnSchema.serviceId, baseService.id)));

  const rulesByAddOnId = new Map(rules.map(rule => [rule.addOnId, rule]));

  // Computed against the full rule set before the zero-add-on early return
  // below, which is exactly the path that used to skip `rules` entirely and is
  // most likely to hide a missing required add-on. evaluateRequiredAddOnRules
  // never throws; it is reported as observedRequiredAddOnGaps on every path,
  // and is additionally enforced below on both paths when the salon has opted
  // in (assertRequiredAddOnsSatisfied).
  const requiredAddOnEvaluation = evaluateRequiredAddOnRules({
    rules,
    selectedAddOnIds: normalizedAddOns.map(addOn => addOn.addOnId),
  });

  if (normalizedAddOns.length === 0) {
    const bookingConfig = args.readContext?.bookingConfig ?? await getBookingConfigForSalon(args.salonId);

    // Enforcement on the zero-add-on path. This is the path that matters most:
    // before stage (b) it never looked at `rules` at all, so it is where a
    // missing required add-on hides. The gate rides on the
    // getBookingConfigForSalon call this path already makes — no extra query.
    assertRequiredAddOnsSatisfied({
      enforceRequiredAddOns: bookingConfig.enforceRequiredAddOns,
      evaluation: requiredAddOnEvaluation,
    });

    const serviceSummary = mapServiceToCatalogSummary(baseService);
    const quote = buildBookingQuote({
      baseService: serviceSummary,
      addOns: [],
      bufferMinutes: Math.max(
        bookingConfig.bufferMinutes,
        baseService.preparationBufferMinutes + baseService.cleanupBufferMinutes,
      ),
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
      observedRequiredAddOnGaps: requiredAddOnEvaluation.missingRequiredAddOnIds,
    };
  }

  const addOnIds = normalizedAddOns.map(addOn => addOn.addOnId);
  const addOns = await database
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
    throw new BookingSelectionError('invalid_add_on');
  }

  const addOnsById = new Map(addOns.map(addOn => [addOn.id, addOn]));
  const resolvedAddOns = normalizedAddOns.map((input) => {
    const addOn = addOnsById.get(input.addOnId);
    const rule = rulesByAddOnId.get(input.addOnId);

    if (!addOn || !rule) {
      throw new BookingSelectionError('invalid_add_on');
    }

    const quantity = input.quantity ?? 1;
    if (addOn.pricingType === 'per_unit') {
      if (!Number.isInteger(quantity) || quantity < 1) {
        throw new BookingSelectionError('invalid_add_on');
      }
      const maxQuantity = rule.maxQuantityOverride ?? addOn.maxQuantity ?? 10;
      if (quantity > maxQuantity) {
        throw new BookingSelectionError('invalid_add_on');
      }
    } else if (quantity !== 1) {
      throw new BookingSelectionError('invalid_add_on');
    }

    return {
      ...mapAddOnToCatalogSummary(addOn),
      quantity,
      lineTotalCents: addOn.priceCents * quantity,
      lineDurationMinutes: addOn.durationMinutes * quantity,
    };
  });

  const bookingConfig = args.readContext?.bookingConfig ?? await getBookingConfigForSalon(args.salonId);

  // Enforcement on the populated-add-on path: selecting some other add-on must
  // not satisfy a required rule. Runs after the per-add-on validation above so
  // an add-on that is itself invalid still reports `invalid_add_on`, and reuses
  // the same getBookingConfigForSalon call this path already makes.
  assertRequiredAddOnsSatisfied({
    enforceRequiredAddOns: bookingConfig.enforceRequiredAddOns,
    evaluation: requiredAddOnEvaluation,
  });

  const serviceSummary = mapServiceToCatalogSummary(baseService);
  const quote = buildBookingQuote({
    baseService: serviceSummary,
    addOns: resolvedAddOns,
    bufferMinutes: Math.max(
      bookingConfig.bufferMinutes,
      baseService.preparationBufferMinutes + baseService.cleanupBufferMinutes,
    ),
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
    observedRequiredAddOnGaps: requiredAddOnEvaluation.missingRequiredAddOnIds,
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
