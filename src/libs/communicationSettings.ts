/**
 * Per-salon transactional-communication settings — Gate C / C1.
 *
 * Governing contract: docs/luster-billing-communications-rev-2-2.md §9.4
 * step 3 (per-salon gates), §11.1 (reminder rules), §11.2 (scheduling
 * revision inputs), §11.4 (quiet hours).
 *
 * Storage: the `communications` namespace inside the existing
 * `salon.settings` JSONB. C1 adds NO table and NO migration — Migration A
 * (0069) and Migration B (0070) are the track's only two carriers (§13).
 *
 * Two properties of this module are load-bearing and deliberately shaped:
 *
 *  1. THE RESOLVER IS PURE. It never mints an id, never writes, and never
 *     consults the clock, so two concurrent requests resolving the same
 *     stored row always agree. The default reminder rule therefore carries a
 *     CONSTANT id (DEFAULT_REMINDER_RULE_ID) rather than a generated uuid.
 *     That removes the need for any CAS-guarded seeding write for the default
 *     case: an unconfigured salon resolves a stable 24-hour rule identity
 *     without touching the database. Only owner-ADDED rules mint ids, on the
 *     write path (§`createReminderRuleId`).
 *
 *     A constant rule id shared across salons is safe because every dedupe
 *     identity embeds the salon id (see communicationMaterialization.ts) —
 *     the rule id discriminates rules WITHIN a salon, never across tenants.
 *
 *  2. `events` IS TOTAL over COMMUNICATION_EVENT_TYPES. A partial record
 *     would need a schema change every time a producer lands. Events that an
 *     EXISTING owner surface already governs default to `enabled: true` here
 *     so this per-event toggle can only ever be an additional platform-level
 *     gate — it must not silently become a second competing switch for
 *     owner/technician notifications, which `settings.notifications`
 *     (bookingNotificationSettings.ts) still owns.
 */

import 'server-only';

import { z } from 'zod';

import {
  COMMUNICATION_EVENT_TYPES,
  type CommunicationEventType,
} from '@/models/Schema';
import type { SalonSettings } from '@/types/salonPolicy';

/** Per-event / per-rule channel selection. */
export const COMMUNICATION_CHANNEL_MODES = ['sms', 'email', 'both'] as const;
export type CommunicationChannelMode = (typeof COMMUNICATION_CHANNEL_MODES)[number];

/**
 * Stable id of the default 24-hour reminder rule. Constant, not generated:
 * see the header note on resolver purity. Never change this value — it is
 * embedded in the dedupe identity of every already-materialized reminder for
 * every salon that has not customized its rules.
 */
export const DEFAULT_REMINDER_RULE_ID = 'crule_default_24h';

/** Contract §11.1: up to three configurable reminder rules. */
export const MAX_REMINDER_RULES = 3;

/**
 * Reminder lead-time bounds. The floor keeps a rule from being scheduled so
 * close to the appointment that it can never clear the dispatcher interval;
 * the ceiling is one week, past which a "reminder" is not a reminder.
 */
export const MIN_REMINDER_OFFSET_MINUTES = 15;
export const MAX_REMINDER_OFFSET_MINUTES = 7 * 24 * 60;

/** Contract §11.4: default quiet hours, enabled, 21:00 → 09:00 salon-local. */
export const DEFAULT_QUIET_HOURS_START = '21:00';
export const DEFAULT_QUIET_HOURS_END = '09:00';

const TIME_OF_DAY_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

const timeOfDaySchema = z
  .string()
  .regex(TIME_OF_DAY_PATTERN, 'Expected 24-hour HH:MM');

/**
 * Rule ids are minted ONLY here, and only from a write path. The prefix
 * mirrors the repo's `{domain}_{uuid}` id convention.
 */
export function createReminderRuleId(): string {
  return `crule_${crypto.randomUUID()}`;
}

const reminderRuleSchema = z.object({
  id: z.string().min(1).max(64),
  /** Minutes BEFORE appointment start. */
  offsetMinutes: z
    .number()
    .int()
    .min(MIN_REMINDER_OFFSET_MINUTES)
    .max(MAX_REMINDER_OFFSET_MINUTES),
  channels: z.enum(COMMUNICATION_CHANNEL_MODES),
  enabled: z.boolean(),
});

