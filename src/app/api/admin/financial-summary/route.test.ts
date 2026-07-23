import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  getCurrentFinancialReportingSummaries,
  guardModuleOr403,
  requireAdminSalon,
} = vi.hoisted(() => ({
  getCurrentFinancialReportingSummaries: vi.fn(),
  guardModuleOr403: vi.fn(),
  requireAdminSalon: vi.fn(),
}));

vi.mock('@/libs/adminAuth', () => ({
  requireAdminSalon,
}));

vi.mock('@/libs/featureGating', () => ({
  guardModuleOr403,
}));

vi.mock('@/libs/financialReportingServer', () => ({
  getCurrentFinancialReportingSummaries,
}));

/* eslint-disable import/first */
import { dynamic, GET } from './route';
/* eslint-enable import/first */

const GENERATED_AT = new Date('2026-07-23T15:00:00.000Z');
const FINALIZED_PROVENANCE = {
  mode: 'finalized' as const,
  finalizedAppointmentCount: 2,
  legacyAppointmentCount: 0,
  unresolvedAppointmentCount: 0,
  finalizedAmountCents: 15000,
  legacyFallbackAmountCents: 0,
  isEstimated: false,
};
const MIXED_BALANCE_PROVENANCE = {
  mode: 'mixed' as const,
  finalizedAppointmentCount: 1,
  legacyAppointmentCount: 1,
  unresolvedAppointmentCount: 1,
  finalizedAmountCents: 2500,
  legacyFallbackAmountCents: 1000,
  isEstimated: true,
};

function period(start: string, revenue: number) {
  return {
    completedAppointmentRevenueCents: revenue,
    completedAppointmentCount: 2,
    cashCollectedCents: 9000,
    tipsCents: 500,
    taxCents: 1300,
    discountsCents: 1000,
    provenance: FINALIZED_PROVENANCE,
    dateRange: {
      start: new Date(start),
      end: GENERATED_AT,
    },
  };
}

const CURRENT_SUMMARIES = {
  today: period('2026-07-23T07:00:00.000Z', 15000),
  weekToDate: period('2026-07-20T07:00:00.000Z', 36000),
  monthToDate: period('2026-07-01T07:00:00.000Z', 94000),
  balances: {
    completedOutstandingCents: 3500,
    upcomingBalanceCents: 8000,
    completedOutstandingProvenance: MIXED_BALANCE_PROVENANCE,
    upcomingAppointmentCount: 2,
    unresolvedUpcomingAppointmentCount: 0,
    settledByLegacyPaymentStatusCount: 1,
    depositDue: {
      supported: false as const,
      amountCents: null,
      reason: 'Per-appointment deposit obligations are not recorded.',
    },
    asOf: GENERATED_AT,
  },
  generatedAt: GENERATED_AT,
  timeZone: 'America/Vancouver',
};

