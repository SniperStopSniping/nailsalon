/**
 * C4 warnings + masking + usage/history proofs — §10.1–§10.5. Warnings fire
 * exactly once per tier per epoch, only move downward within an epoch, reset
 * on grant (epoch bump), and are never SMS. Masking never leaks a full
 * recipient. The usage route folds ledger detail into owner vocabulary and
 * pages history on a compound cursor that survives identical timestamps.
 */
import path from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { NextRequest } from 'next/server';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import * as schema from '@/models/Schema';

vi.mock('server-only', () => ({}));

const holder = vi.hoisted(() => ({ db: null as unknown }));
vi.mock('@/libs/DB', () => ({
  get db() {
    return holder.db;
  },
}));
const envHolder = vi.hoisted(() => ({
  BILLING_PLAN_ENV: 'test',
  BILLING_TOPUPS_ENABLED: undefined as string | undefined,
}));
vi.mock('@/libs/Env', () => ({ Env: envHolder }));
const sendTransactionalEmailDetailed = vi.hoisted(() => vi.fn(async () => ({ sent: true })));
vi.mock('@/libs/email', () => ({ sendTransactionalEmailDetailed }));
vi.mock('@/libs/rateLimit', () => ({
  checkEndpointRateLimit: () => ({ allowed: true }),
  getClientIp: () => '127.0.0.1',
  rateLimitResponse: () => new Response('rate limited', { status: 429 }),
}));

const guardHolder = vi.hoisted(() => ({ salonId: 's_usage' }));
vi.mock('@/libs/adminAuth', () => ({
  requireAdminSalon: vi.fn(async (slug: string) => (
    slug === `slug-${guardHolder.salonId}`
      ? { error: null, salon: { id: guardHolder.salonId } }
      : { error: Response.json({ error: 'FORBIDDEN' }, { status: 403 }), salon: null }
  )),
}));

let db: ReturnType<typeof drizzle<typeof schema>>;

beforeAll(async () => {
  const client = new PGlite();
  db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: path.join(process.cwd(), 'migrations') });
  holder.db = db;
});

async function seedAccount(salonId: string, credits: number, bucket = 'purchased') {
  await db.insert(schema.salonSchema).values({
    id: salonId,
    name: salonId,
    slug: `slug-${salonId}`,
    ownerEmail: `${salonId}@example.com`,
  });
  await db.insert(schema.smsCreditAccountSchema).values({ salonId });
  if (credits > 0) {
    await db.insert(schema.smsCreditLedgerSchema).values({
      id: `lot_${salonId}`,
      salonId,
      entryType: 'grant',
      bucket: bucket as never,
      amount: credits,
      idempotencyKey: `seed:${salonId}`,
      reason: 'seed',
    });
  }
}

describe('masking (§10.4)', () => {
  it('masks phones to last four and emails to first char + domain', async () => {
    const { maskPhone, maskEmail, maskRecipient, friendlyFailureReason } = await import('./communicationMasking');

    expect(maskPhone('4165550199')).toBe('•••• 0199');
    expect(maskPhone('+1 (416) 555-0199')).toBe('•••• 0199');
    expect(maskPhone('12')).toBe('••••');
    expect(maskEmail('client@example.com')).toBe('c•••@example.com');
    expect(maskEmail('nonsense')).toBe('••••');
    expect(maskRecipient('sms', '4165550199')).toBe('•••• 0199');
    // Unknown internal codes NEVER pass through.
    expect(friendlyFailureReason('TWILIO_30007_CARRIER_FILTERED')).toBe('This message could not be delivered.');
    expect(friendlyFailureReason('NO_CREDITS')).toBe('SMS credits were unavailable.');
    expect(friendlyFailureReason('PILOT_NOT_ENABLED')).toBe('This salon is waiting for access to the texting pilot.');
    expect(friendlyFailureReason('PLAN_NOT_ELIGIBLE')).toBe(friendlyFailureReason('PILOT_NOT_ENABLED'));
    expect(friendlyFailureReason(null)).toBeNull();
  });
});

