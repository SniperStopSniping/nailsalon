import { z } from 'zod';

import {
  CLIENT_COMMUNICATION_KINDS,
  CLIENT_COMMUNICATION_STATUSES,
  type ClientCommunicationKind,
  type ClientCommunicationStatus,
  REMINDER_SNOOZE_HOURS,
  RETENTION_SNOOZE_DAYS,
  type RetentionPromotionSettings,
  type RetentionSettings,
  type RetentionStage,
} from '@/types/retention';

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;

export const DEFAULT_SNOOZE_DAYS = RETENTION_SNOOZE_DAYS;

export const DEFAULT_SIX_WEEK_PROMOTION: RetentionPromotionSettings = {
  enabled: false,
  name: 'We miss you',
  discountType: 'percent',
  value: 0,
  eligibleServiceIds: [],
  expiryDays: 14,
  code: null,
  messageTemplate: 'Hi {firstName}, we miss you at {salonName}! Enjoy {offer} when you book by {expiry}: {bookingLink}',
  singleUse: true,
};

export const DEFAULT_EIGHT_WEEK_PROMOTION: RetentionPromotionSettings = {
  enabled: false,
  name: 'Come back soon',
  discountType: 'percent',
  value: 0,
  eligibleServiceIds: [],
  expiryDays: 14,
  code: null,
  messageTemplate: 'Hi {firstName}, we would love to see you again at {salonName}. Enjoy {offer} when you book by {expiry}: {bookingLink}',
  singleUse: true,
};

export const DEFAULT_RETENTION_SETTINGS: RetentionSettings = {
  defaultRebookDays: 21,
  reminderLeadHours: 24,
  googleReviewUrl: null,
  parkingInstructions: null,
  sixWeekPromotion: DEFAULT_SIX_WEEK_PROMOTION,
  eightWeekPromotion: DEFAULT_EIGHT_WEEK_PROMOTION,
};

const httpsUrlSchema = z.string().trim().url().max(2000).refine((value) => {
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
}, 'A secure HTTPS URL is required');

export const retentionPromotionSchema = z.object({
  enabled: z.boolean(),
  name: z.string().trim().min(1).max(100),
  discountType: z.enum(['percent', 'fixed']),
  value: z.number().int().min(0).max(1_000_000),
  eligibleServiceIds: z.array(z.string().trim().min(1).max(200)).max(200),
  expiryDays: z.number().int().min(1).max(365),
  code: z.string().trim().min(1).max(40).regex(/^[\w-]+$/).nullable(),
  messageTemplate: z.string().trim().min(1).max(1000),
  singleUse: z.boolean(),
}).superRefine((promotion, context) => {
  if (promotion.discountType === 'percent' && promotion.value > 100) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['value'],
      message: 'Percentage discounts cannot exceed 100',
    });
  }
  if (promotion.enabled && promotion.value <= 0) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['value'],
      message: 'Enabled promotions require a discount greater than zero',
    });
  }
  if (promotion.enabled && !promotion.messageTemplate.includes('{bookingLink}')) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['messageTemplate'],
      message: 'Enabled promotion templates must contain {bookingLink}',
    });
  }
  if (new Set(promotion.eligibleServiceIds).size !== promotion.eligibleServiceIds.length) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['eligibleServiceIds'],
      message: 'Eligible services cannot contain duplicates',
    });
  }
});

export const retentionSettingsSchema = z.object({
  defaultRebookDays: z.number().int().min(1).max(365),
  reminderLeadHours: z.number().int().min(1).max(168),
  googleReviewUrl: httpsUrlSchema.nullable(),
  parkingInstructions: z.string().trim().max(2000).nullable(),
  sixWeekPromotion: retentionPromotionSchema,
  eightWeekPromotion: retentionPromotionSchema,
}).superRefine((settings, context) => {
  const sixWeek = settings.sixWeekPromotion;
  const eightWeek = settings.eightWeekPromotion;
  if (
    sixWeek.enabled
    && eightWeek.enabled
    && sixWeek.discountType !== eightWeek.discountType
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['eightWeekPromotion', 'discountType'],
      message: 'Enabled six- and eight-week offers must use the same discount type',
    });
  }
  if (
    sixWeek.enabled
    && eightWeek.enabled
    && sixWeek.discountType === eightWeek.discountType
    && eightWeek.value < sixWeek.value
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['eightWeekPromotion', 'value'],
      message: 'The eight-week offer must be at least as strong as the six-week offer',
    });
  }
});