export type ReminderRule = z.infer<typeof reminderRuleSchema>;

/**
 * Contract §11.1: defaults are "immediate confirmation on, 24h rule on
 * (`both`), 2h rule ABSENT". The absence of a 2-hour rule is a deliberate
 * commercial default, not an oversight.
 */
export const DEFAULT_REMINDER_RULES: readonly ReminderRule[] = Object.freeze([
  Object.freeze({
    id: DEFAULT_REMINDER_RULE_ID,
    offsetMinutes: 24 * 60,
    channels: 'both' as const,
    enabled: true,
  }),
]);

const quietHoursSchema = z.object({
  enabled: z.boolean(),
  start: timeOfDaySchema,
  end: timeOfDaySchema,
});

export type QuietHoursSettings = z.infer<typeof quietHoursSchema>;

const eventSettingsSchema = z.object({
  enabled: z.boolean(),
  channels: z.enum(COMMUNICATION_CHANNEL_MODES),
});

export type CommunicationEventSettings = z.infer<typeof eventSettingsSchema>;

/**
 * Events already governed by an existing owner surface. Their per-event
 * toggle here defaults OPEN so this namespace cannot become a second,
 * invisible switch over behavior an owner already controls elsewhere:
 *  - owner_* / tech_* → `settings.notifications` (bookingNotificationSettings)
 *  - booking_request_* → the booking-request approval flow's own settings
 */
export const EVENTS_GOVERNED_ELSEWHERE: ReadonlySet<CommunicationEventType> = new Set<CommunicationEventType>([
  'owner_new_booking',
  'owner_appointment_cancelled',
  'tech_new_booking',
  'tech_appointment_cancelled',
  'booking_request_received',
  'booking_request_approved',
  'booking_request_declined',
  'booking_request_expired',
  'manual_reminder',
]);

/**
 * Default channel per event. Client lifecycle messaging defaults to `both`
 * so email carries it while the shared SMS sender is dark and SMS joins
 * automatically once enabled (contract §3.6 — email is independent and
 * continues when SMS is unavailable). Internal owner/technician alerts
 * default to `sms`, matching the established
 * DEFAULT_BOOKING_NOTIFICATION_SETTINGS technicianChannel.
 */
function defaultChannelsFor(eventType: CommunicationEventType): CommunicationChannelMode {
  if (eventType.startsWith('owner_') || eventType.startsWith('tech_')) {
    return 'sms';
  }
  return 'both';
}

export const DEFAULT_COMMUNICATION_EVENT_SETTINGS: Readonly<
  Record<CommunicationEventType, CommunicationEventSettings>
> = Object.freeze(
  Object.fromEntries(
    COMMUNICATION_EVENT_TYPES.map(eventType => [
      eventType,
      Object.freeze({
        // Reminder delivery is decided by reminders.rules, never by this
        // toggle, so the umbrella event stays enabled and the rules gate it.
        enabled: true,
        channels: defaultChannelsFor(eventType),
      }),
    ]),
  ) as Record<CommunicationEventType, CommunicationEventSettings>,
);

const staffOverrideSchema = z.object({
  /**
   * Per-staff suppression of internal technician notifications. Absent means
   * "follow the salon-level setting"; false suppresses for this staff member
   * only. Deliberately narrow — this is not a second per-event matrix.
   */
  notificationsEnabled: z.boolean().optional(),
  channels: z.enum(COMMUNICATION_CHANNEL_MODES).optional(),
});

export type CommunicationStaffOverride = z.infer<typeof staffOverrideSchema>;

/**
 * Canonical stored shape. Every field has a default, so
 * `communicationSettingsSchema.parse({})` yields the full contract defaults
 * and an unconfigured salon needs no stored row.
 */
