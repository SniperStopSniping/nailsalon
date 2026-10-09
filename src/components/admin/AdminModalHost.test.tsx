import { fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { SalonProvider } from '@/providers/SalonProvider';

import { AdminModalHost } from './AdminModalHost';

const appModalSpy = vi.hoisted(() => vi.fn());
vi.mock('./AppModal', () => ({
  AppModal: (props: { isOpen: boolean; children: ReactNode; returnFocusKey?: string | null }) => {
    appModalSpy(props);
    return props.isOpen ? props.children : null;
  },
}));

vi.mock('./OwnerManagementModal', () => ({
  OwnerManagementModal: ({ salonSlug }: { salonSlug: string }) => <p>{`management:${salonSlug}`}</p>,
}));

vi.mock('./AppointmentsModal', () => ({
  AppointmentsModal: ({
    initialAppointmentId,
    salonSlug,
  }: {
    initialAppointmentId?: string | null;
    salonSlug?: string | null;
  }) => <p>{`${initialAppointmentId}:${salonSlug}`}</p>,
}));

vi.mock('./ClientsModal', async () => {
  // Reads the salon context the way the real modal does, so the tests below
  // can prove the host re-provides the workspace's active salon (OP-011).
  const { useSalon } = await import('@/providers/SalonProvider');
  return {
    ClientsModal: ({
      initialClientId,
      onOpenPromotionSettings,
    }: {
      initialClientId?: string | null;
      onOpenPromotionSettings?: (
        stage: 'promo_6w' | 'promo_8w',
        clientId: string,
      ) => void;
    }) => {
      const { salonSlug: contextSalonSlug } = useSalon();
      return (
        <div>
          <p>{`client:${initialClientId}`}</p>
          <p data-testid="context-salon-slug">{contextSalonSlug}</p>
          <button
            type="button"
            onClick={() =>
              onOpenPromotionSettings?.('promo_6w', initialClientId || 'client_1')}
          >
            Open promotion settings
          </button>
        </div>
      );
    },
  };
});

vi.mock('./WalkInModal', () => ({
  WalkInModal: () => null,
}));

vi.mock('./IntegrationsModal', () => ({
  IntegrationsModal: ({
    salonSlug,
    initialView,
    initialNotice,
  }: {
    salonSlug?: string | null;
    initialView?: string;
    initialNotice?: string | null;
  }) => (
    <p>{`integrations:${salonSlug}:${initialView}:${initialNotice ?? 'none'}`}</p>
  ),
}));

describe('AdminModalHost', () => {
  it.each(['bookings', 'plan-usage'] as const)('forwards salon context and limits credit focus to the correct %s surface', (app) => {
    appModalSpy.mockClear();
    render(
      <AdminModalHost
        activeModal={app}
        creditShortcutReturnFocusKey="sms:isla-nail-studio:today:topup"
        activeSalonSlug="isla-nail-studio"
        isFreeSolo
        onCloseModal={vi.fn()}
        initialAppointmentId="appt_today"
        showNotifications={false}
        setShowNotifications={vi.fn()}
        showFraudSignals={false}
        setShowFraudSignals={vi.fn()}
        showScheduleCalendar={false}
        setShowScheduleCalendar={vi.fn()}
        showWalkIn={false}
        setShowWalkIn={vi.fn()}
        userName="Daniela"
        userInitial="D"
        analyticsProps={{
          revenue: 0,
          revenueTrend: 0,
          staffData: [],
          utilization: [],
          services: [],
          timePeriod: 'Daily',
          onTimePeriodChange: vi.fn(),
          anchorDate: '2026-07-17',
          onPrev: vi.fn(),
          onNext: vi.fn(),
          onToday: vi.fn(),
          onAnchorChange: vi.fn(),
        }}
        fraudSignals={[]}
        fraudSignalsTotalCount={0}
        fraudSignalsLoading={false}
        fraudSignalsError={null}
        fetchFraudSignals={vi.fn()}
        onFraudSignalResolved={vi.fn()}
      />,
    );

    expect(screen.getByText(app === 'bookings' ? 'appt_today:isla-nail-studio' : 'management:isla-nail-studio')).toBeInTheDocument();
    expect(appModalSpy.mock.calls.find(([props]) => props.isOpen)?.[0].returnFocusKey)
      .toBe(app === 'plan-usage' ? 'sms:isla-nail-studio:today:topup' : undefined);
  });

  it('forwards a dashboard retention alert into the exact client profile', () => {
    const onOpenPromotionSettings = vi.fn();
    render(
      <AdminModalHost
        activeModal="clients"
        activeSalonSlug="isla-nail-studio"
        isFreeSolo
        onCloseModal={vi.fn()}
        initialClientId="client_bob"
        onOpenPromotionSettings={onOpenPromotionSettings}
        showNotifications={false}
        setShowNotifications={vi.fn()}
        showFraudSignals={false}
        setShowFraudSignals={vi.fn()}
        showScheduleCalendar={false}
        setShowScheduleCalendar={vi.fn()}
        showWalkIn={false}
        setShowWalkIn={vi.fn()}
        userName="Daniela"
        userInitial="D"
        analyticsProps={{
          revenue: 0,
          revenueTrend: 0,
          staffData: [],
          utilization: [],
          services: [],
          timePeriod: 'Daily',
          onTimePeriodChange: vi.fn(),
          anchorDate: '2026-07-17',
          onPrev: vi.fn(),
          onNext: vi.fn(),
          onToday: vi.fn(),
          onAnchorChange: vi.fn(),
        }}
        fraudSignals={[]}
        fraudSignalsTotalCount={0}
        fraudSignalsLoading={false}
        fraudSignalsError={null}
        fetchFraudSignals={vi.fn()}
        onFraudSignalResolved={vi.fn()}
      />,
    );

    expect(screen.getByText('client:client_bob')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Open promotion settings' }));

    expect(onOpenPromotionSettings).toHaveBeenCalledWith(
      'promo_6w',
      'client_bob',
    );
  });

  it('routes the integrations app to the IntegrationsModal with its deep-linked view', () => {
    render(
      <AdminModalHost
        activeModal="integrations"
        activeSalonSlug="isla-nail-studio"
        isFreeSolo
        onCloseModal={vi.fn()}
        integrationsInitialView="google"
        integrationsNotice="Google Calendar connected. Choose which calendars Luster should use."
        showNotifications={false}
        setShowNotifications={vi.fn()}
        showFraudSignals={false}
        setShowFraudSignals={vi.fn()}
        showScheduleCalendar={false}
        setShowScheduleCalendar={vi.fn()}
        showWalkIn={false}
        setShowWalkIn={vi.fn()}
        userName="Daniela"
        userInitial="D"
        analyticsProps={{
          revenue: 0,
          revenueTrend: 0,
          staffData: [],
          utilization: [],
          services: [],
          timePeriod: 'Daily',
          onTimePeriodChange: vi.fn(),
          anchorDate: '2026-07-17',
          onPrev: vi.fn(),
          onNext: vi.fn(),
          onToday: vi.fn(),
          onAnchorChange: vi.fn(),
        }}
        fraudSignals={[]}
        fraudSignalsTotalCount={0}
        fraudSignalsLoading={false}
        fraudSignalsError={null}
        fetchFraudSignals={vi.fn()}
        onFraudSignalResolved={vi.fn()}
      />,
    );

    expect(
      screen.getByText(
        'integrations:isla-nail-studio:google:Google Calendar connected. Choose which calendars Luster should use.',
      ),
    ).toBeInTheDocument();
  });

  // OP-011: the root layout's SalonProvider is filled from a cookie the owner
  // workspace never sets, so modals reading `useSalon()` saw an empty salon.
  it('re-provides the workspace\'s active salon to modals that read the salon context', () => {
    render(
      <SalonProvider salonSlug="cookie-salon" salonName="Cookie Salon">
        <AdminModalHost
          activeModal="clients"
          activeSalonSlug="nail-salon-no5"
          activeSalonId="salon_nail-salon-no5"
          activeSalonName="Nail Salon No.5"
          isFreeSolo
          onCloseModal={vi.fn()}
          showNotifications={false}
          setShowNotifications={vi.fn()}
          showFraudSignals={false}
          setShowFraudSignals={vi.fn()}
          showScheduleCalendar={false}
          setShowScheduleCalendar={vi.fn()}
          showWalkIn={false}
          setShowWalkIn={vi.fn()}
          userName="Daniela"
          userInitial="D"
          analyticsProps={{
            revenue: 0,
            revenueTrend: 0,
            staffData: [],
            utilization: [],
            services: [],
            timePeriod: 'Daily',
            onTimePeriodChange: vi.fn(),
            anchorDate: '2026-07-17',
            onPrev: vi.fn(),
            onNext: vi.fn(),
            onToday: vi.fn(),
            onAnchorChange: vi.fn(),
          }}
          fraudSignals={[]}
          fraudSignalsTotalCount={0}
          fraudSignalsLoading={false}
          fraudSignalsError={null}
          fetchFraudSignals={vi.fn()}
          onFraudSignalResolved={vi.fn()}
        />
      </SalonProvider>,
    );

    expect(screen.getByTestId('context-salon-slug')).toHaveTextContent('nail-salon-no5');
  });

  it('inherits the outer salon context when the workspace has not resolved a salon yet', () => {
    render(
      <SalonProvider salonSlug="cookie-salon" salonName="Cookie Salon">
        <AdminModalHost
          activeModal="clients"
          activeSalonSlug={null}
          isFreeSolo
          onCloseModal={vi.fn()}
          showNotifications={false}
          setShowNotifications={vi.fn()}
          showFraudSignals={false}
          setShowFraudSignals={vi.fn()}
          showScheduleCalendar={false}
          setShowScheduleCalendar={vi.fn()}
          showWalkIn={false}
          setShowWalkIn={vi.fn()}
          userName="Daniela"
          userInitial="D"
          analyticsProps={{
            revenue: 0,
            revenueTrend: 0,
            staffData: [],
            utilization: [],
            services: [],
            timePeriod: 'Daily',
            onTimePeriodChange: vi.fn(),
            anchorDate: '2026-07-17',
            onPrev: vi.fn(),
            onNext: vi.fn(),
            onToday: vi.fn(),
            onAnchorChange: vi.fn(),
          }}
          fraudSignals={[]}
          fraudSignalsTotalCount={0}
          fraudSignalsLoading={false}
          fraudSignalsError={null}
          fetchFraudSignals={vi.fn()}
          onFraudSignalResolved={vi.fn()}
        />
      </SalonProvider>,
    );

    expect(screen.getByTestId('context-salon-slug')).toHaveTextContent('cookie-salon');
  });
});
