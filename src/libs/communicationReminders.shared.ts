import { z } from 'zod';

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

export const reminderRuleSchema = z.object({
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

export const quietHoursSchema = z.object({
  enabled: z.boolean(),
  start: timeOfDaySchema,
  end: timeOfDaySchema,
});

export type QuietHoursSettings = z.infer<typeof quietHoursSchema>;

/** The original duplicate-id/offset guards, shared by draft and live writes. */
function validateReminderRules(rules: ReminderRule[], ctx: z.RefinementCtx) {
  const ids = new Set<string>();
  const offsets = new Set<number>();
  for (const rule of rules) {
    if (ids.has(rule.id)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Duplicate reminder rule id: ${rule.id}` });
    }
    ids.add(rule.id);
    if (rule.enabled) {
      if (offsets.has(rule.offsetMinutes)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Duplicate enabled reminder offset: ${rule.offsetMinutes} minutes` });
      }
      offsets.add(rule.offsetMinutes);
    }
  }
}

export const reminderRulesSchema = z.array(reminderRuleSchema).max(MAX_REMINDER_RULES).superRefine(validateReminderRules);
export const strictReminderRulesSchema = z.array(reminderRuleSchema.strict()).max(MAX_REMINDER_RULES).superRefine(validateReminderRules);