describe('low-balance warnings (§10.3)', () => {
  it.each(['20pct', '0'] as const)('directs the %s warning to credits without requiring a plan upgrade', async (tier) => {
    const { sendLowBalanceWarningEmail } = await import('./lowBalanceWarnings');
    sendTransactionalEmailDetailed.mockClear();
    await sendLowBalanceWarningEmail({
      salonId: 's_warning_copy',
      ownerEmail: 'owner@example.invalid',
      tier,
      availableCredits: tier === '0' ? 0 : 20,
    });

    expect(sendTransactionalEmailDetailed).toHaveBeenCalledOnce();
    expect(sendTransactionalEmailDetailed).toHaveBeenCalledWith(expect.objectContaining({
      to: 'owner@example.invalid',
      text: expect.stringContaining('Usage'),
    }));
    expect(sendTransactionalEmailDetailed).toHaveBeenCalledWith(expect.objectContaining({
      text: expect.not.stringMatching(/upgrade|buy more|email confirmations and reminders continue/i),
    }));
  });

  it('warns exactly once per tier, moves only downward, resets on grant', async () => {
    const { evaluateLowBalanceWarnings } = await import('./lowBalanceWarnings');
    const { appendLotGrant } = await import('./billing/creditLedger');
    await seedAccount('s_warn1', 8); // inside the 10-credit tier
    const emails: Array<{ tier: string }> = [];
    const sendWarningEmail = vi.fn(async (input: { tier: string }) => {
      emails.push({ tier: input.tier });
    });

    const first = await evaluateLowBalanceWarnings({ sendWarningEmail, salonId: 's_warn1' });

    expect(first.warned).toEqual([{ salonId: 's_warn1', tier: '10' }]);

    // Same state re-evaluated: silent (once per tier per epoch).
    const second = await evaluateLowBalanceWarnings({ sendWarningEmail, salonId: 's_warn1' });

    expect(second.warned).toEqual([]);

    // Balance hits zero: the DEEPER tier still warns within the same epoch.
    const { reserveSmsCredits, settleReservationOnAccept } = await import('./billing/creditReservation');
    const reserved = await reserveSmsCredits({ salonId: 's_warn1', dedupeKey: 'warn_spend', segments: 8 });
    await settleReservationOnAccept({
      reservationId: (reserved as { reservationId: string }).reservationId,
      providerSid: 'SM_warn',
    });
    const third = await evaluateLowBalanceWarnings({ sendWarningEmail, salonId: 's_warn1' });

    expect(third.warned).toEqual([{ salonId: 's_warn1', tier: '0' }]);

    // A grant bumps the epoch (appendLotGrant), resetting eligibility…
    await db.transaction(async tx => appendLotGrant(tx, {
      salonId: 's_warn1',
      bucket: 'purchased',
      amount: 5,
      expiresAt: null,
      idempotencyKey: 'warn_regrant',
      reason: 'seed',
    }));
    const fourth = await evaluateLowBalanceWarnings({ sendWarningEmail, salonId: 's_warn1' });

    expect(fourth.warned).toEqual([{ salonId: 's_warn1', tier: '10' }]);
    expect(emails.map(entry => entry.tier)).toEqual(['10', '0', '10']);
    // No SMS was ever part of this: the sender is email-only by construction.
  });
});