const promotionPatchSchema = z.object({
  enabled: z.boolean().optional(),
  name: z.string().trim().min(1).max(100).optional(),
  discountType: z.enum(['percent', 'fixed']).optional(),
  value: z.number().int().min(0).max(1_000_000).optional(),
  eligibleServiceIds: z.array(z.string().trim().min(1).max(200)).max(200).optional(),
  expiryDays: z.number().int().min(1).max(365).optional(),
  code: z.string().trim().min(1).max(40).regex(/^[\w-]+$/).nullable().optional(),
  messageTemplate: z.string().trim().min(1).max(1000).optional(),
  singleUse: z.boolean().optional(),
}).strict();

export const retentionSettingsPatchSchema = z.object({
  defaultRebookDays: z.number().int().min(1).max(365).optional(),
  reminderLeadHours: z.number().int().min(1).max(168).optional(),
  googleReviewUrl: httpsUrlSchema.nullable().optional(),
  parkingInstructions: z.string().trim().max(2000).nullable().optional(),
  sixWeekPromotion: promotionPatchSchema.optional(),
  eightWeekPromotion: promotionPatchSchema.optional(),
}).strict().refine(value => Object.keys(value).length > 0, 'At least one setting is required');

export const communicationMutationSchema = z.object({
  salonSlug: z.string().trim().min(1).max(200),
  clientId: z.string().trim().min(1).max(200),
  appointmentId: z.string().trim().min(1).max(200).optional(),
  kind: z.enum(CLIENT_COMMUNICATION_KINDS),
  status: z.enum(CLIENT_COMMUNICATION_STATUSES),
  messageSnapshot: z.string().max(5000).optional().nullable(),
  snoozeDays: z.literal(RETENTION_SNOOZE_DAYS).optional(),
  snoozeHours: z.literal(REMINDER_SNOOZE_HOURS).optional(),
}).superRefine((value, context) => {
  if (value.kind === 'reminder' && !value.appointmentId) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['appointmentId'],
      message: 'Appointment reminders require an appointment',
    });
  }
  if (
    value.status !== 'snoozed'
    && (value.snoozeDays !== undefined || value.snoozeHours !== undefined)
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: [value.snoozeHours !== undefined ? 'snoozeHours' : 'snoozeDays'],
      message: 'A snooze duration is only valid for snoozed communications',
    });
  }
  if (value.kind === 'reminder' && value.snoozeDays !== undefined) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['snoozeDays'],
      message: 'Appointment reminders use the reminder snooze window',
    });
  }
  if (value.kind !== 'reminder' && value.snoozeHours !== undefined) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['snoozeHours'],
      message: 'snoozeHours is only valid for appointment reminders',
    });
  }
});

export function mergeRetentionSettings(
  current: Partial<RetentionSettings> | null | undefined,
  patch: z.infer<typeof retentionSettingsPatchSchema>,
): RetentionSettings {
  return retentionSettingsSchema.parse({
    ...DEFAULT_RETENTION_SETTINGS,
    ...current,
    ...patch,
    sixWeekPromotion: {
      ...DEFAULT_SIX_WEEK_PROMOTION,
      ...current?.sixWeekPromotion,
      ...patch.sixWeekPromotion,
    },
    eightWeekPromotion: {
      ...DEFAULT_EIGHT_WEEK_PROMOTION,
      ...current?.eightWeekPromotion,
      ...patch.eightWeekPromotion,
    },
  });
}

export function resolveRetentionSettings(
  current: Partial<RetentionSettings> | null | undefined,
): RetentionSettings {
  return retentionSettingsSchema.parse({
    ...DEFAULT_RETENTION_SETTINGS,
    ...current,
    sixWeekPromotion: {
      ...DEFAULT_SIX_WEEK_PROMOTION,
      ...current?.sixWeekPromotion,
    },
    eightWeekPromotion: {
      ...DEFAULT_EIGHT_WEEK_PROMOTION,
      ...current?.eightWeekPromotion,
    },
  });
}

export type RetentionClientSnapshot = {
  id: string;
  fullName: string | null;
  phone: string;
  lastVisitAt: Date | null;
  rebookIntervalDays: number | null;
  isBlocked: boolean | null;
};

export type RetentionAppointmentSnapshot = {
  id: string;
  salonClientId: string | null;
  clientName: string | null;
  clientPhone: string;
  startTime: Date;
  endTime: Date;
  status: string;
  reminderSentAt?: Date | null;
};

export type CommunicationSnapshot = {
  id: string;
  salonClientId: string;
  appointmentId: string | null;
  kind: ClientCommunicationKind;
  status: ClientCommunicationStatus;
  snoozedUntil: Date | null;
  createdAt: Date;
};

export type RetentionQueueItem = {
  clientId: string;
  clientName: string | null;
  phone: string;
  stage: RetentionStage;
  dueAt: Date;
  lastVisitAt: Date;
  rebookIntervalDays: number;
};

export type AppointmentReminderQueueItem = {
  appointmentId: string;
  clientId: string;
  clientName: string | null;
  phone: string;
  startTime: Date;
  endTime: Date;
  dueAt: Date;
};

