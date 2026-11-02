import 'server-only';

import { and, asc, eq, inArray, isNull, lt, sql } from 'drizzle-orm';

import { db } from '@/libs/DB';
import { danielaAutomationStateSchema as states, danielaContactSchema as contacts, danielaInboundSchema as events, danielaSendSchema as sends, salonSchema } from '@/models/Schema';

import type { DanielaConfig } from './config';
import { BOOKING_COOLDOWN_MS, campaignSlot, DANIELA_SALON_SLUG, inboundKeyword, normalizePhone } from './policy';

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
export type Contact = typeof contacts.$inferSelect;
export type Send = typeof sends.$inferSelect;
export type ImportedContact = {
  phone: string;
  blocked: boolean;
  optedOut: boolean;
  campaignEligible: boolean;
  rowOrder: number;
  lastBookingAt: Date | null;
  promoAttemptedAt: Date | null;
  promoAcceptedAt: Date | null;
  lastInboundAt: Date | null;
  lastMessage: string | null;
  lastInboundSid: string | null;
};

async function locked<T>(config: DanielaConfig, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    const [salon] = await tx.select({ id: salonSchema.id }).from(salonSchema).where(and(
      eq(salonSchema.id, config.salonId),
      eq(salonSchema.slug, DANIELA_SALON_SLUG),
      eq(salonSchema.isActive, true),
    )).limit(1);
    if (!salon) {
      throw new Error('DANIELA_SALON_NOT_AVAILABLE');
    }
    await tx.insert(states).values({ salonId: salon.id }).onConflictDoNothing();
    // Serialize admission/claims across functions and database connections.
    await tx.select().from(states).where(eq(states.salonId, salon.id)).for('update');
    return fn(tx);
  });
}

const contactWhere = (salonId: string, phone: string) => and(eq(contacts.salonId, salonId), eq(contacts.phone, phone));
const later = (a: Date | null, b: Date | null) => !a ? b : !b ? a : a > b ? a : b;

export async function importContacts(config: DanielaConfig, rows: ImportedContact[], now = new Date()): Promise<number> {
  return locked(config, async (tx) => {
    await tx.update(contacts).set({ campaignEligible: false }).where(eq(contacts.salonId, config.salonId));
    const values = rows.map((row) => {
      const phone = normalizePhone(row.phone);
      if (!phone) {
        throw new Error('INVALID_IMPORT_PHONE');
      }
      return {
        salonId: config.salonId,
        phone,
        blocked: row.blocked,
        providerOptOut: row.optedOut,
        campaignEligible: row.campaignEligible,
        rowOrder: row.rowOrder,
        lastBookingAt: row.lastBookingAt,
        promoAttemptedAt: row.promoAttemptedAt,
        promoAcceptedAt: row.promoAcceptedAt,
        lastInboundAt: row.lastInboundAt,
        lastMessage: row.lastMessage,
        lastInboundSid: row.lastInboundSid,
      };
    });
    for (let offset = 0; offset < values.length; offset += 500) {
      await tx.insert(contacts).values(values.slice(offset, offset + 500)).onConflictDoUpdate({
        target: [contacts.salonId, contacts.phone],
        set: {
          blocked: sql`${contacts.blocked} OR excluded.blocked`,
          providerOptOut: sql`CASE WHEN ${contacts.consentUpdatedAt} IS NOT NULL THEN ${contacts.providerOptOut} ELSE ${contacts.providerOptOut} OR excluded.provider_opt_out END`,
          campaignEligible: sql`excluded.campaign_eligible AND NOT ${contacts.inboundOnly}`,
          rowOrder: sql`excluded.row_order`,
          lastBookingAt: sql`GREATEST(${contacts.lastBookingAt}, excluded.last_booking_at)`,
          promoAttemptedAt: sql`COALESCE(${contacts.promoAttemptedAt}, excluded.promo_attempted_at)`,
          promoAcceptedAt: sql`GREATEST(${contacts.promoAcceptedAt}, excluded.promo_accepted_at)`,
          lastInboundAt: sql`GREATEST(${contacts.lastInboundAt}, excluded.last_inbound_at)`,
          lastMessage: sql`CASE WHEN excluded.last_inbound_at > COALESCE(${contacts.lastInboundAt}, '-infinity'::timestamptz) THEN excluded.last_message ELSE ${contacts.lastMessage} END`,
          lastInboundSid: sql`CASE WHEN excluded.last_inbound_at > COALESCE(${contacts.lastInboundAt}, '-infinity'::timestamptz) THEN excluded.last_inbound_sid ELSE ${contacts.lastInboundSid} END`,
        },
      });
    }
    await tx.update(states).set({ importedAt: now, lastSheetReadAt: now }).where(eq(states.salonId, config.salonId));
    return rows.length;
  });
}

