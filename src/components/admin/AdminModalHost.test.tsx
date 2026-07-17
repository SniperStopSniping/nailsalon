import { fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { AdminModalHost } from './AdminModalHost';

vi.mock('./AppModal', () => ({
  AppModal: ({ isOpen, children }: { isOpen: boolean; children: ReactNode }) => (
    isOpen ? children : null
  ),
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

vi.mock('./ClientsModal', () => ({
  ClientsModal: ({
    initialClientId,
    onOpenPromotionSettings,
  }: {
    initialClientId?: string | null;
    onOpenPromotionSettings?: (
      stage: 'promo_6w' | 'promo_8w',
      clientId: string,
    ) => void;
  }) => (
    <div>
      <p>{`client:${initialClientId}`}</p>
      <button
        type="button"
        onClick={() =>
          onOpenPromotionSettings?.('promo_6w', initialClientId || 'client_1')}
      >
        Open promotion settings
      </button>
    </div>
  ),
}));

vi.mock('./WalkInModal', () => ({
  WalkInModal: () => null,
}));

describe('AdminModalHost', () => {
  it('forwards the active salon with a Today appointment into Bookings', () => {
    render(
      <AdminModalHost
        activeModal="bookings"
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

    expect(screen.getByText('appt_today:isla-nail-studio')).toBeInTheDocument();
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
});
