import { beforeEach, describe, expect, it, vi } from 'vitest';

import { evaluateAndFlagIfNeeded } from './fraudDetection';

vi.mock('server-only', () => ({}));

const { hasCanonicalAppliedDepositCreditForClientLineage, select } = vi.hoisted(() => ({
  hasCanonicalAppliedDepositCreditForClientLineage: vi.fn(),
  select: vi.fn(),
}));

vi.mock('@/libs/queries', () => ({
  hasCanonicalAppliedDepositCreditForClientLineage,
}));

vi.mock('@/libs/DB', () => ({
  db: { select },
}));

describe('fraud detection D6.1 reward boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('defers later reward-velocity evaluation when canonical deposit credit was applied', async () => {
    hasCanonicalAppliedDepositCreditForClientLineage.mockResolvedValue(true);

    await evaluateAndFlagIfNeeded(
      'salon_d6_1',
      'client_d6_1',
      'later_tender_only_appointment',
      1000,
    );

    expect(hasCanonicalAppliedDepositCreditForClientLineage).toHaveBeenCalledWith({
      salonId: 'salon_d6_1',
      salonClientId: 'client_d6_1',
    });
    expect(select).not.toHaveBeenCalled();
  });
});
