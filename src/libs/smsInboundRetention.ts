/**
 * Inbound-evidence retention — the 90-day sweep (contract §10.7). Rides the
 * dispatcher cron; deletes only sms_inbound_event rows (which never contain
 * message bodies). Global consent events are NEVER swept — opt-out evidence
 * is permanent.
 */

import 'server-only';

import { lt } from 'drizzle-orm';

import { db } from '@/libs/DB';
import { smsInboundEventSchema } from '@/models/Schema';

export const INBOUND_RETENTION_DAYS = 90;

export async function releaseExpiredInboundEvidence(now = new Date()): Promise<{ purged: number }> {
  const horizon = new Date(now.getTime() - INBOUND_RETENTION_DAYS * 24 * 60 * 60 * 1000);
  const deleted = await db
    .delete(smsInboundEventSchema)
    .where(lt(smsInboundEventSchema.receivedAt, horizon))
    .returning();
  return { purged: deleted.length };
}
