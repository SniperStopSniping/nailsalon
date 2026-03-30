import 'server-only';

import { and, eq, inArray, isNull, ne, or } from 'drizzle-orm';

import { getBookingConfigForSalon } from '@/libs/bookingConfig';
import { db } from '@/libs/DB';
import { getSalonClientByPhone } from '@/libs/queries';
import { normalizePhone } from '@/libs/phone';
import { appointmentSchema, rewardSchema, type Service } from '@/models/Schema';

export const FIRST_VISIT_DISCOUNT_TYPE = 'first_visit_25';
export const FIRST_VISIT_DISCOUNT_LABEL = 'First visit discount';
export const FIRST_VISIT_DISCOUNT_PERCENT = 25;
const ACTIVE_RESERVATION_STATUSES: string[] = ['pending', 'confirmed', 'in_progress'];
const QUALIFYING_VISIT_STATUSES: string[] = ['completed'];

export type FirstVisitDiscountEligibility = {
  enabled: boolean;
  eligible: boolean;
};

export type FirstVisitDiscountSnapshot = {
  subtotalBeforeDiscountCents: number;
  discountAmountCents: number;
  discountType: typeof FIRST_VISIT_DISCOUNT_TYPE;
  discountLabel: typeof FIRST_VISIT_DISCOUNT_LABEL;
  discountPercent: typeof FIRST_VISIT_DISCOUNT_PERCENT;
  discountAppliedAt: Date;
  finalTotalCents: number;
};

export type AutomaticBookingDiscountResult =
  | {
      kind: 'none';
      subtotalBeforeDiscountCents: number;
      discountAmountCents: 0;
      finalTotalCents: number;
      reward: null;
      firstVisit: null;
    }
  | {
      kind: 'reward';
      subtotalBeforeDiscountCents: number;
      discountAmountCents: number;
      finalTotalCents: number;
      reward: {
        id: string;
        discountAmountCents: number;
        discountedServiceId: string | null;
      };
      firstVisit: null;
    }
  | {
      kind: 'first_visit';
      subtotalBeforeDiscountCents: number;
      discountAmountCents: number;
      finalTotalCents: number;
      reward: null;
      firstVisit: FirstVisitDiscountSnapshot;
    };

function pointsToDiscountCents(points: number): number {
  return Math.floor(points / 5);
}

function buildClientPhoneVariants(phone: string | null | undefined): string[] {
  const normalized = normalizePhone(phone ?? '');
  if (!normalized) {
    return [];
  }

  return Array.from(new Set([
    normalized,
    `+1${normalized}`,
    `+${normalized}`,
  ]));
}

function buildFirstVisitDiscountSnapshot(args: {
  subtotalBeforeDiscountCents: number;
  appliedAt?: Date;
}): FirstVisitDiscountSnapshot {
  const appliedAt = args.appliedAt ?? new Date();
  const discountAmountCents = Math.floor(
    args.subtotalBeforeDiscountCents * (FIRST_VISIT_DISCOUNT_PERCENT / 100),
  );

  return {
    subtotalBeforeDiscountCents: args.subtotalBeforeDiscountCents,
    discountAmountCents,
    discountType: FIRST_VISIT_DISCOUNT_TYPE,
    discountLabel: FIRST_VISIT_DISCOUNT_LABEL,
    discountPercent: FIRST_VISIT_DISCOUNT_PERCENT,
    discountAppliedAt: appliedAt,
    finalTotalCents: Math.max(0, args.subtotalBeforeDiscountCents - discountAmountCents),
  };
}

function buildClientIdentityCondition(args: {
  salonClientId?: string | null;
  phoneVariants: string[];
}) {
  const conditions = [];

  if (args.salonClientId) {
    conditions.push(eq(appointmentSchema.salonClientId, args.salonClientId));
  }

  if (args.phoneVariants.length > 0) {
    conditions.push(inArray(appointmentSchema.clientPhone, args.phoneVariants));
  }

  if (conditions.length === 0) {
    return null;
  }

  if (conditions.length === 1) {
    return conditions[0]!;
  }

  return or(...conditions);
}

async function resolveFirstVisitDiscountEligibility(args: {
  salonId: string;
  clientPhone?: string | null;
  salonClientId?: string | null;
  originalAppointmentId?: string | null;
}): Promise<FirstVisitDiscountEligibility> {
  const bookingConfig = await getBookingConfigForSalon(args.salonId);
  if (!bookingConfig.firstVisitDiscountEnabled) {
    return {
      enabled: false,
      eligible: false,
    };
  }

  const phoneVariants = buildClientPhoneVariants(args.clientPhone);
  const resolvedSalonClientId = args.salonClientId
    ?? (phoneVariants.length > 0
      ? (await getSalonClientByPhone(args.salonId, phoneVariants[0]!))?.id ?? null
      : null);

  const clientIdentityCondition = buildClientIdentityCondition({
    salonClientId: resolvedSalonClientId,
    phoneVariants,
  });

  if (!clientIdentityCondition) {
    return {
      enabled: true,
      eligible: false,
    };
  }

  const completedVisitConditions = [
    eq(appointmentSchema.salonId, args.salonId),
    clientIdentityCondition,
    inArray(appointmentSchema.status, QUALIFYING_VISIT_STATUSES),
    eq(appointmentSchema.paymentStatus, 'paid'),
  ];

  if (args.originalAppointmentId) {
    completedVisitConditions.push(ne(appointmentSchema.id, args.originalAppointmentId));
  }

  const completedVisit = await db
    .select({ id: appointmentSchema.id })
    .from(appointmentSchema)
    .where(and(...completedVisitConditions))
    .limit(1);

  if (completedVisit.length > 0) {
    return {
      enabled: true,
      eligible: false,
    };
  }

  const activeReservationConditions = [
    eq(appointmentSchema.salonId, args.salonId),
    clientIdentityCondition,
    eq(appointmentSchema.discountType, FIRST_VISIT_DISCOUNT_TYPE),
    inArray(appointmentSchema.status, ACTIVE_RESERVATION_STATUSES),
  ];

  if (args.originalAppointmentId) {
    activeReservationConditions.push(ne(appointmentSchema.id, args.originalAppointmentId));
  }

  const activeReservation = await db
    .select({ id: appointmentSchema.id })
    .from(appointmentSchema)
    .where(and(...activeReservationConditions))
    .limit(1);

  return {
    enabled: true,
    eligible: activeReservation.length === 0,
  };
}