describe('GET /api/admin/financial-summary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAdminSalon.mockResolvedValue({
      error: null,
      salon: {
        id: 'salon_owned',
        slug: 'owned-salon',
        settings: {
          booking: {
            currency: 'USD',
            timezone: 'America/Vancouver',
          },
        },
        // Core financials must remain available even when Analytics is off.
        features: {
          analytics: {
            dashboard: false,
          },
        },
      },
    });
    getCurrentFinancialReportingSummaries.mockResolvedValue(CURRENT_SUMMARIES);
  });

  it('is force-dynamic and rejects a missing salon before authentication', async () => {
    expect(dynamic).toBe('force-dynamic');

    const response = await GET(
      new Request('http://localhost/api/admin/financial-summary'),
    );

    expect(response.status).toBe(400);
    expect(response.headers.get('Cache-Control')).toBe(
      'private, no-store, max-age=0',
    );
    expect(requireAdminSalon).not.toHaveBeenCalled();
    expect(getCurrentFinancialReportingSummaries).not.toHaveBeenCalled();
  });

  it('propagates unauthenticated responses without querying financial data', async () => {
    requireAdminSalon.mockResolvedValue({
      error: Response.json(
        { error: { code: 'UNAUTHORIZED', message: 'Not authenticated' } },
        { status: 401 },
      ),
      salon: null,
    });

    const response = await GET(
      new Request(
        'http://localhost/api/admin/financial-summary?salonSlug=owned-salon',
      ),
    );

    expect(response.status).toBe(401);
    expect(response.headers.get('Cache-Control')).toBe(
      'private, no-store, max-age=0',
    );
    expect(getCurrentFinancialReportingSummaries).not.toHaveBeenCalled();
  });

  it('propagates a wrong-tenant rejection without querying financial data', async () => {
    requireAdminSalon.mockResolvedValue({
      error: Response.json(
        { error: { code: 'FORBIDDEN', message: 'Forbidden' } },
        { status: 403 },
      ),
      salon: null,
    });

    const response = await GET(
      new Request(
        'http://localhost/api/admin/financial-summary?salonSlug=foreign-salon',
      ),
    );

    expect(response.status).toBe(403);
    expect(response.headers.get('Cache-Control')).toBe(
      'private, no-store, max-age=0',
    );
    expect(getCurrentFinancialReportingSummaries).not.toHaveBeenCalled();
  });

  it('returns owned-salon core financials without the Analytics module gate', async () => {
    const response = await GET(
      new Request(
        'http://localhost/api/admin/financial-summary?salonSlug=owned-salon',
      ),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe(
      'private, no-store, max-age=0',
    );
    expect(requireAdminSalon).toHaveBeenCalledWith('owned-salon');
    expect(guardModuleOr403).not.toHaveBeenCalled();
    expect(getCurrentFinancialReportingSummaries).toHaveBeenCalledWith({
      salonId: 'salon_owned',
      timeZone: 'America/Vancouver',
    });
    expect(body).toEqual({
      data: {
        currency: 'USD',
        timeZone: 'America/Vancouver',
        asOf: '2026-07-23T15:00:00.000Z',
        currentPeriods: {
          today: {
            completedAppointmentRevenueCents: 15000,
            completedAppointmentCount: 2,
            cashCollectedCents: 9000,
            tipsCents: 500,
            taxCents: 1300,
            discountsCents: 1000,
            provenance: FINALIZED_PROVENANCE,
            dateRange: {
              start: '2026-07-23T07:00:00.000Z',
              end: '2026-07-23T15:00:00.000Z',
              timezone: 'America/Vancouver',
              isToDate: true,
            },
          },
          weekToDate: expect.objectContaining({
            completedAppointmentRevenueCents: 36000,
            dateRange: expect.objectContaining({
              start: '2026-07-20T07:00:00.000Z',
              timezone: 'America/Vancouver',
              isToDate: true,
            }),
          }),
          monthToDate: expect.objectContaining({
            completedAppointmentRevenueCents: 94000,
            dateRange: expect.objectContaining({
              start: '2026-07-01T07:00:00.000Z',
              timezone: 'America/Vancouver',
              isToDate: true,
            }),
          }),
        },
        balances: {
          completedOutstandingCents: 3500,
          completed: MIXED_BALANCE_PROVENANCE,
          settledByLegacyPaymentStatusCount: 1,
          asOf: '2026-07-23T15:00:00.000Z',
        },
      },
    });
  });

  it('returns a private non-cacheable 500 when reporting fails', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    getCurrentFinancialReportingSummaries.mockRejectedValue(
      new Error('database unavailable'),
    );

    const response = await GET(
      new Request(
        'http://localhost/api/admin/financial-summary?salonSlug=owned-salon',
      ),
    );
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(response.headers.get('Cache-Control')).toBe(
      'private, no-store, max-age=0',
    );
    expect(body).toEqual({
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Failed to fetch financial summary',
      },
    });

    errorSpy.mockRestore();
  });
});