describe('usage + history route (§10.1/§10.2/§10.4)', () => {
  beforeEach(() => {
    envHolder.BILLING_TOPUPS_ENABLED = undefined;
    guardHolder.salonId = 's_usage';
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const get = async (query: string) => {
    const { GET } = await import('../app/api/admin/salon/communications/usage/route');
    return GET(new NextRequest(`http://localhost/api/admin/salon/communications/usage${query}`));
  };

  it('serves owner-vocabulary balances, masked history and a working compound cursor', async () => {
    await seedAccount('s_usage', 40);
    // Three intents sharing ONE timestamp — the compound cursor's hard case.
    const at = new Date('2026-09-01T12:00:00.000Z');
    for (const n of [1, 2, 3]) {
      await db.insert(schema.communicationIntentSchema).values({
        id: `ci_u${n}`,
        salonId: 's_usage',
        channel: 'sms',
        eventType: 'booking_confirmation',
        audience: 'client',
        dedupeKey: `u:${n}`,
        recipient: '4165550199',
        templateKey: 'client_booking_confirmation_shortlink',
        templateVersion: 'v1',
        variables: {},
        schedulingRevision: 'rev',
        status: n === 3 ? 'blocked_no_credit' : 'sent',
        blockedReason: n === 3 ? 'NO_CREDITS' : null,
        scheduledFor: at,
        notAfter: new Date(at.getTime() + 3600_000),
        resolvedAt: at,
        segmentCount: 1,
        createdAt: at,
      });
    }

    const response = await get('?salonSlug=slug-s_usage');

    expect(response.headers.get('Cache-Control')).toBe('no-store');

    const { data } = await response.json();

    expect(data.usage).toMatchObject({
      availableCredits: 40,
      purchasedCredits: 40,
      monthlyCredits: 0,
      blockedMessages: 1,
    });
    expect(data.history).toHaveLength(3);
    // Masked, never raw.
    expect(data.history[0].recipient).toBe('•••• 0199');
    expect(JSON.stringify(data)).not.toContain('4165550199');

    const blocked = data.history.find((entry: { status: string }) => entry.status === 'blocked_no_credit');

    expect(blocked.failureReason).toBe('SMS credits were unavailable.');
  });

  it('pages through identical timestamps without skipping or repeating', async () => {
    // PAGE_SIZE is 25: seed 30 rows at ONE instant.
    await db.insert(schema.salonSchema).values({
      id: 's_page',
      name: 's_page',
      slug: 'slug-s_page',
    });
    guardHolder.salonId = 's_page';
    const at = new Date('2026-09-02T12:00:00.000Z');
    for (let n = 0; n < 30; n += 1) {
      await db.insert(schema.communicationIntentSchema).values({
        id: `ci_p${String(n).padStart(2, '0')}`,
        salonId: 's_page',
        channel: 'email',
        eventType: 'appointment_reminder',
        audience: 'client',
        dedupeKey: `p:${n}`,
        recipient: 'client@example.com',
        templateKey: 'email_appointment_reminder',
        templateVersion: 'v1',
        variables: {},
        schedulingRevision: 'rev',
        status: 'pending',
        scheduledFor: at,
        notAfter: new Date(at.getTime() + 3600_000),
        createdAt: at,
      });
    }
    const first = await get('?salonSlug=slug-s_page');
    const firstBody = (await first.json()).data;

    expect(firstBody.history).toHaveLength(25);
    expect(firstBody.nextCursor).not.toBeNull();

    const second = await get(`?salonSlug=slug-s_page&cursor=${firstBody.nextCursor}`);
    const secondBody = (await second.json()).data;

    expect(secondBody.history).toHaveLength(5);
    expect(secondBody.nextCursor).toBeNull();

    const seen = new Set([...firstBody.history, ...secondBody.history].map((entry: { id: string }) => entry.id));

    expect(seen.size).toBe(30);
  });

  it('a foreign slug is refused by the tenant guard', async () => {
    envHolder.BILLING_TOPUPS_ENABLED = 'true';
    const priceMap = await import('./billing/stripePriceMap');
    const priceResolver = vi.spyOn(priceMap, 'resolveStripePriceIdForTopup');
    const response = await get('?salonSlug=slug-someone-else');

    expect(response.status).toBe(403);
    expect(priceResolver).not.toHaveBeenCalled();
  });

  it.each([undefined, 'false'])('does not offer credit purchases when the billing flag is %s', async (flag) => {
    envHolder.BILLING_TOPUPS_ENABLED = flag;
    const priceMap = await import('./billing/stripePriceMap');
    const priceResolver = vi.spyOn(priceMap, 'resolveStripePriceIdForTopup')
      .mockReturnValue('price_configured_fixture');
    const { data } = await (await get('?salonSlug=slug-s_usage')).json();

    expect(data.creditPurchasesAvailable).toBe(false);
    expect(data.topupOffers).toEqual([]);
    expect(data.usage.availableCredits).toBe(40);
    expect(data.history).toHaveLength(3);
    expect(priceResolver).not.toHaveBeenCalled();
  });

  it('keeps credit purchases unavailable when billing is enabled but prices are unconfigured', async () => {
    envHolder.BILLING_TOPUPS_ENABLED = 'true';
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Provider requests are forbidden'));
    const { data } = await (await get('?salonSlug=slug-s_usage')).json();

    expect(data.creditPurchasesAvailable).toBe(false);
    expect(data.topupOffers).toEqual([]);
    expect(data.usage.availableCredits).toBe(40);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('offers only configured prices for the authorized salon audience without exposing Stripe IDs', async () => {
    envHolder.BILLING_TOPUPS_ENABLED = 'true';
    const priceMap = await import('./billing/stripePriceMap');
    const priceResolver = vi.spyOn(priceMap, 'resolveStripePriceIdForTopup').mockImplementation((key) => {
      if (key === 'topup_100_free_2026_08') {
        return 'price_configured_fixture';
      }
      throw new priceMap.BillingCatalogError('PRICE_UNCONFIGURED', key);
    });
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Provider requests are forbidden'));
    const { data } = await (await get('?salonSlug=slug-s_usage')).json();

    expect(data.creditPurchasesAvailable).toBe(true);
    expect(data.topupOffers).toEqual([{ key: 'topup_100_free_2026_08', credits: 100, priceCents: 699 }]);
    expect(priceResolver.mock.calls.every(([key]) => key.includes('_free_'))).toBe(true);
    expect(JSON.stringify(data)).not.toContain('price_configured_fixture');
    expect(data.usage.availableCredits).toBe(40);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('shows actual delivery outcomes and never attributes another salon delivery or BYO credits', async () => {
    await seedAccount('s_delivery_health', 10);
    guardHolder.salonId = 's_delivery_health';
    const at = new Date('2026-09-03T12:00:00.000Z');
    for (const [name, status, settlementState, salonId] of [
      ['delivered', 'delivered', 'settled', 's_delivery_health'],
      ['byo', 'sent', 'not_applicable', 's_delivery_health'],
      ['failed', 'undelivered', 'refunded', 's_delivery_health'],
      ['foreign', 'delivered', 'settled', 's_usage'],
    ]) {
      await db.insert(schema.notificationDeliverySchema).values({
        id: `nd_health_${name}`,
        salonId: salonId!,
        channel: 'sms',
        purpose: 'manual_text',
        dedupeKey: `nd-health:${name}`,
        status,
        settlementState,
        segmentCount: 2,
        errorCode: status === 'undelivered' ? '30007' : null,
        errorMessage: 'Provider body containing private fixture data',
      });
      await db.insert(schema.communicationIntentSchema).values({
        id: `ci_health_${name}`,
        salonId: 's_delivery_health',
        channel: 'sms',
        eventType: 'manual_text',
        audience: 'client',
        dedupeKey: `history-health:${name}`,
        recipient: '+14165550199',
        templateKey: 'client_manual_text',
        templateVersion: 'v1',
        variables: {},
        schedulingRevision: 'health',
        status: 'sent',
        scheduledFor: at,
        notAfter: new Date(at.getTime() + 3600_000),
        deliveryId: `nd_health_${name}`,
        segmentCount: 2,
      });
    }
    const { data } = await (await get('?salonSlug=slug-s_delivery_health')).json();

    expect(data.history.find((entry: { id: string }) => entry.id === 'ci_health_delivered')).toMatchObject({ status: 'delivered', creditsUsed: 2 });
    expect(data.history.find((entry: { id: string }) => entry.id === 'ci_health_byo')).toMatchObject({ status: 'sent', creditsUsed: 0 });
    expect(data.history.find((entry: { id: string }) => entry.id === 'ci_health_failed')).toMatchObject({ status: 'undelivered', creditsUsed: 0, failureReason: 'This message could not be delivered.' });
    expect(data.history.find((entry: { id: string }) => entry.id === 'ci_health_foreign')).toMatchObject({ status: 'sent', creditsUsed: 0 });
    expect(JSON.stringify(data)).not.toContain('private fixture data');
  });
});