export async function isClientEligibleForFirstVisitDiscount(args: {
  salonId: string;
  clientPhone?: string | null;
  salonClientId?: string | null;
  originalAppointmentId?: string | null;
}): Promise<boolean> {
  const result = await resolveFirstVisitDiscountEligibility(args);
  return result.eligible;
}

export async function resolveAutomaticBookingDiscount(args: {
  salonId: string;
  services: Array<Pick<Service, 'id' | 'name' | 'price'>>;
  subtotalBeforeDiscountCents: number;
  clientPhone?: string | null;
  salonClientId?: string | null;
  originalAppointmentId?: string | null;
  preserveFirstVisitDiscount?: boolean;
  now?: Date;
}): Promise<AutomaticBookingDiscountResult> {
  const now = args.now ?? new Date();

  if (args.subtotalBeforeDiscountCents <= 0) {
    return {
      kind: 'none',
      subtotalBeforeDiscountCents: args.subtotalBeforeDiscountCents,
      discountAmountCents: 0,
      finalTotalCents: args.subtotalBeforeDiscountCents,
      reward: null,
      firstVisit: null,
    };
  }

  if (args.preserveFirstVisitDiscount) {
    const firstVisit = buildFirstVisitDiscountSnapshot({
      subtotalBeforeDiscountCents: args.subtotalBeforeDiscountCents,
      appliedAt: now,
    });

    return {
      kind: 'first_visit',
      subtotalBeforeDiscountCents: args.subtotalBeforeDiscountCents,
      discountAmountCents: firstVisit.discountAmountCents,
      finalTotalCents: firstVisit.finalTotalCents,
      reward: null,
      firstVisit,
    };
  }

  const phoneVariants = buildClientPhoneVariants(args.clientPhone);
  if (phoneVariants.length > 0) {
    const activeRewards = await db
      .select()
      .from(rewardSchema)
      .where(
        and(
          eq(rewardSchema.salonId, args.salonId),
          inArray(rewardSchema.clientPhone, phoneVariants),
          eq(rewardSchema.status, 'active'),
          isNull(rewardSchema.usedInAppointmentId),
        ),
      );

    for (const reward of activeRewards) {
      if (reward.expiresAt && reward.expiresAt.getTime() < now.getTime()) {
        continue;
      }

      const eligibleServiceName = reward.eligibleServiceName?.toLowerCase() || 'gel manicure';
      const matchingService = args.services.find(
        service => service.name.toLowerCase().includes(eligibleServiceName)
          || eligibleServiceName.includes(service.name.toLowerCase()),
      );

      const discountAmountCents = matchingService
        ? matchingService.price
        : Math.min(pointsToDiscountCents(reward.points), args.subtotalBeforeDiscountCents);

      if (discountAmountCents <= 0) {
        continue;
      }

      return {
        kind: 'reward',
        subtotalBeforeDiscountCents: args.subtotalBeforeDiscountCents,
        discountAmountCents,
        finalTotalCents: Math.max(0, args.subtotalBeforeDiscountCents - discountAmountCents),
        reward: {
          id: reward.id,
          discountAmountCents,
          discountedServiceId: matchingService?.id ?? null,
        },
        firstVisit: null,
      };
    }
  }

  const eligibility = await resolveFirstVisitDiscountEligibility({
    salonId: args.salonId,
    clientPhone: args.clientPhone ?? null,
    salonClientId: args.salonClientId ?? null,
    originalAppointmentId: args.originalAppointmentId ?? null,
  });

  if (!eligibility.enabled || !eligibility.eligible) {
    return {
      kind: 'none',
      subtotalBeforeDiscountCents: args.subtotalBeforeDiscountCents,
      discountAmountCents: 0,
      finalTotalCents: args.subtotalBeforeDiscountCents,
      reward: null,
      firstVisit: null,
    };
  }

  const firstVisit = buildFirstVisitDiscountSnapshot({
    subtotalBeforeDiscountCents: args.subtotalBeforeDiscountCents,
    appliedAt: now,
  });

  return {
    kind: 'first_visit',
    subtotalBeforeDiscountCents: args.subtotalBeforeDiscountCents,
    discountAmountCents: firstVisit.discountAmountCents,
    finalTotalCents: firstVisit.finalTotalCents,
    reward: null,
    firstVisit,
  };
}