export const communicationSettingsSchema = z.object({
  sms: z
    .object({
      /**
       * Salon-level master for shared-sender SMS. Contract §14 / prompt §7.1:
       * default DISABLED. This is a per-salon consent to use SMS at all; it is
       * NOT the platform dark switch (COMMUNICATIONS_SMS_ENABLED) nor the
       * operator kill switch (platform_communication_control.smsEnabled).
       * All three must be affirmative for a shared send (§9.4 step 2).
       */
      enabled: z.boolean().default(false),
    })
    .default({ enabled: false }),
  email: z
    .object({
      /** Contract §3.6: email is independently configurable and default on. */
      enabled: z.boolean().default(true),
    })
    .default({ enabled: true }),
  /**
   * Per-salon emergency stop for ALL transactional communication in this
   * namespace, both channels. Distinct from sms.enabled so an owner can halt
   * everything without losing their channel configuration.
   */
  killSwitch: z.boolean().default(false),
  quietHours: quietHoursSchema
    .default({
      enabled: true,
      start: DEFAULT_QUIET_HOURS_START,
      end: DEFAULT_QUIET_HOURS_END,
    })
    .refine(value => value.start !== value.end, {
      message: 'Quiet hours start and end must differ',
    }),
  events: z
    .record(z.enum(COMMUNICATION_EVENT_TYPES), eventSettingsSchema)
    .default(() => ({ ...DEFAULT_COMMUNICATION_EVENT_SETTINGS }))
    .transform(stored => ({
      // Total record: unknown/absent events fall back to their default rather
      // than resolving `undefined` at a call site.
      ...DEFAULT_COMMUNICATION_EVENT_SETTINGS,
      ...stored,
    })),
  reminders: z
    .object({
      rules: z
        .array(reminderRuleSchema)
        .max(MAX_REMINDER_RULES)
        .default(() => DEFAULT_REMINDER_RULES.map(rule => ({ ...rule })))
        .superRefine((rules, ctx) => {
          const seenIds = new Set<string>();
          const seenOffsets = new Set<number>();
          for (const rule of rules) {
            if (seenIds.has(rule.id)) {
              ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: `Duplicate reminder rule id: ${rule.id}`,
              });
            }
            seenIds.add(rule.id);
            // Two enabled rules at the same lead time would materialize two
            // intents with distinct dedupe keys and send the client the same
            // reminder twice. Distinct ids cannot protect against that, so
            // the offset itself must be unique.
            if (rule.enabled) {
              if (seenOffsets.has(rule.offsetMinutes)) {
                ctx.addIssue({
                  code: z.ZodIssueCode.custom,
                  message: `Duplicate enabled reminder offset: ${rule.offsetMinutes} minutes`,
                });
              }
              seenOffsets.add(rule.offsetMinutes);
            }
          }
        }),
    })
    .default({ rules: DEFAULT_REMINDER_RULES.map(rule => ({ ...rule })) }),
  staffOverrides: z.record(z.string().min(1), staffOverrideSchema).default({}),
});

export type CommunicationSettings = z.infer<typeof communicationSettingsSchema>;

/**
 * Update shape accepted by the admin PATCH. Every branch is optional and
 * `.strict()`, matching adminUpdateSchema's posture: an unknown key is a
 * client bug and must fail loudly rather than be silently dropped.
 *
 * Rules are replace-whole-array, not patch-by-index: partial rule updates
 * across a concurrent edit cannot be merged coherently, and the UI always
 * holds the full list.
 */
export const communicationSettingsUpdateSchema = z
  .object({
    sms: z.object({ enabled: z.boolean() }).strict().optional(),
    email: z.object({ enabled: z.boolean() }).strict().optional(),
    killSwitch: z.boolean().optional(),
    quietHours: quietHoursSchema.strict().optional(),
    events: z
      .record(z.enum(COMMUNICATION_EVENT_TYPES), eventSettingsSchema.strict())
      .optional(),
    reminders: z
      .object({
        rules: z.array(reminderRuleSchema.strict()).max(MAX_REMINDER_RULES),
      })
      .strict()
      .optional(),
    staffOverrides: z.record(z.string().min(1), staffOverrideSchema.strict()).optional(),
  })
  .strict();

export type CommunicationSettingsUpdate = z.infer<typeof communicationSettingsUpdateSchema>;