function getLatestCommunication(
  communications: CommunicationSnapshot[],
  predicate: (communication: CommunicationSnapshot) => boolean,
): CommunicationSnapshot | null {
  let latest: CommunicationSnapshot | null = null;
  for (const communication of communications) {
    if (!predicate(communication)) {
      continue;
    }
    if (!latest || communication.createdAt > latest.createdAt) {
      latest = communication;
    }
  }
  return latest;
}

function isSuppressedByCommunication(
  communication: CommunicationSnapshot | null,
  now: Date,
): boolean {
  if (!communication) {
    return false;
  }

  if (communication.status === 'snoozed') {
    return Boolean(communication.snoozedUntil && communication.snoozedUntil > now);
  }

  return communication.status === 'marked_sent'
    || communication.status === 'dismissed'
    || communication.status === 'converted';
}

export function normalizeRetentionPhone(value: string): string {
  const digits = value.replace(/\D/g, '');
  return digits.length > 10 ? digits.slice(-10) : digits;
}

/**
 * Communication history keeps useful copy but never persists bearer tokens
 * embedded in promotion or appointment-management links.
 */
export function sanitizeCommunicationMessageSnapshot(
  value: string | null | undefined,
): string | null | undefined {
  if (value == null) {
    return value;
  }

  return value
    .replace(/(https?:\/\/\S+\/manage\/)[\w-]+/gi, '$1[redacted]')
    .replace(/([?&]campaign=)[\w%-]+/gi, '$1[redacted]');
}

export function resolveRetentionStage(args: {
  lastVisitAt: Date;
  now: Date;
  rebookIntervalDays?: number | null;
  defaultRebookDays?: number;
}): { stage: RetentionStage; dueAt: Date; rebookIntervalDays: number } | null {
  const rebookIntervalDays = args.rebookIntervalDays ?? args.defaultRebookDays ?? 21;
  const elapsedMs = args.now.getTime() - args.lastVisitAt.getTime();
  if (elapsedMs < 0) {
    return null;
  }

  if (elapsedMs >= 56 * DAY_MS) {
    return {
      stage: 'promo_8w',
      dueAt: new Date(args.lastVisitAt.getTime() + 56 * DAY_MS),
      rebookIntervalDays,
    };
  }
  if (elapsedMs >= 42 * DAY_MS) {
    return {
      stage: 'promo_6w',
      dueAt: new Date(args.lastVisitAt.getTime() + 42 * DAY_MS),
      rebookIntervalDays,
    };
  }
  if (elapsedMs >= rebookIntervalDays * DAY_MS) {
    return {
      stage: 'rebook',
      dueAt: new Date(args.lastVisitAt.getTime() + rebookIntervalDays * DAY_MS),
      rebookIntervalDays,
    };
  }
  return null;
}

export function buildRetentionQueue(args: {
  clients: RetentionClientSnapshot[];
  futureAppointments: RetentionAppointmentSnapshot[];
  communications: CommunicationSnapshot[];
  defaultRebookDays?: number;
  now?: Date;
}): RetentionQueueItem[] {
  const now = args.now ?? new Date();
  const clientsWithFutureAppointment = new Set(
    args.futureAppointments
      .filter(appointment => appointment.startTime > now && ['pending', 'confirmed'].includes(appointment.status))
      .map(appointment => appointment.salonClientId)
      .filter((clientId): clientId is string => Boolean(clientId)),
  );
  const phonesWithFutureAppointment = new Set(
    args.futureAppointments
      .filter(appointment => appointment.startTime > now && ['pending', 'confirmed'].includes(appointment.status))
      .map(appointment => normalizeRetentionPhone(appointment.clientPhone))
      .filter(Boolean),
  );

  return args.clients.flatMap((client): RetentionQueueItem[] => {
    const lastVisitAt = client.lastVisitAt;
    if (
      client.isBlocked
      || !lastVisitAt
      || clientsWithFutureAppointment.has(client.id)
      || phonesWithFutureAppointment.has(normalizeRetentionPhone(client.phone))
    ) {
      return [];
    }

    const stage = resolveRetentionStage({
      lastVisitAt,
      now,
      rebookIntervalDays: client.rebookIntervalDays,
      defaultRebookDays: args.defaultRebookDays,
    });
    if (!stage) {
      return [];
    }

    const latest = getLatestCommunication(
      args.communications,
      communication => communication.salonClientId === client.id
        && communication.kind === stage.stage
        // Outreach belongs to a visit cycle. A sent/dismissed/converted alert
        // from before the client's newest completed appointment must not
        // suppress the same stage forever on a later cycle.
        && communication.createdAt >= lastVisitAt,
    );
    if (isSuppressedByCommunication(latest, now)) {
      return [];
    }

    return [{
      clientId: client.id,
      clientName: client.fullName,
      phone: client.phone,
      stage: stage.stage,
      dueAt: stage.dueAt,
      lastVisitAt,
      rebookIntervalDays: stage.rebookIntervalDays,
    }];
  }).sort((left, right) => left.dueAt.getTime() - right.dueAt.getTime());
}

