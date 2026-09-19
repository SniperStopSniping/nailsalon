import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { GET, POST } from './route';

const mocks = vi.hoisted(() => ({
  dispatch: vi.fn(),
  retention: vi.fn(),
  unknownOutcomes: vi.fn(),
  lowBalance: vi.fn(),
  reviews: vi.fn(),
  sms: vi.fn(),
  email: vi.fn(),
  warningEmail: vi.fn(),
}));

vi.mock('@/libs/communicationDispatcher', () => ({ processDueCommunications: mocks.dispatch }));
vi.mock('@/libs/smsInboundRetention', () => ({ releaseExpiredInboundEvidence: mocks.retention }));
vi.mock('@/libs/unknownOutcomeResolver', () => ({ resolveUnknownOutcomes: mocks.unknownOutcomes }));
vi.mock('@/libs/lowBalanceWarnings', () => ({ evaluateLowBalanceWarnings: mocks.lowBalance, sendLowBalanceWarningEmail: mocks.warningEmail }));
vi.mock('@/libs/reviewRequests.server', () => ({ materializeCompletedReviewTriggers: mocks.reviews }));
vi.mock('@/libs/twilioMessagingSend', () => ({ sendViaTwilio: mocks.sms, sendIntentEmail: mocks.email }));

function authorizedRequest() {
  return new Request('http://localhost/api/communications/dispatch', { headers: { authorization: 'Bearer fixture-cron-secret' } });
}

describe('communications cron review-phase compatibility', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubEnv('CRON_SECRET', 'fixture-cron-secret');
    mocks.dispatch.mockResolvedValue({ sent: 1 });
    mocks.retention.mockResolvedValue({ released: 0 });
    mocks.unknownOutcomes.mockResolvedValue({ reconciled: 0 });
    mocks.lowBalance.mockResolvedValue({ warnings: 0 });
    mocks.reviews.mockResolvedValue({ materialized: 1, pending: 0, skipped: 0, deferred: 0, phaseError: false });
  });

  afterEach(() => vi.unstubAllEnvs());

  it('rejects unauthorized calls before any review or established message work', async () => {
    const response = await GET(new Request('http://localhost/api/communications/dispatch'));

    expect(response.status).toBe(401);
    expect(mocks.dispatch).not.toHaveBeenCalled();
    expect(mocks.reviews).not.toHaveBeenCalled();
    expect(mocks.retention).not.toHaveBeenCalled();
  });

  it('finishes the established dispatch and maintenance phases before review materialization', async () => {
    let releaseMaintenance!: (value: { warnings: number }) => void;
    let maintenanceStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      maintenanceStarted = resolve;
    });
    mocks.lowBalance.mockImplementation(() => {
      maintenanceStarted();
      return new Promise((resolve) => {
        releaseMaintenance = resolve;
      });
    });

    const responsePromise = POST(authorizedRequest());
    await started;
    try {
      expect(mocks.dispatch).toHaveBeenCalledWith(expect.objectContaining({ providerSend: mocks.sms, emailSend: mocks.email }));
      expect(mocks.retention).toHaveBeenCalledOnce();
      expect(mocks.unknownOutcomes).toHaveBeenCalledOnce();
      expect(mocks.lowBalance).toHaveBeenCalledWith({ sendWarningEmail: mocks.warningEmail });
      expect(mocks.reviews).not.toHaveBeenCalled();
    } finally {
      releaseMaintenance({ warnings: 0 });
    }

    expect((await responsePromise).status).toBe(200);

    expect(mocks.reviews).toHaveBeenCalledOnce();
    expect(mocks.sms).not.toHaveBeenCalled();
    expect(mocks.email).not.toHaveBeenCalled();
  });

  it('reports a review-phase error without losing the completed reminder result or rerunning delivery', async () => {
    mocks.reviews.mockRejectedValue(new Error('fixture review database timeout'));

    const response = await GET(authorizedRequest());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      summary: { sent: 1 },
      retention: { released: 0 },
      unknownOutcomes: { reconciled: 0 },
      lowBalance: { warnings: 0 },
      reviewTriggers: { materialized: 0, pending: 0, skipped: 0, deferred: 0, phaseError: true },
    });
    expect(mocks.dispatch).toHaveBeenCalledOnce();
  });
});
