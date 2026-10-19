import 'server-only';

import { createHash, randomUUID } from 'node:crypto';

import { and, asc, eq, isNull, lte, or, sql } from 'drizzle-orm';

import { db } from '@/libs/DB';
import { assertSalonDeletionAssetUnreferenced, removeSalonDeletionAsset } from '@/libs/salonDeletionMedia.server';
import { SALON_DELETION_RETAINED, type SalonDeletionStatus } from '@/models/salonDeletion';
import { salonDeletionCleanupSchema as cleanup } from '@/models/Schema';

export function salonDeletionConfirmationDigest(jobId: string, slug: string): string {
  return createHash('sha256').update(`${jobId}:${slug}`).digest('hex');
}

type CleanupRow = typeof cleanup.$inferSelect;

export function salonDeletionStatus(row: CleanupRow): SalonDeletionStatus {
  const reviewRequired = row.pendingAssets.filter(asset => asset.kind === 'review').length;
  return {
    jobId: row.id,
    status: row.pendingAssets.length === 0 ? 'completed' : row.pendingAssets.length === reviewRequired ? 'review_required' : 'pending',
    databaseDeleted: true,
    rowsDeleted: row.rowsDeleted,
    mediaTotal: row.mediaTotal,
    mediaRemoved: row.mediaRemoved,
    mediaRemaining: row.pendingAssets.length,
    reviewRequired,
    attempts: row.attempts,
    nextAttemptAt: row.completedAt || row.pendingAssets.length === reviewRequired ? null : row.nextAttemptAt.toISOString(),
    retained: SALON_DELETION_RETAINED,
  };
}

export async function getSalonDeletionCleanup(jobId: string): Promise<CleanupRow | null> {
  const [row] = await db.select().from(cleanup).where(eq(cleanup.id, jobId)).limit(1);
  return row ?? null;
}

export async function findSalonDeletionCleanup(salonId: string): Promise<CleanupRow | null> {
  const [row] = await db.select().from(cleanup).where(eq(cleanup.sourceSalonId, salonId)).limit(1);
  return row ?? null;
}

/** Bounded work, atomic lease and fenced progress. Provider errors never erase keys. */
export async function runSalonDeletionCleanup(jobId: string, now = new Date()): Promise<SalonDeletionStatus | null> {
  const token = randomUUID();
  const [claimed] = await db.update(cleanup).set({
    leaseToken: token,
    leaseExpiresAt: new Date(now.getTime() + 10 * 60_000),
    attempts: sql`${cleanup.attempts} + 1`,
    updatedAt: now,
  }).where(and(
    eq(cleanup.id, jobId),
    isNull(cleanup.completedAt),
    lte(cleanup.nextAttemptAt, now),
    or(isNull(cleanup.leaseExpiresAt), lte(cleanup.leaseExpiresAt, now)),
  )).returning();
  if (!claimed) {
    const current = await getSalonDeletionCleanup(jobId);
    return current ? salonDeletionStatus(current) : null;
  }

  // Small sequential batches also bound provider concurrency and function time.
  // Each successful key is checkpointed; an interrupted function can safely
  // retry an already-removed provider object (ok / not found are idempotent).
  let pendingAssets = claimed.pendingAssets;
  let removed = claimed.mediaRemoved;
  for (const asset of claimed.pendingAssets.filter(item => item.kind !== 'review').slice(0, 10)) {
    // A slow provider request may outlive a lease. Do not start another deletion
    // after ownership changes; the fenced write below protects stale progress.
    const current = await getSalonDeletionCleanup(jobId);
    if (current?.leaseToken !== token || !current.leaseExpiresAt || current.leaseExpiresAt <= new Date()) {
      break;
    }
    try {
      await assertSalonDeletionAssetUnreferenced(db, asset);
      await removeSalonDeletionAsset(asset, claimed.sourceSalonId);
    } catch {
      // Persisted asset remains retryable. Never log provider errors or keys.
      continue;
    }
    pendingAssets = pendingAssets.filter(item => item !== asset);
    removed += 1;
    const saved = await db.update(cleanup).set({
      pendingAssets,
      mediaRemoved: removed,
      updatedAt: new Date(),
    }).where(and(eq(cleanup.id, jobId), eq(cleanup.leaseToken, token))).returning();
    if (!saved.length) {
      const latest = await getSalonDeletionCleanup(jobId);
      return latest ? salonDeletionStatus(latest) : null;
    }
  }
  const finishedAt = new Date();
  const [finished] = await db.update(cleanup).set({
    pendingAssets,
    mediaRemoved: removed,
    completedAt: pendingAssets.length === 0 ? finishedAt : null,
    nextAttemptAt: new Date(finishedAt.getTime() + Math.min(24 * 60, 2 ** Math.min(claimed.attempts, 10)) * 60_000),
    leaseToken: null,
    leaseExpiresAt: null,
    updatedAt: finishedAt,
  }).where(and(eq(cleanup.id, jobId), eq(cleanup.leaseToken, token))).returning();
  const latest = finished ?? await getSalonDeletionCleanup(jobId);
  return latest ? salonDeletionStatus(latest) : null;
}

export async function cleanupPendingSalonDeletions(): Promise<{ checked: number; completed: number; pending: number }> {
  const now = new Date();
  const due = await db.select({ id: cleanup.id }).from(cleanup).where(and(
    isNull(cleanup.completedAt),
    lte(cleanup.nextAttemptAt, now),
    or(isNull(cleanup.leaseExpiresAt), lte(cleanup.leaseExpiresAt, now)),
    sql`EXISTS (SELECT 1 FROM jsonb_array_elements(${cleanup.pendingAssets}) AS asset WHERE asset->>'kind' <> 'review')`,
  )).orderBy(asc(cleanup.nextAttemptAt)).limit(5);
  let completed = 0;
  for (const job of due) {
    try {
      const status = await runSalonDeletionCleanup(job.id);
      if (status?.status === 'completed') {
        completed += 1;
      }
    } catch {
      // A job's DB/provider failure must not prevent another job being retried.
      console.error('Salon deletion cleanup remains pending');
    }
  }
  return { checked: due.length, completed, pending: due.length - completed };
}
