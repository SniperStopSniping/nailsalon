import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { beforeEach, vi } from 'vitest';

import { initializeStarter } from '../../../model/starters';
import { createDefaultBusinessProfile } from '../../model/defaults';
import { DashboardPreviewSurface } from './DashboardPreviewSurface';

const installMatchMedia = () => {
  vi.stubGlobal('matchMedia', vi.fn((query: string): MediaQueryList => ({
    addEventListener: vi.fn(),
    addListener: vi.fn(),
    dispatchEvent: vi.fn(() => true),
    matches: false,
    media: query,
    onchange: null,
    removeEventListener: vi.fn(),
    removeListener: vi.fn(),
  })));
};

describe('DashboardPreviewSurface', () => {
  beforeEach(installMatchMedia);

  const profile = {
    ...createDefaultBusinessProfile(),
    businessName: 'Isla Nail Studio',
    ownerName: 'Daniela',
  };

  const renderSurface = (initialTourCompleted = false) => {
    const onEditWebsite = vi.fn();
    const onReturnToReview = vi.fn();
    const onTourCompletedChange = vi.fn();

    function Harness() {
      const [tourCompleted, setTourCompleted] = useState(initialTourCompleted);
      return (
        <DashboardPreviewSurface
          document={initializeStarter('one_page', { siteName: profile.businessName })}
          fixtures={{
            googleCalendar: 'not_connected',
            payments: 'needs_attention',
            shareBookingLink: 'connected',
          }}
          onEditWebsite={onEditWebsite}
          onReturnToReview={onReturnToReview}
          onTourCompletedChange={(completed) => {
            onTourCompletedChange(completed);
            setTourCompleted(completed);
          }}
          planIntent="free"
          profile={profile}
          reducedMotion={false}
          selectedServiceIds={['svc-manicure-russian']}
          tourCompleted={tourCompleted}
        />
      );
    }

    return {
      onEditWebsite,
      onReturnToReview,
      onTourCompletedChange,
      ...render(<Harness />),
    };
  };

  it('opens an optional five-part first-time tour and supports skip and replay', async () => {
    const user = userEvent.setup();
    const { onTourCompletedChange } = renderSurface();

    const dialog = screen.getByRole('dialog', { name: 'Welcome to your Luster workspace' });
    expect(dialog).toHaveTextContent('1 of 5');
    expect(screen.getByRole('button', { name: 'Skip tour' })).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Skip tour' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(onTourCompletedChange).toHaveBeenCalledWith(true);
    await waitFor(() => expect(screen.getByRole('heading', { level: 1 })).toHaveFocus());
    await user.click(screen.getByRole('button', { name: 'Replay tour' }));
    expect(screen.getByRole('dialog', { name: 'Welcome to your Luster workspace' })).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Close Welcome to your Luster workspace' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Replay tour' })).toHaveFocus());
  });

  it('supports next, back and Done while showing truthful destinations', async () => {
    const user = userEvent.setup();
    renderSurface();
    expect(document.querySelector('.lab-dashboard-tour__miniature.is-today')).toBeVisible();
    await user.click(screen.getByRole('button', { name: /Next/iu }));
    expect(screen.getByText('2 of 5')).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Your calendar' })).toBeVisible();
    expect(document.querySelector('.lab-dashboard-tour__miniature.is-calendar')).toBeVisible();
    await user.click(screen.getByRole('button', { name: /Back/iu }));
    expect(screen.getByText('1 of 5')).toBeVisible();
    for (const destination of ['calendar', 'clients', 'services', 'website']) {
      await user.click(screen.getByRole('button', { name: /Next/iu }));
      expect(document.querySelector(`.lab-dashboard-tour__miniature.is-${destination}`))
        .toBeVisible();
    }
    await user.click(within(screen.getByRole('dialog')).getByRole('button', {
      name: 'Go to dashboard',
    }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    const todayHeading = screen.getByRole('heading', { name: 'Today at Isla Nail Studio' });
    expect(todayHeading).toBeVisible();
    await waitFor(() => expect(todayHeading).toHaveFocus());
  });

  it('derives the Services storyboard and tour miniature from selected canonical service IDs', async () => {
    const user = userEvent.setup();
    const siteDocument = initializeStarter('one_page', { siteName: profile.businessName });
    const commonProps = {
      document: siteDocument,
      fixtures: {
        googleCalendar: 'not_connected' as const,
        payments: 'not_connected' as const,
        shareBookingLink: 'not_connected' as const,
      },
      onEditWebsite: vi.fn(),
      onReturnToReview: vi.fn(),
      onTourCompletedChange: vi.fn(),
      planIntent: 'free' as const,
      profile,
      reducedMotion: false,
      tourCompleted: true,
    };
    const view = render(
      <DashboardPreviewSurface
        {...commonProps}
        selectedServiceIds={['svc-manicure-russian', 'svc-manicure-classic']}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Services' }));
    expect(screen.getByText('2 selected services')).toBeVisible();
    expect(screen.getByText('Russian Manicure')).toBeVisible();
    expect(screen.getByText('Classic Manicure')).toBeVisible();

    view.rerender(
      <DashboardPreviewSurface
        {...commonProps}
        selectedServiceIds={['svc-manicure-gel']}
      />,
    );
    expect(screen.getByText('1 selected service')).toBeVisible();
    expect(screen.getByText('Gel Manicure')).toBeVisible();
    expect(screen.queryByText('Russian Manicure')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Replay tour' }));
    for (let index = 0; index < 3; index += 1) {
      await user.click(screen.getByRole('button', { name: /Next/iu }));
    }
    const serviceMiniature = document.querySelector('.lab-dashboard-tour__miniature.is-services');
    expect(serviceMiniature).toHaveTextContent('1 selected service');
    expect(serviceMiniature).toHaveTextContent('Gel Manicure');
  });

  it('makes Go to dashboard select and focus the Today destination', async () => {
    const user = userEvent.setup();
    renderSurface(true);
    await user.click(screen.getByRole('button', { name: 'Services' }));
    await user.click(screen.getByRole('button', { name: 'Go to dashboard' }));
    const todayHeading = screen.getByRole('heading', { name: 'Today at Isla Nail Studio' });
    await waitFor(() => expect(todayHeading).toHaveFocus());
    expect(screen.getByRole('button', { name: 'Today' })).toHaveAttribute('aria-current', 'page');
  });

  it('derives checklist status and keeps website and Review one action away', async () => {
    const user = userEvent.setup();
    const { onEditWebsite, onReturnToReview } = renderSurface(true);
    expect(screen.getByText('Website created').closest('li')).toHaveTextContent('Ready');
    expect(screen.getByText('Services added').closest('li')).toHaveTextContent('Ready');
    expect(screen.getByText('Connect Google Calendar').closest('li')).toHaveTextContent('Not connected');
    expect(screen.getByText('Share booking link').closest('li')).toHaveTextContent('Connected');
    await user.click(screen.getByRole('button', { name: 'Edit website' }));
    await user.click(screen.getByRole('button', { name: 'Return to onboarding review · Lab only' }));
    expect(onEditWebsite).toHaveBeenCalledOnce();
    expect(onReturnToReview).toHaveBeenCalledOnce();
  });

  it.each([
    ['free', 'Continuing free'],
    ['monthly', 'Monthly plan saved'],
    ['founding', 'Founding offer saved'],
  ] as const)('shows the saved %s intent on the dashboard handoff', (planIntent, message) => {
    render(
      <DashboardPreviewSurface
        document={initializeStarter('one_page', { siteName: profile.businessName })}
        fixtures={{
          googleCalendar: 'not_connected',
          payments: 'not_connected',
          shareBookingLink: 'not_connected',
        }}
        onEditWebsite={vi.fn()}
        onReturnToReview={vi.fn()}
        onTourCompletedChange={vi.fn()}
        planIntent={planIntent}
        profile={profile}
        reducedMotion
        selectedServiceIds={['svc-manicure-russian']}
        tourCompleted
      />,
    );

    expect(screen.getByText(message)).toBeVisible();
    expect(screen.getByRole('button', { name: 'Go to dashboard' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Edit website' })).toBeVisible();
  });
});
