import 'server-only';

import { and, desc, eq, inArray } from 'drizzle-orm';

import { type DatabaseSessionHandle, db } from '@/libs/DB';
import { type SalonAuditLogDatabase, writeSalonAuditRow } from '@/libs/salonAuditLog.server';
import { salonAuditLogSchema } from '@/models/Schema';

import {
  type FeedbackListItem,
  OWNER_ASSISTANT_FEEDBACK_ACTION,
  OWNER_ASSISTANT_FEEDBACK_LIMITS,
  OWNER_ASSISTANT_FEEDBACK_WITHDRAWN_ACTION,
  type OwnerAssistantFeedbackCardKind,
  type OwnerAssistantFeedbackKind,
  type OwnerAssistantFeedbackReasonCode,
} from './contracts';

/**
 * Owner feedback on an assistant turn (A1-4b).
 *
 * Storage is the SAME durable surface as the turn ledger (`ledger.server.ts`):
 * one `salon_audit_log` row per event, written through `writeSalonAuditRow` so
 * `sanitizeAuditMetadata` always runs. No new table, no migration — a rating is
 * evidence about a turn, and the turn's evidence already lives here.
 *
 * What a row may contain:
 *  - always: the client-generated `feedbackId`, the `kind`, and the two
 *    correlation keys the ledger row already carries (`conversationId`,
 *    `turnIndex`) so a rating joins to the turn it rates;
 *  - `report` only: the owner's OWN typed sentence, trimmed and capped at
 *    {@link OWNER_ASSISTANT_FEEDBACK_LIMITS.textMaxChars}.
 *
 * What a row may NEVER contain: the transcript, the model's words, any tool
 * result, anything about a client of the salon. Ratings carry no free text at
 * all — {@link recordOwnerAssistantFeedback} drops it rather than trusting a
 * caller, and the route's zod schema refuses it a layer earlier.
 *
 * KEY NAMING IS LOAD-BEARING (same rule as the ledger): `sanitizeAuditMetadata`
 * redacts any key whose name contains `token`, `session`, `url`, `uri`, `link`,
 * `secret`, `cookie`, `credential`, `authorization`, `password` or `passcode`.
 * Every key written here is checked against that list by a test.
 *
 * IDEMPOTENCE. There is deliberately NO unique index on `salon_audit_log`
 * (adding one would need a migration, and this slice adds none), so a retry
 * with the same `feedbackId` writes a SECOND row. That is safe because the
 * READER de-duplicates: {@link listOwnerAssistantFeedback} keeps the newest row
 * per `feedbackId`. Anything counting these rows later must do the same.
 */

/** A handle that can read rows back — the reader's counterpart to `SalonAuditLogDatabase`. */
export type OwnerAssistantFeedbackReadDatabase = Pick<DatabaseSessionHandle, 'select'>;

export type RecordOwnerAssistantFeedbackArgs = {
  salonId: string;
  /** Clerk user id of the owner who gave the feedback. */
  performedBy: string;
  /** Client-generated, url-safe, opaque. A retry re-sends the same one. */
  feedbackId: string;
  kind: OwnerAssistantFeedbackKind;
  /** Correlation only; the conversation itself is never sent or stored. */
  conversationId?: string;
  turnIndex?: number;
  cardKind?: OwnerAssistantFeedbackCardKind;
  reasonCodes?: readonly OwnerAssistantFeedbackReasonCode[];
  /** Owner-typed note. Accepted for `report` only; ignored for a rating. */
  text?: string;
  database?: SalonAuditLogDatabase;
};

export type RecordOwnerAssistantFeedbackWithdrawalArgs = {
  salonId: string;
  performedBy: string;
  /** The id of the feedback being withdrawn. */
  feedbackId: string;
  conversationId?: string;
  turnIndex?: number;
  database?: SalonAuditLogDatabase;
};

/**
 * The structured payload under `metadata.newValue`.
 *
 * Optional keys are OMITTED rather than written as null so a reader can tell
 * "the client did not know the conversation id" from "the conversation id was
 * empty". `reasonCodes` is always present (possibly empty) because a missing
 * array and an empty one mean the same thing for counting.
 */
type FeedbackPayload = {
  feedbackId: string;
  kind: OwnerAssistantFeedbackKind;
  conversationId?: string;
  turnIndex?: number;
  cardKind?: OwnerAssistantFeedbackCardKind;
  reasonCodes: OwnerAssistantFeedbackReasonCode[];
  /** Owner's own words on a `report`; null on every rating. */
  ownerText: string | null;
  /** Length of `ownerText`, so a reader can count without reading. */
  ownerTextChars: number;
};

/**
 * Trim, drop empties, cap. Returns null when there is nothing to store, so a
 * report whose text is whitespace is recorded as a report with no text rather
 * than as a report with `''`.
 */
function normalizeOwnerText(text: string | undefined): string | null {
  const trimmed = (text ?? '').trim();
  if (trimmed.length === 0) {
    return null;
  }
  return trimmed.slice(0, OWNER_ASSISTANT_FEEDBACK_LIMITS.textMaxChars);
}

