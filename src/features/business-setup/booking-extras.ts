import { z } from 'zod';

import { quietHoursSchema, reminderRulesSchema, strictReminderRulesSchema } from '@/libs/communicationReminders.shared';
import { salonDepositSettingsSchema } from '@/libs/depositPolicy';

export const setupDepositSchema = z.object({ enabled: z.boolean(), amountCents: salonDepositSettingsSchema.shape.amountCents.unwrap().nullable() }).strict();
export const setupDepositUpdateSchema = setupDepositSchema.partial().refine(value => Object.keys(value).length > 0, 'Choose a deposit setting to change.');
export type SetupDeposit = z.infer<typeof setupDepositSchema>;
export const setupRemindersSchema = z.object({ rules: strictReminderRulesSchema, quietHours: quietHoursSchema.strict().refine(value => value.start !== value.end, 'Quiet hours start and end must differ') }).strict();
export const setupRemindersUpdateSchema = setupRemindersSchema.partial().refine(value => Object.keys(value).length > 0, 'Choose a reminder setting to change.');
export type SetupReminders = z.infer<typeof setupRemindersSchema>;

export function reminderRulesReviewValue(value: unknown) {
  const parsed = reminderRulesSchema.safeParse(value);
  if (!parsed.success) {
    return 'Current reminder rules kept';
  }
  return parsed.data.map(rule => `${rule.offsetMinutes % 60 === 0 ? `${rule.offsetMinutes / 60} hours` : `${rule.offsetMinutes} minutes`} before · ${rule.channels === 'both' ? 'SMS and email' : rule.channels === 'sms' ? 'SMS' : 'email'} · ${rule.enabled ? 'on' : 'off'}`).join('; ') || 'No reminders';
}

export function reminderReviewValue(value: unknown) {
  const parsed = setupRemindersSchema.safeParse(value);
  if (!parsed.success) {
    return 'Current reminder preferences kept';
  }
  const { rules, quietHours } = parsed.data;
  return `${reminderRulesReviewValue(rules)}; ${quietHours.enabled ? `quiet hours ${quietHours.start}–${quietHours.end}, salon local time` : 'quiet hours off'}. Channel switches, consent, SMS credits and sending controls still apply.`;
}
