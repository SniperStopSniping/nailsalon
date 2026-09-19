import { fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { OwnerManagementModal } from './OwnerManagementModal';

const {
  bookingPageInformationEditorMock,
  ownerScheduleEditorMock,
  pushMock,
  replaceMock,
  backMock,
  usageBillingModalMock,
  state,
} = vi.hoisted(() => ({
  bookingPageInformationEditorMock: vi.fn(),
  ownerScheduleEditorMock: vi.fn(),
  pushMock: vi.fn(),
  replaceMock: vi.fn(),
  backMock: vi.fn(),
  usageBillingModalMock: vi.fn(),
  state: { query: '' },
}));

vi.mock('next/navigation', () => ({
  useParams: () => ({ locale: 'en' }),
  useRouter: () => ({ push: pushMock, replace: replaceMock, back: backMock }),
  useSearchParams: () => new URLSearchParams(state.query),
}));

vi.mock('./AppModal', () => ({
  BackButton: ({ label, onClick }: { label: string; onClick: () => void }) => <button onClick={onClick} type="button">{label}</button>,
  ModalHeader: ({ title, subtitle, leftAction }: { title: string; subtitle?: string; leftAction?: React.ReactNode }) => (
    <header>
      <h1>{title}</h1>
      <p>{subtitle}</p>
      {leftAction}
    </header>
  ),
}));

vi.mock('./BookingPageInformationEditor', () => ({
  BookingPageInformationEditor: (props: unknown) => {
    bookingPageInformationEditorMock(props);
    return <div data-testid="booking-page-information-editor" />;
  },
}));

vi.mock('./SettingsModal', () => ({
  SettingsModal: ({ initialView, leafOnly, onClose }: { initialView: string; leafOnly: boolean; onClose: () => void }) => (
    <div data-testid="settings-modal">
      <span>{initialView}</span>
      <span>{String(leafOnly)}</span>
      <button onClick={onClose} type="button">Settings back</button>
    </div>
  ),
}));

vi.mock('./OwnerScheduleEditor', () => ({
  OwnerScheduleEditor: (props: unknown) => {
    ownerScheduleEditorMock(props);
    return <div data-testid="working-schedule-editor" />;
  },
}));

vi.mock('./UsageBillingModal', () => ({
  UsageBillingModal: (props: unknown) => {
    usageBillingModalMock(props);
    return <button onClick={(props as { onClose: () => void }).onClose} type="button">Usage back</button>;
  },
}));

vi.mock('./ChoosePlanPanel', () => ({
  ChoosePlanPanel: () => <div data-testid="choose-plan-panel" />,
}));

function renderModal(overrides: Partial<React.ComponentProps<typeof OwnerManagementModal>> = {}) {
  return render(
    <OwnerManagementModal
      app="hours"
      salonSlug="isla"
      salonId="salon_1"
      isFreeSolo={false}
      teamAvailable={false}
      onClose={vi.fn()}
      {...overrides}
    />,
  );
}

function queryOf(href: string) {
  return new URL(href, 'https://luster.test').searchParams;
}

describe('OwnerManagementModal', () => {
  beforeEach(() => {
    state.query = '';
    bookingPageInformationEditorMock.mockReset();
    ownerScheduleEditorMock.mockReset();
    pushMock.mockReset();
    replaceMock.mockReset();
    backMock.mockReset();
    usageBillingModalMock.mockReset();
  });

  it('uses the hours-only editor and does not expose a team shortcut to a solo salon', () => {
    const onOpenApp = vi.fn();
    renderModal({ onOpenApp });

    expect(bookingPageInformationEditorMock).toHaveBeenCalledWith(expect.objectContaining({
      mode: 'hours',
      salonSlug: 'isla',
      disabled: false,
    }));
    expect(screen.queryByRole('button', { name: /working schedules/i })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'View calendar' }));
    fireEvent.click(screen.getByRole('button', { name: 'Booking rules' }));

    expect(onOpenApp).toHaveBeenNthCalledWith(1, 'schedule');
    expect(onOpenApp).toHaveBeenNthCalledWith(2, 'booking-rules');
  });

  it.each(['working-hours', 'time-off'])('opens %s directly for a solo salon without a Team workflow', (view) => {
    state.query = `salon=isla&app=hours&view=${view}&technician=tech_1`;
    renderModal();

    expect(ownerScheduleEditorMock).toHaveBeenCalledWith(expect.objectContaining({
      salonSlug: 'isla',
      technicianId: 'tech_1',
      section: view === 'working-hours' ? 'hours' : 'time-off',
    }));
    expect(bookingPageInformationEditorMock).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: /team time-off requests/i })).not.toBeInTheDocument();
  });

  it('opens URL-backed Booking Rules leaves and returns a direct link to its contextual home', () => {
    state.query = 'salon=isla&client=client_9&returnTo=calendar&app=booking-rules&view=policies';
    renderModal({ app: 'booking-rules' });

    expect(screen.getByTestId('settings-modal')).toHaveTextContent('booking-policy');
    expect(screen.getByTestId('settings-modal')).toHaveTextContent('true');

    fireEvent.click(screen.getByRole('button', { name: 'Settings back' }));

    expect(replaceMock).toHaveBeenCalledTimes(1);

    const query = queryOf(replaceMock.mock.calls[0]![0]);

    expect(query.get('salon')).toBe('isla');
    expect(query.get('client')).toBe('client_9');
    expect(query.get('returnTo')).toBe('calendar');
    expect(query.get('app')).toBe('booking-rules');
    expect(query.has('view')).toBe(false);
  });

  it('opens a plan leaf through the URL while retaining salon and contextual query values', () => {
    state.query = 'client=client_9&returnTo=calendar';
    const rendered = renderModal({ app: 'plan-usage' });

    fireEvent.click(screen.getByRole('button', { name: /usage & billing/i }));

    expect(pushMock).toHaveBeenCalledTimes(1);

    const query = queryOf(pushMock.mock.calls[0]![0]);

    expect(query.get('salon')).toBe('isla');
    expect(query.get('client')).toBe('client_9');
    expect(query.get('returnTo')).toBe('calendar');
    expect(query.get('app')).toBe('plan-usage');
    expect(query.get('view')).toBe('usage');

    state.query = query.toString();
    rendered.rerender(
      <OwnerManagementModal app="plan-usage" salonSlug="isla" salonId="salon_1" isFreeSolo={false} teamAvailable={false} onClose={vi.fn()} />,
    );

    expect(usageBillingModalMock).toHaveBeenCalledWith(expect.objectContaining({ salonSlug: 'isla' }));
  });

  it('reuses the existing billing gate when no salon is selected', () => {
    renderModal({ app: 'plan-usage', salonSlug: null });

    expect(screen.getByRole('button', { name: /usage & billing/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /compare plans/i })).toBeDisabled();
    expect(usageBillingModalMock).not.toHaveBeenCalled();
  });

  it('does not expose plan comparison to a Free Solo owner, including a direct plans link', () => {
    state.query = 'salon=isla&app=plan-usage&view=plans';
    renderModal({ app: 'plan-usage', isFreeSolo: true });

    expect(screen.getByRole('button', { name: /usage & billing/i })).toBeEnabled();
    expect(screen.queryByRole('button', { name: /compare plans/i })).not.toBeInTheDocument();
    expect(screen.queryByTestId('choose-plan-panel')).not.toBeInTheDocument();
  });

  it('delegates Help resources to the existing app destinations', () => {
    const onOpenApp = vi.fn();
    renderModal({ app: 'help', onOpenApp });

    fireEvent.click(screen.getByRole('button', { name: /workspace tour/i }));
    fireEvent.click(screen.getByRole('button', { name: /luster resources/i }));

    expect(onOpenApp).toHaveBeenNthCalledWith(1, 'workspace-tour');
    expect(onOpenApp).toHaveBeenNthCalledWith(2, 'luster');
  });
});
