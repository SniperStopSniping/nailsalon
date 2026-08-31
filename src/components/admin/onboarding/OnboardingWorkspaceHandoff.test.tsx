import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { OnboardingWorkspaceHandoff } from './OnboardingWorkspaceHandoff';

const fetchMock = vi.fn();
const resume = vi.hoisted(() => ({ allowed: true }));

vi.mock('@/features/onboarding-v1-integration/flow-storage', () => ({
  authorizeVerifiedOnboardingSetupResume: () => true,
  canResumeVerifiedOnboardingSetup: () => resume.allowed,
}));

const handoff = {
  handoff: { planIntent: 'free', showWelcome: true, tourCompleted: false },
  setup: {
    googleCalendar: 'not_started',
    payments: 'needs_attention',
    servicesAdded: true,
    shareLink: 'not_started',
  },
  site: {
    hasVisibleBookingSection: true,
    id: 'site_1',
    previewUrl: '/en/admin/website/preview/site_1',
    revision: 4,
    setupAvailable: true,
    setupUrl: '/en/onboarding-v1?resume=review&site=site_1&revision=4',
  },
} as const;

beforeEach(() => {
  vi.clearAllMocks();
  resume.allowed = true;
  window.localStorage.clear();
  vi.stubGlobal('fetch', fetchMock);
});

describe('OnboardingWorkspaceHandoff', () => {
  it('shows account-backed actions and derives checklist copy from returned statuses', async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ data: handoff }), { status: 200 }));
    const onTakeTour = vi.fn();
    const onAvailabilityChange = vi.fn();

    render(
      <OnboardingWorkspaceHandoff
        focusWelcome
        locale="en"
        onAvailabilityChange={onAvailabilityChange}
        onTakeTour={onTakeTour}
        salonSlug="isla"
      />,
    );

    const welcomeHeading = await screen.findByRole('heading', {
      name: 'Your Luster site is ready',
    });

    expect(welcomeHeading).toBeInTheDocument();

    await waitFor(() => expect(welcomeHeading).toHaveFocus());

    expect(screen.getByRole('link', { name: /Preview website/i })).toHaveAttribute(
      'href',
      '/en/admin/website/preview/site_1',
    );
    expect(await screen.findByRole('link', { name: /Change website setup/i })).toHaveAttribute(
      'href',
      '/en/onboarding-v1?resume=review&site=site_1&revision=4',
    );
    expect(screen.getByText('Website created')).toBeInTheDocument();
    expect(screen.getByText('Booking page ready')).toBeInTheDocument();
    expect(screen.getByText('Services added')).toBeInTheDocument();
    expect(screen.getByText('Connect Google Calendar')).toBeInTheDocument();
    expect(screen.getByText('Not connected')).toBeInTheDocument();
    expect(screen.getByText('Needs attention')).toBeInTheDocument();
    expect(screen.getByText('Not shared yet')).toBeInTheDocument();
    expect(onAvailabilityChange).toHaveBeenCalledWith(true);

    fireEvent.click(screen.getAllByRole('button', { name: /Take (a quick )?tour/i })[0]!);

    expect(onTakeTour).toHaveBeenCalledTimes(1);
  });

  it('omits the unsafe setup/editor fallback when Booking is not ready', async () => {
    resume.allowed = false;
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({
      data: {
        ...handoff,
        site: { ...handoff.site, hasVisibleBookingSection: false },
      },
    }), { status: 200 }));

    render(
      <OnboardingWorkspaceHandoff
        locale="en"
        onTakeTour={vi.fn()}
        salonSlug="isla"
      />,
    );

    expect(await screen.findByRole('link', { name: /Preview website/i })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Change website setup/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Booking page ready/i })).not.toBeInTheDocument();
  });

  it('shows paid interest only from the persisted handoff intent', async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({
      data: {
        ...handoff,
        handoff: { ...handoff.handoff, planIntent: 'founding_interest' },
      },
    }), { status: 200 }));

    render(
      <OnboardingWorkspaceHandoff
        locale="en"
        onTakeTour={vi.fn()}
        salonSlug="isla"
      />,
    );

    expect(await screen.findByText(/Founding offer reserved\./i)).toHaveTextContent(
      'Nothing was charged today.',
    );
  });

  it('fails closed when the signed-in salon has no claimed onboarding site', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 404 }));
    const onAvailabilityChange = vi.fn();

    render(
      <OnboardingWorkspaceHandoff
        locale="en"
        onAvailabilityChange={onAvailabilityChange}
        onTakeTour={vi.fn()}
        salonSlug="legacy-salon"
      />,
    );

    await waitFor(() => expect(onAvailabilityChange).toHaveBeenCalledWith(false));

    expect(screen.queryByTestId('onboarding-workspace-handoff')).not.toBeInTheDocument();
  });

  it('persists banner dismissal and restores it when the tenant-scoped write fails', async () => {
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: handoff }), { status: 200 }))
      .mockResolvedValueOnce(new Response(null, { status: 500 }));

    render(
      <OnboardingWorkspaceHandoff
        locale="en"
        onTakeTour={vi.fn()}
        salonSlug="isla"
      />,
    );

    await screen.findByRole('heading', { name: 'Your Luster site is ready' });
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss welcome' }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenLastCalledWith(
        '/api/admin/onboarding-site?salonSlug=isla',
        expect.objectContaining({ method: 'PATCH' }),
      );
    });

    expect(await screen.findByRole('alert')).toHaveTextContent('could not be dismissed');
    expect(screen.getByRole('heading', { name: 'Your Luster site is ready' })).toBeInTheDocument();
  });
});
