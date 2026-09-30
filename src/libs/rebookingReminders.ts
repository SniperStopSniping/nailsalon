import { z } from 'zod';

import { getDateKeyInTimeZone, zonedTimeToUtc } from '@/libs/timeZone';

export const DEFAULT_REBOOKING_REMINDER_MESSAGE = 'Hi {{first_name}}! It’s almost time for your next appointment 💕 Our popular times can fill up quickly, so book ahead to get the time that works best for you: {{booking_link}}';
export const REBOOKING_REMINDER_VARIABLES = ['first_name', 'service_name', 'salon_name', 'booking_link'] as const;
export const REBOOKING_REMINDER_MAX_LENGTH = 500;

export type RebookingReminderSettings = {
  enabled: boolean;
  defaultIntervalWeeks: number;
  messageTemplate: string;
  enabledAt: Date | null;
};

export const defaultRebookingReminderSettings: RebookingReminderSettings = {
  enabled: false,
  defaultIntervalWeeks: 3,
  messageTemplate: DEFAULT_REBOOKING_REMINDER_MESSAGE,
  enabledAt: null,
};

export const rebookingReminderUpdateSchema = z.object({
  enabled: z.boolean(),
  defaultIntervalWeeks: z.number().int().min(1).max(52),
  messageTemplate: z.string().trim().min(1).max(REBOOKING_REMINDER_MAX_LENGTH)
    .refine((value) => {
      const withoutVariables = value.replace(/\{\{(?:first_name|service_name|salon_name|booking_link)\}\}/g, '');
      return !withoutVariables.includes('{{') && !withoutVariables.includes('}}');
    }, 'Unknown or invalid message variable'),
}).strict();

export function renderRebookingReminder(template: string, variables: Record<(typeof REBOOKING_REMINDER_VARIABLES)[number], string>): string {
  return template.replace(/\{\{(first_name|service_name|salon_name|booking_link)\}\}/g, (_, variable: keyof typeof variables) => variables[variable]);
}

/** Calendar weeks in salon time; a DST change must not move the send day. */
export function rebookingReminderDueAt(completedAt: Date, intervalWeeks: number, timeZone: string): Date {
  const dateKey = getDateKeyInTimeZone(completedAt, timeZone);
  const [year, month, day] = dateKey.split('-').map(Number);
  const due = new Date(Date.UTC(year!, month! - 1, day! + intervalWeeks * 7));
  const dueKey = `${due.getUTCFullYear()}-${String(due.getUTCMonth() + 1).padStart(2, '0')}-${String(due.getUTCDate()).padStart(2, '0')}`;
  return zonedTimeToUtc({ date: dueKey, time: '10:00', timeZone });
}
