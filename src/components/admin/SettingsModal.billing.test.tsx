/**
 * Billing plan cards — Gate C2 drift pin. The client component cannot import
 * the server-only catalogue, so it carries mirrored frozen values; THIS test
 * pins the mirror against src/libs/billing/billingOffers.ts and
 * planDefinitions.ts so any repricing that touches one side without the
 * other fails CI. Also proves no fake feature matrix survived (§12).
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

describe('BILLING_PLAN_CARDS mirrors the canonical catalogue exactly', () => {
  it('every card matches the frozen offer prices and plan allowances', async () => {
    const { BILLING_PLAN_CARDS } = await import('./SettingsModal');
    const { getBillingOffer } = await import('@/libs/billing/billingOffers');
    const { getPlanDefinition } = await import('@/libs/billing/planDefinitions');

    expect(BILLING_PLAN_CARDS).toHaveLength(3);

    for (const card of BILLING_PLAN_CARDS) {
      const monthly = getBillingOffer(`${card.family}_2026_08_monthly`);
      const annual = getBillingOffer(`${card.family}_2026_08_annual`);
      const plan = getPlanDefinition(`${card.family}_2026_08`);

      expect(monthly, card.family).not.toBeNull();
      expect(card.monthly).toBe(`$${(monthly!.priceCents / 100).toFixed(2)}`);
      expect(card.annual).toBe(`$${(annual!.priceCents / 100).toFixed(2)}`);
      expect(card.smsCredits).toBe(plan!.monthlySmsCredits);
    }
  });

  it('the fake PLAN_FEATURES matrix is gone', async () => {
    const source = await import('node:fs').then(fs =>
      fs.readFileSync('src/components/admin/SettingsModal.tsx', 'utf-8'));

    expect(source).not.toContain('PLAN_FEATURES');
    expect(source).not.toContain('Most Popular');
  });
});