export async function recordInbound(config: DanielaConfig, input: {
  kind: 'sms' | 'call';
  providerSid: string;
  from: string;
  body: string;
  optOutType?: string;
}, now = new Date()): Promise<string> {
  return locked(config, async (tx) => {
    const [state] = await tx.select().from(states).where(eq(states.salonId, config.salonId));
    if (config.mode === 'live' && !state?.importedAt) {
      throw new Error('DANIELA_MIGRATION_REQUIRED');
    }
    const phone = normalizePhone(input.from);
    const id = `di_${config.accountSid}_${input.kind}_${input.providerSid}`;
    const inserted = await tx.insert(events).values({
      id,
      salonId: config.salonId,
      providerSid: input.providerSid,
      kind: input.kind,
      phone,
      body: input.kind === 'sms' ? input.body.slice(0, 4000) : null,
      outcome: 'received',
      receivedAt: now,
    }).onConflictDoNothing().returning();
    if (inserted.length === 0) {
      return 'duplicate';
    }
    let outcome = 'invalid_number';
    if (phone) {
      await tx.insert(contacts).values({ salonId: config.salonId, phone, inboundOnly: true }).onConflictDoNothing();
      const keyword = input.kind === 'sms' ? inboundKeyword(input.body, input.optOutType) : 'other';
      await tx.update(contacts).set({
        lastInboundAt: now,
        lastInboundSid: input.providerSid,
        lastSource: input.kind,
        lastMessage: input.kind === 'sms' ? input.body.slice(0, 4000) : '(Incoming call)',
        sheetDirty: true,
        updatedAt: now,
        ...(['stop', 'start'].includes(keyword) ? { providerOptOut: keyword === 'stop', consentUpdatedAt: now } : {}),
      }).where(contactWhere(config.salonId, phone));
      const [contact] = await tx.select().from(contacts).where(contactWhere(config.salonId, phone));
      if (keyword !== 'other') {
        outcome = keyword;
      } else if (contact!.blocked || contact!.providerOptOut || config.blockedPhones.includes(phone)) {
        outcome = 'blocked';
      } else {
        const pending = await tx.select({ id: sends.id }).from(sends).where(and(
          eq(sends.salonId, config.salonId),
          eq(sends.phone, phone),
          eq(sends.purpose, 'booking'),
          inArray(sends.state, ['pending', 'sending', 'unknown']),
        )).limit(1);
        const coolingDown = contact!.lastBookingAt && now.getTime() - contact!.lastBookingAt.getTime() < BOOKING_COOLDOWN_MS;
        if (pending.length || coolingDown) {
          outcome = 'cooldown';
        } else {
          await tx.insert(sends).values({ id: `ds_${id}`, salonId: config.salonId, phone, purpose: 'booking', body: config.bookingMessage, createdAt: now });
          outcome = 'queued';
        }
      }
    }
    await tx.update(events).set({ outcome }).where(eq(events.id, id));
    return outcome;
  });
}

export async function queueCampaign(config: DanielaConfig, now = new Date()): Promise<boolean> {
  const slot = campaignSlot(now);
  if (!slot || !config.campaignEnabled) {
    return false;
  }
  return locked(config, async (tx) => {
    const [state] = await tx.select().from(states).where(eq(states.salonId, config.salonId));
    // A fresh successful Sheets read preserves owner-managed suppressions and row order.
    if (!state?.importedAt || !state.lastSheetReadAt || now.getTime() - state.lastSheetReadAt.getTime() > 5 * 60_000) {
      return false;
    }
    const existing = await tx.select({ id: sends.id }).from(sends).where(and(eq(sends.salonId, config.salonId), eq(sends.slot, slot))).limit(1);
    if (existing.length) {
      return false;
    }
    const candidates = await tx.select().from(contacts).where(and(
      eq(contacts.salonId, config.salonId),
      eq(contacts.campaignEligible, true),
      eq(contacts.blocked, false),
      eq(contacts.providerOptOut, false),
      isNull(contacts.promoAttemptedAt),
      isNull(contacts.promoAcceptedAt),
    )).orderBy(asc(contacts.rowOrder), asc(contacts.phone));
    candidates.sort((a, b) => {
      const rank = (p: string) => {
        const i = config.preferredPhones.indexOf(p);
        return i < 0 ? 100 : i;
      };
      return rank(a.phone) - rank(b.phone);
    });
    const contact = candidates.find(c => !config.blockedPhones.includes(c.phone));
    if (!contact) {
      return false;
    }
    await tx.insert(sends).values({ id: `ds_${crypto.randomUUID()}`, salonId: config.salonId, phone: contact.phone, purpose: 'promo', body: config.promoMessage, slot, createdAt: now });
    if (config.mode === 'live') {
      await tx.update(contacts).set({ promoAttemptedAt: now, sheetDirty: true, updatedAt: now }).where(contactWhere(config.salonId, contact.phone));
    }
    return true;
  });
}

