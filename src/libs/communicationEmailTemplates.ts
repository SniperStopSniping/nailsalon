/**
 * Transactional email templates for the communication-intent email lane —
 * Gate C / C1 (blueprint decision H1: minimal dispatcher email lane, rule-
 * driven events only).
 *
 * Deliberately tiny: subject + plain-text body per event, keyed
 * `email_{eventType}` to match the keys materialization writes onto email
 * intents. Email is NOT segment-budgeted (no SMS cost model), but copy stays
 * short and factual — this is a transactional notice, not marketing.
 *
 * Contract §3.6: email is included, independently configurable, consumes no
 * SMS credits, and keeps working while SMS is dark.
 */

import 'server-only';

export type EmailTemplateDefinition = {
  key: string;
  version: string;
  subject: (variables: Record<string, string>) => string;
  body: (variables: Record<string, string>) => string;
};

const salon = (variables: Record<string, string>) => variables.salonName ?? 'Your salon';
const time = (variables: Record<string, string>) => variables.startTime ?? '';
const manage = (variables: Record<string, string>) =>
  variables.manageUrl ? `\n\nView or change your appointment: ${variables.manageUrl}` : '';

export const COMMUNICATION_EMAIL_TEMPLATES: Record<string, EmailTemplateDefinition> = {
  email_booking_confirmation: {
    key: 'email_booking_confirmation',
    version: 'v1',
    subject: variables => `Booking confirmed — ${salon(variables)}`,
    body: variables =>
      `Your booking at ${salon(variables)} is confirmed for ${time(variables)}.${manage(variables)}`,
  },
  email_appointment_reminder: {
    key: 'email_appointment_reminder',
    version: 'v1',
    subject: variables => `Reminder — ${salon(variables)}`,
    body: variables =>
      `A reminder about your appointment at ${salon(variables)} on ${time(variables)}.${manage(variables)}`,
  },
  email_appointment_cancelled: {
    key: 'email_appointment_cancelled',
    version: 'v1',
    subject: variables => `Appointment cancelled — ${salon(variables)}`,
    body: variables =>
      `Your appointment at ${salon(variables)} for ${time(variables)} has been cancelled.${manage(variables)}`,
  },
  email_appointment_rescheduled: {
    key: 'email_appointment_rescheduled',
    version: 'v1',
    subject: variables => `Appointment updated — ${salon(variables)}`,
    body: variables =>
      `Your appointment at ${salon(variables)} has been moved to ${time(variables)}.${manage(variables)}`,
  },
};

Object.freeze(COMMUNICATION_EMAIL_TEMPLATES);
Object.values(COMMUNICATION_EMAIL_TEMPLATES).forEach(Object.freeze);

export function getEmailTemplate(templateKey: string): EmailTemplateDefinition | null {
  return Object.prototype.hasOwnProperty.call(COMMUNICATION_EMAIL_TEMPLATES, templateKey)
    ? COMMUNICATION_EMAIL_TEMPLATES[templateKey]!
    : null;
}