export async function recordOwnerAssistantFeedback(
  args: RecordOwnerAssistantFeedbackArgs,
): Promise<void> {
  // A rating is a rating. Even if a caller hands us text, it never reaches the
  // row: the vocabulary of `up`/`down` is the whole signal.
  const ownerText = args.kind === 'report' ? normalizeOwnerText(args.text) : null;

  const payload: FeedbackPayload = {
    feedbackId: args.feedbackId,
    kind: args.kind,
    ...(args.conversationId ? { conversationId: args.conversationId } : {}),
    ...(typeof args.turnIndex === 'number' ? { turnIndex: args.turnIndex } : {}),
    ...(args.cardKind ? { cardKind: args.cardKind } : {}),
    reasonCodes: [...(args.reasonCodes ?? [])],
    ownerText,
    ownerTextChars: ownerText?.length ?? 0,
  };

  await writeSalonAuditRow(args.database ?? db, {
    salonId: args.salonId,
    action: OWNER_ASSISTANT_FEEDBACK_ACTION,
    performedBy: args.performedBy,
    performedByEmail: null,
    metadata: {
      field: 'owner_assistant_feedback',
      details: 'Owner assistant feedback',
      newValue: payload,
    },
  });
}

/**
 * Withdrawal is its own row carrying the SAME `feedbackId`; the original row is
 * never edited or deleted, because an evidence trail you can rewrite is not
 * one. The reader joins the two and reports `withdrawn: true`.
 *
 * A withdrawal never carries text, not even when the feedback it withdraws did.
 */
export async function recordOwnerAssistantFeedbackWithdrawal(
  args: RecordOwnerAssistantFeedbackWithdrawalArgs,
): Promise<void> {
  await writeSalonAuditRow(args.database ?? db, {
    salonId: args.salonId,
    action: OWNER_ASSISTANT_FEEDBACK_WITHDRAWN_ACTION,
    performedBy: args.performedBy,
    performedByEmail: null,
    metadata: {
      field: 'owner_assistant_feedback',
      details: 'Owner assistant feedback withdrawn',
      newValue: {
        feedbackId: args.feedbackId,
        ...(args.conversationId ? { conversationId: args.conversationId } : {}),
        ...(typeof args.turnIndex === 'number' ? { turnIndex: args.turnIndex } : {}),
      },
    },
  });
}

type StoredPayload = Partial<FeedbackPayload> & Record<string, unknown>;

function readPayload(metadata: unknown): StoredPayload | null {
  if (!metadata || typeof metadata !== 'object') {
    return null;
  }
  const value = (metadata as { newValue?: unknown }).newValue;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return value as StoredPayload;
}

export type ListOwnerAssistantFeedbackArgs = {
  salonId: string;
  /** Only rows this actor wrote are returned. */
  performedBy: string;
  limit?: number;
  database?: OwnerAssistantFeedbackReadDatabase;
};

/**
 * The requesting owner's OWN feedback rows, newest first.
 *
 * The query filters on the two indexed columns (`salon_id`, `action`); the
 * actor filter and the de-duplication happen in code, over a bounded scan
 * window ({@link OWNER_ASSISTANT_FEEDBACK_LIMITS.scanMax}). That window is the
 * honest limitation of this reader: a salon whose owners together wrote more
 * than `scanMax` rows can hide one owner's oldest rows from this list. It never
 * shows a row this owner did not write, which is the property that matters.
 *
 * No owner text is returned. The list exists so a client can tell which turns
 * it has already rated, not so feedback can be read back through the API.
 */
export async function listOwnerAssistantFeedback(
  args: ListOwnerAssistantFeedbackArgs,
): Promise<FeedbackListItem[]> {
  const database = args.database ?? db;
  const limit = Math.max(1, Math.min(args.limit ?? OWNER_ASSISTANT_FEEDBACK_LIMITS.listMax, OWNER_ASSISTANT_FEEDBACK_LIMITS.listMax));

  const rows = await database
    .select({
      action: salonAuditLogSchema.action,
      performedBy: salonAuditLogSchema.performedBy,
      metadata: salonAuditLogSchema.metadata,
      createdAt: salonAuditLogSchema.createdAt,
    })
    .from(salonAuditLogSchema)
    .where(and(
      eq(salonAuditLogSchema.salonId, args.salonId),
      inArray(salonAuditLogSchema.action, [
        OWNER_ASSISTANT_FEEDBACK_ACTION,
        OWNER_ASSISTANT_FEEDBACK_WITHDRAWN_ACTION,
      ]),
    ))
    .orderBy(desc(salonAuditLogSchema.createdAt))
    .limit(OWNER_ASSISTANT_FEEDBACK_LIMITS.scanMax);

  const withdrawnIds = new Set<string>();
  const newestByFeedbackId = new Map<string, FeedbackListItem>();

  for (const row of rows) {
    // Another owner of the same salon writes rows into the same table; this is
    // the filter that keeps the list to the requester's own feedback.
    if (row.performedBy !== args.performedBy) {
      continue;
    }
    const payload = readPayload(row.metadata);
    const feedbackId = typeof payload?.feedbackId === 'string' ? payload.feedbackId : null;
    if (!feedbackId) {
      continue;
    }

    if (row.action === OWNER_ASSISTANT_FEEDBACK_WITHDRAWN_ACTION) {
      withdrawnIds.add(feedbackId);
      continue;
    }

    // Rows arrive newest first, so the FIRST row for an id is the one a retry
    // (or a changed mind) should win with; later duplicates are dropped.
    if (newestByFeedbackId.has(feedbackId)) {
      continue;
    }
    const kind = payload?.kind;
    if (kind !== 'up' && kind !== 'down' && kind !== 'report') {
      continue;
    }
    newestByFeedbackId.set(feedbackId, {
      feedbackId,
      kind,
      createdAt: row.createdAt.toISOString(),
      withdrawn: false,
    });
  }

  return [...newestByFeedbackId.values()]
    .map(item => (withdrawnIds.has(item.feedbackId) ? { ...item, withdrawn: true } : item))
    .slice(0, limit);
}