export async function claimSend(config: DanielaConfig, now = new Date()): Promise<Send | null> {
  return locked(config, async (tx) => {
    // An expired attempt may have reached Twilio; never put it back in pending.
    await tx.update(sends).set({ state: 'unknown', errorCode: 'WORKER_INTERRUPTED' }).where(and(
      eq(sends.salonId, config.salonId),
      eq(sends.state, 'sending'),
      lt(sends.attemptedAt, new Date(now.getTime() - 120_000)),
    ));
    const [item] = await tx.select().from(sends).where(and(eq(sends.salonId, config.salonId), eq(sends.state, 'pending'))).orderBy(asc(sends.createdAt)).limit(1);
    if (!item) {
      return null;
    }
    const [contact] = await tx.select().from(contacts).where(contactWhere(config.salonId, item.phone));
    const suppressed = !contact || contact.blocked || contact.providerOptOut || config.blockedPhones.includes(item.phone)
      || (item.purpose === 'promo' && (!config.campaignEnabled || !contact.campaignEligible));
    const expired = now.getTime() - item.createdAt.getTime() > (item.purpose === 'promo' ? 5 * 60_000 : 15 * 60_000);
    if (suppressed || expired) {
      await tx.update(sends).set({ state: 'suppressed', errorCode: expired ? 'EXPIRED' : 'SUPPRESSED' }).where(eq(sends.id, item.id));
      return null;
    }
    if (config.mode === 'shadow') {
      await tx.update(sends).set({ state: 'shadow' }).where(eq(sends.id, item.id));
      return null;
    }
    const [claimed] = await tx.update(sends).set({ state: 'sending', attemptedAt: now }).where(and(eq(sends.id, item.id), eq(sends.state, 'pending'))).returning();
    return claimed || null;
  });
}

export async function finishSend(config: DanielaConfig, item: Send, result: { sid?: string; errorCode?: string; unknown?: boolean }, now = new Date()): Promise<void> {
  await locked(config, async (tx) => {
    const [current] = await tx.select().from(sends).where(and(eq(sends.id, item.id), eq(sends.salonId, config.salonId)));
    if (!current || ['delivered', 'failed', 'suppressed'].includes(current.state)
      || (current.providerSid && (!result.sid || current.providerSid !== result.sid))) {
      return;
    }
    const accepted = Boolean(result.sid);
    const state = accepted ? 'accepted' : result.unknown ? 'unknown' : 'failed';
    await tx.update(sends).set({ state, providerSid: result.sid || current.providerSid, errorCode: result.errorCode || null, ...(accepted ? { acceptedAt: now } : {}) }).where(eq(sends.id, item.id));
    if (accepted) {
      await tx.update(contacts).set({
        ...(item.purpose === 'booking' ? { lastBookingAt: now } : { promoAcceptedAt: now }),
        sheetDirty: true,
        updatedAt: now,
      }).where(contactWhere(config.salonId, item.phone));
    }
    if (result.errorCode === '21610') {
      await tx.update(contacts).set({ providerOptOut: true, consentUpdatedAt: now, sheetDirty: true, updatedAt: now }).where(contactWhere(config.salonId, item.phone));
    }
  });
}

