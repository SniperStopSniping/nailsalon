import { z } from 'zod';

import { buildClientSmsPrefix, STOP_LANGUAGE } from '@/libs/communicationTemplates';
import { calculateSmsSegments } from '@/libs/smsSegments';

export const DEFAULT_REVIEW_MESSAGE = 'Hi {{firstName}}! Thanks for visiting {{businessName}}. We would appreciate a Google review: {{reviewLink}}';
export const REVIEW_DELAY_MINUTES = [0, 30, 60, 120, 240, 1440] as const;

export function isReviewUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && url.hostname.includes('.') && !/\s/.test(value);
  } catch {
    return false;
  }
}

export const reviewSettingsSchema = z.object({
  googleReviewUrl: z.string().trim().max(2048).nullable().transform(value => value || null).refine(value => value === null || isReviewUrl(value), 'Enter a valid HTTPS review link.'),
  automaticEnabled: z.boolean(),
  delayMinutes: z.number().int().refine(value => REVIEW_DELAY_MINUTES.includes(value as typeof REVIEW_DELAY_MINUTES[number])),
  messageTemplate: z.string().trim().min(1).max(1000).refine(value => value.includes('{{reviewLink}}'), 'Include {{reviewLink}} in your message.').refine(value => !/\{\{(?!(?:firstName|businessName|reviewLink)\}\})/.test(value), 'Use firstName, businessName, or reviewLink placeholders.'),
}).strict();

export function renderReviewMessage(input: { template: string; clientName: string | null; businessName: string; reviewLink: string }): string {
  const values: Record<string, string> = {
    firstName: input.clientName?.trim().split(/\s+/)[0] || 'there',
    businessName: input.businessName,
    reviewLink: input.reviewLink,
  };
  return input.template.replace(/\{\{(firstName|businessName|reviewLink)\}\}/g, (_match, key: string) => values[key] ?? '');
}

export function reviewSmsBody(input: Parameters<typeof renderReviewMessage>[0]): string {
  return `${buildClientSmsPrefix(input.businessName)}${renderReviewMessage(input)} ${STOP_LANGUAGE}`;
}

export function reviewMessageFits(body: string): boolean {
  return calculateSmsSegments(body).segments <= 10;
}
