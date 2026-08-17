/**
 * Platform communication control — the operator kill-switch singleton.
 *
 * Two read paths with DIFFERENT caching contracts (contract §10.9/§20):
 * health/admin surfaces MAY use the short-cached read; the dispatcher's
 * FINAL pre-provider check MUST use the uncached read, or the kill switch
 * stops being a kill switch.
 */

import 'server-only';

import { eq } from 'drizzle-orm';

import { db } from '@/libs/DB';
import {
  type PlatformCommunicationControl,
  platformCommunicationControlSchema,
} from '@/models/Schema';

const SINGLETON_ID = 'singleton';
const CACHE_TTL_MS = 15_000;

let cached: { value: PlatformCommunicationControl | null; at: number } | null = null;

/** UNCACHED — the only read the final pre-provider check may use. */
export async function readCommunicationControlUncached(): Promise<PlatformCommunicationControl | null> {
  const rows = await db
    .select()
    .from(platformCommunicationControlSchema)
    .where(eq(platformCommunicationControlSchema.id, SINGLETON_ID))
    .limit(1);
  const value = rows[0] ?? null;
  cached = { value, at: Date.now() };
  return value;
}

/** Short-cached read for health/admin surfaces only. */
export async function readCommunicationControlCached(): Promise<PlatformCommunicationControl | null> {
  if (cached !== null && Date.now() - cached.at < CACHE_TTL_MS) {
    return cached.value;
  }
  return readCommunicationControlUncached();
}

export async function updateCommunicationControl(input: {
  smsEnabled?: boolean;
  disabledEventTypes?: string[];
  dispatchBatchLimit?: number;
  perSalonBatchLimit?: number;
  dailySendLimit?: number;
  dailyAnomalyThreshold?: number;
  updatedBy: string;
}): Promise<PlatformCommunicationControl | null> {
  const { updatedBy, ...changes } = input;
  const rows = await db
    .update(platformCommunicationControlSchema)
    .set({ ...changes, updatedBy })
    .where(eq(platformCommunicationControlSchema.id, SINGLETON_ID))
    .returning();
  cached = null;
  return rows[0] ?? null;
}

/** Test seam. */
export function __clearCommunicationControlCache(): void {
  cached = null;
}