export async function recordStatus(config: DanielaConfig, id: string, params: Record<string, string>, now = new Date()): Promise<boolean> {
  return locked(config, async (tx) => {
    const [item] = await tx.select().from(sends).where(and(eq(sends.id, id), eq(sends.salonId, config.salonId)));
    if (!item || params.To !== item.phone || params.From !== config.fromNumber
      || (item.providerSid && item.providerSid !== params.MessageSid) || !item.attemptedAt) {
      return false;
    }
    const status = params.MessageStatus || params.SmsStatus;
    const failed = ['failed', 'undelivered', 'canceled'].includes(status || '');
    const accepted = ['accepted', 'queued', 'sending', 'sent', 'delivered', 'read'].includes(status || '');
    if (!accepted && !failed) {
      return true;
    }
    if (item.state === 'delivered' || (item.state === 'failed' && status !== 'delivered' && status !== 'read')) {
      return true;
    }
    const terminal = status === 'delivered' || status === 'read' ? 'delivered' : failed ? 'failed' : 'accepted';
    await tx.update(sends).set({ state: terminal, providerSid: params.MessageSid, acceptedAt: item.acceptedAt || now, errorCode: failed ? params.ErrorCode || 'DELIVERY_FAILED' : null }).where(eq(sends.id, id));
    // Even undelivered means Twilio accepted an attempt; keep the reply cooldown.
    await tx.update(contacts).set({
      ...(item.purpose === 'booking' ? { lastBookingAt: later(item.acceptedAt || now, (await tx.select().from(contacts).where(contactWhere(config.salonId, item.phone)))[0]!.lastBookingAt) } : { promoAcceptedAt: item.acceptedAt || now }),
      ...(params.ErrorCode === '21610' ? { providerOptOut: true, consentUpdatedAt: now } : {}),
      sheetDirty: true,
      updatedAt: now,
    }).where(contactWhere(config.salonId, item.phone));
    return true;
  });
}

export async function dirtyContacts(config: DanielaConfig): Promise<Contact[]> {
  return locked(config, tx => tx.select().from(contacts).where(and(eq(contacts.salonId, config.salonId), eq(contacts.sheetDirty, true))).limit(25));
}

export async function markContactSynced(config: DanielaConfig, contact: Contact): Promise<void> {
  await db.update(contacts).set({ sheetDirty: false }).where(and(contactWhere(config.salonId, contact.phone), eq(contacts.updatedAt, contact.updatedAt)));
}

export async function claimAlert(config: DanielaConfig, now = new Date()): Promise<typeof events.$inferSelect | null> {
  return locked(config, async (tx) => {
    await tx.update(events).set({ telegramState: 'uncertain' }).where(and(eq(events.salonId, config.salonId), eq(events.telegramState, 'sending'), lt(events.telegramAttemptedAt, new Date(now.getTime() - 120_000))));
    const [event] = await tx.select().from(events).where(and(eq(events.salonId, config.salonId), eq(events.telegramState, 'pending'))).orderBy(asc(events.receivedAt)).limit(1);
    if (!event) {
      return null;
    }
    await tx.update(events).set({ telegramState: 'sending', telegramAttemptedAt: now }).where(eq(events.id, event.id));
    const [reply] = await tx.select({ state: sends.state }).from(sends).where(and(eq(sends.id, `ds_${event.id}`), eq(sends.salonId, config.salonId))).limit(1);
    return { ...event, outcome: reply ? reply.state === 'accepted' ? 'accepted by Twilio' : reply.state : event.outcome };
  });
}

export async function finishAlert(config: DanielaConfig, id: string, sent: boolean): Promise<void> {
  await db.update(events).set({ telegramState: sent ? 'sent' : 'uncertain' }).where(and(eq(events.id, id), eq(events.salonId, config.salonId), eq(events.telegramState, 'sending')));
}

export async function scrubOldBodies(config: DanielaConfig, now = new Date()): Promise<void> {
  const horizon = new Date(now.getTime() - 90 * 86400_000);
  await db.update(events).set({ body: null }).where(and(eq(events.salonId, config.salonId), lt(events.receivedAt, horizon)));
  await db.update(contacts).set({ lastMessage: null }).where(and(eq(contacts.salonId, config.salonId), lt(contacts.lastInboundAt, horizon)));
  // Preserve dedupe, campaign attempts, and consent evidence permanently.
  await db.update(sends).set({ body: '' }).where(and(eq(sends.salonId, config.salonId), lt(sends.createdAt, horizon), inArray(sends.state, ['accepted', 'delivered', 'failed', 'suppressed', 'shadow'])));
}

export async function acquireWorker(config: DanielaConfig, token: string, now = new Date()): Promise<boolean> {
  return locked(config, async (tx) => {
    const [state] = await tx.select().from(states).where(eq(states.salonId, config.salonId));
    if (state?.workerExpiresAt && state.workerExpiresAt > now) {
      return false;
    }
    await tx.update(states).set({ workerToken: token, workerExpiresAt: new Date(now.getTime() + 150_000) }).where(eq(states.salonId, config.salonId));
    return true;
  });
}

export async function releaseWorker(config: DanielaConfig, token: string): Promise<void> {
  await db.update(states).set({ workerToken: null, workerExpiresAt: null }).where(and(eq(states.salonId, config.salonId), eq(states.workerToken, token)));
}