export function buildAppointmentReminderQueue(args: {
  clients: RetentionClientSnapshot[];
  appointments: RetentionAppointmentSnapshot[];
  communications: CommunicationSnapshot[];
  reminderLeadHours?: number;
  now?: Date;
}): AppointmentReminderQueueItem[] {
  const now = args.now ?? new Date();
  const reminderLeadHours = args.reminderLeadHours ?? 24;
  const clients = new Map(args.clients.map(client => [client.id, client]));
  const clientsByPhone = new Map(
    args.clients.map(client => [normalizeRetentionPhone(client.phone), client]),
  );

  return args.appointments.flatMap((appointment): AppointmentReminderQueueItem[] => {
    if (
      appointment.startTime <= now
      || !['pending', 'confirmed'].includes(appointment.status)
      || Boolean(appointment.reminderSentAt)
    ) {
      return [];
    }

    const client = (appointment.salonClientId
      ? clients.get(appointment.salonClientId)
      : undefined)
    ?? clientsByPhone.get(normalizeRetentionPhone(appointment.clientPhone));
    if (!client || client.isBlocked) {
      return [];
    }

    const dueAt = new Date(appointment.startTime.getTime() - reminderLeadHours * HOUR_MS);
    if (dueAt > now) {
      return [];
    }

    const latest = getLatestCommunication(
      args.communications,
      communication => communication.appointmentId === appointment.id && communication.kind === 'reminder',
    );
    if (isSuppressedByCommunication(latest, now)) {
      return [];
    }

    return [{
      appointmentId: appointment.id,
      clientId: client.id,
      clientName: appointment.clientName ?? client.fullName,
      phone: appointment.clientPhone || client.phone,
      startTime: appointment.startTime,
      endTime: appointment.endTime,
      dueAt,
    }];
  }).sort((left, right) => left.startTime.getTime() - right.startTime.getTime());
}

export function getSnoozedUntil(now = new Date(), days = DEFAULT_SNOOZE_DAYS): Date {
  return new Date(now.getTime() + days * DAY_MS);
}

export function getReminderSnoozedUntil(
  now: Date,
  appointmentStartTime: Date,
  hours = REMINDER_SNOOZE_HOURS,
): Date {
  const requestedUntil = now.getTime() + hours * HOUR_MS;
  // A reminder snooze must never survive the appointment it is meant to help
  // with. One millisecond keeps the stored deadline strictly before start.
  const latestUsefulUntil = appointmentStartTime.getTime() - 1;
  return new Date(Math.min(requestedUntil, latestUsefulUntil));
}

const ALLOWED_STATUS_TRANSITIONS: Record<ClientCommunicationStatus, ClientCommunicationStatus[]> = {
  prepared: ['marked_sent', 'not_sent', 'snoozed', 'dismissed', 'converted'],
  marked_sent: ['converted'],
  not_sent: ['prepared', 'marked_sent', 'snoozed', 'dismissed'],
  snoozed: ['prepared', 'marked_sent', 'not_sent', 'dismissed'],
  dismissed: [],
  converted: [],
};

export function canTransitionCommunicationStatus(
  from: ClientCommunicationStatus,
  to: ClientCommunicationStatus,
): boolean {
  return from === to || ALLOWED_STATUS_TRANSITIONS[from].includes(to);
}

export function buildCommunicationStatusTimestamps(
  status: ClientCommunicationStatus,
  now = new Date(),
  context: {
    kind?: ClientCommunicationKind;
    appointmentStartTime?: Date | null;
  } = {},
): {
    preparedAt?: Date;
    markedSentAt?: Date;
    dismissedAt?: Date;
    convertedAt?: Date;
    snoozedUntil?: Date | null;
  } {
  switch (status) {
    case 'prepared':
      return { preparedAt: now, snoozedUntil: null };
    case 'marked_sent':
      return { markedSentAt: now, snoozedUntil: null };
    case 'snoozed': {
      if (context.kind === 'reminder') {
        if (!context.appointmentStartTime) {
          throw new Error('Appointment reminder snoozes require an appointment start time');
        }
        return {
          snoozedUntil: getReminderSnoozedUntil(now, context.appointmentStartTime),
        };
      }
      return { snoozedUntil: getSnoozedUntil(now) };
    }
    case 'dismissed':
      return { dismissedAt: now, snoozedUntil: null };
    case 'converted':
      return { convertedAt: now, snoozedUntil: null };
    case 'not_sent':
      return { snoozedUntil: null };
  }
}