/**
 * Safe resolver for arbitrary stored data. Mirrors
 * resolveBookingNotificationSettingsFromSettings: a stored value that fails
 * validation must never throw into a read path — it falls back to contract
 * defaults, because a booking page or dispatcher run must not break on a
 * malformed settings blob.
 */
export function resolveCommunicationSettingsFromSettings(
  settings: SalonSettings | null | undefined,
): CommunicationSettings {
  const parsed = communicationSettingsSchema.safeParse(
    (settings as { communications?: unknown } | null | undefined)?.communications ?? {},
  );
  if (parsed.success) {
    return parsed.data;
  }
  return communicationSettingsSchema.parse({});
}

/**
 * Merge an owner update over resolved current settings and re-validate the
 * whole result. Throws ZodError on invalid input so the route can return 400
 * with `.flatten()`, matching mergeSmartFitSettings' contract.
 */
export function mergeCommunicationSettings(
  current: CommunicationSettings,
  updates: CommunicationSettingsUpdate,
): CommunicationSettings {
  return communicationSettingsSchema.parse({
    sms: { ...current.sms, ...(updates.sms ?? {}) },
    email: { ...current.email, ...(updates.email ?? {}) },
    killSwitch: updates.killSwitch ?? current.killSwitch,
    quietHours: { ...current.quietHours, ...(updates.quietHours ?? {}) },
    events: { ...current.events, ...(updates.events ?? {}) },
    reminders: updates.reminders
      ? { rules: updates.reminders.rules }
      : { rules: current.reminders.rules },
    staffOverrides: updates.staffOverrides ?? current.staffOverrides,
  });
}

/** Enabled rules in ascending lead time — the materializer's iteration order. */
export function resolveActiveReminderRules(
  settings: CommunicationSettings,
): ReminderRule[] {
  return settings.reminders.rules
    .filter(rule => rule.enabled)
    .sort((a, b) => a.offsetMinutes - b.offsetMinutes);
}

/** Does `mode` cover `channel`? */
export function channelModeIncludes(
  mode: CommunicationChannelMode,
  channel: 'sms' | 'email',
): boolean {
  return mode === 'both' || mode === channel;
}

/**
 * Channels to materialize for one event, after applying the salon-level
 * kill switch and the per-channel masters.
 *
 * Email independence (contract §3.6, prompt §7.6) is structural here: an
 * SMS-side problem removes 'sms' from this list and cannot remove 'email'.
 */
export function resolveEventChannels(
  settings: CommunicationSettings,
  eventType: CommunicationEventType,
  channelMode?: CommunicationChannelMode,
): Array<'sms' | 'email'> {
  if (settings.killSwitch) {
    return [];
  }
  const event = settings.events[eventType] ?? DEFAULT_COMMUNICATION_EVENT_SETTINGS[eventType];
  if (!event.enabled) {
    return [];
  }
  const mode = channelMode ?? event.channels;
  const channels: Array<'sms' | 'email'> = [];
  if (settings.sms.enabled && channelModeIncludes(mode, 'sms')) {
    channels.push('sms');
  }
  if (settings.email.enabled && channelModeIncludes(mode, 'email')) {
    channels.push('email');
  }
  return channels;
}

/**
 * The scheduling-relevant projection of these settings, and nothing else.
 *
 * communicationMaterialization.ts fingerprints this into every intent's
 * `scheduling_revision` (contract §11.2). Adding a field here forces
 * rematerialization of every future intent on the next reconciler pass, so
 * only genuinely scheduling-relevant values belong — an unrelated settings
 * edit must not churn the queue.
 */
export function schedulingRelevantSettings(settings: CommunicationSettings): {
  quietHours: QuietHoursSettings;
  rules: ReminderRule[];
  smsEnabled: boolean;
  emailEnabled: boolean;
  killSwitch: boolean;
} {
  return {
    quietHours: settings.quietHours,
    rules: resolveActiveReminderRules(settings),
    smsEnabled: settings.sms.enabled,
    emailEnabled: settings.email.enabled,
    killSwitch: settings.killSwitch,
  };
}
