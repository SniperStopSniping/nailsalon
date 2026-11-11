import { z } from 'zod';

import { getDateKeyInTimeZone } from '@/libs/timeZone';

export const MAX_BULK_MESSAGE_CLIENTS = 1000;

export type BulkMessageClient = {
  id: string;
  fullName: string | null;
  phone: string;
  lastCompletedAt: string | null;
  hasUpcomingAppointment: boolean;
  eligible: boolean;
  unavailableReason: string | null;
};

export const bulkMessageFilterSchema = z.object({
  minWeeks: z.number().int().min(1).max(104).nullable(),
  excludeUpcoming: z.boolean(),
}).strict();

export const bulkMessageDraftSchema = z.object({
  salonSlug: z.string().min(1).max(200),
  clientIds: z.array(z.string().min(1).max(200)).min(1).max(MAX_BULK_MESSAGE_CLIENTS)
    .refine(ids => new Set(ids).size === ids.length, 'Choose each client only once.'),
  message: z.string().trim().min(1).max(1000),
  filter: bulkMessageFilterSchema,
}).strict();

export type BulkMessageFilter = z.infer<typeof bulkMessageFilterSchema>;
export type BulkMessageDraft = z.infer<typeof bulkMessageDraftSchema>;

/** Compare salon calendar dates so daylight saving does not move the cutoff. */
export function matchesBulkMessageFilter(client: BulkMessageClient, filter: BulkMessageFilter, now: Date, timeZone: string): boolean {
  if (filter.excludeUpcoming && client.hasUpcomingAppointment) {
    return false;
  }
  if (filter.minWeeks === null) {
    return true;
  }
  if (!client.lastCompletedAt) {
    return false;
  }
  const today = getDateKeyInTimeZone(now, timeZone);
  const lastVisit = getDateKeyInTimeZone(new Date(client.lastCompletedAt), timeZone);
  return Date.parse(`${lastVisit}T00:00:00Z`) <= Date.parse(`${today}T00:00:00Z`) - filter.minWeeks * 7 * 86400000;
}

export type BulkMessagePreview = {
  fingerprint: string;
  body: string;
  recipients: Array<{ id: string; fullName: string | null; phone: string }>;
  skipped: number;
  creditsPerText: number;
  totalCredits: number;
};

export type BulkMessageReceipt = {
  requestId: string;
  queued: number;
  skipped: number;
  totalCredits: number;
  messages: Array<{ id: string; clientName: string; status: string; failureReason: string | null }>;
};
