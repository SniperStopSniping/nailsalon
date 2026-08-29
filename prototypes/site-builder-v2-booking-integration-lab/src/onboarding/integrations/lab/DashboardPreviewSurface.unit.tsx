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

  const renderSurface = (options: { auditMode?: boolean; tourCompleted?: boolean } = {}) => {
    const onEditWebsite = vi.fn();
    const onReturnToReview = vi.fn();
    const onTourCompletedChange = vi.fn();

    function Harness() {
      const [tourCompleted, setTourCompleted] = useState(options.tourCompleted ?? false);
      return (
        <DashboardPreviewSurface
          auditMode={options.auditMode}
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

  it('arrives directly at the dashboard payoff and never auto-opens the optional tour', async () => {
    renderSurface();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'Your Luster site is ready' })).toBeVisible();
    expect(screen.getByText(/website, booking page and service menu are set up/iu)).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Today at Isla Nail Studio' })).toBeVisible();
    await waitFor(() => expect(screen.getByRole('heading', { level: 1, name: 'Your Luster site is ready' })).toHaveFocus());
  });

  it('orders Today and Website first and keeps website editing one action away', async () => {
    const user = userEvent.setup();
    const { onEditWebsite } = renderSurface();
    const navigation = screen.getByRole('navigation', { name: 'Dashboard destinations' });
    expect(within(navigation).getAllByRole('button').map((button) => button.textContent?.trim())).toEqual([
      'Today',
      'Website & Booking Page',
      'Calendar',
      'Clients',
      'Services',
      'More',
    ]);
    expect(within(navigation).getByRole('button', { name: 'Today' })).toHaveAttribute('aria-current', 'page');
    await user.click(screen.getByRole('button', { name: 'Edit my website' }));
    expect(onEditWebsite).toHaveBeenCalledOnce();
  });

  it('opens the five-step tour only on request and highlights the real storyboard', async () => {
    const user = userEvent.setup();
    const { onTourCompletedChange } = renderSurface();
    const welcome = screen.getByRole('heading', { name: 'Your Luster site is ready' }).closest('section')!;
    await user.click(within(welcome).getByRole('button', { name: 'Take a quick tour' }));

    const dialog = screen.getByRole('dialog', { name: 'A quick look around Luster' });
    expect(within(dialog).getByText('1 of 5')).toBeVisible();
    expect(document.querySelector('.lab-dashboard-storyboard')).toHaveAttribute('data-tour-highlighted', 'true');
    expect(document.querySelector('.lab-dashboard-tour__miniature')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Today at Isla Nail Studio' })).toBeVisible();

    await user.click(within(dialog).getByRole('button', { name: /Next/iu }));
    expect(within(dialog).getByText('2 of 5')).toBeVisible();
    expect(within(dialog).getByRole('heading', { name: 'Your calendar' })).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Calendar' })).toBeVisible();
    expect(within(dialog).getByText(/after you connect Google Calendar/iu)).toBeVisible();
    await user.click(within(dialog).getByRole('button', { name: /Back/iu }));
    expect(within(dialog).getByText('1 of 5')).toBeVisible();

    await user.click(within(dialog).getByRole('button', { name: 'Skip tour' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(onTourCompletedChange).toHaveBeenCalledWith(true);
    expect(document.querySelector('.lab-dashboard-storyboard')).not.toHaveAttribute('data-tour-highlighted');
    expect(screen.getByRole('button', { name: 'Replay tour' })).toBeVisible();
  });

  it('supports Next, Back, Done, replay, and focus restoration', async () => {
    const user = userEvent.setup();
    renderSurface({ tourCompleted: true });
    const replay = screen.getByRole('button', { name: 'Replay tour' });
    await user.click(replay);
    for (let index = 0; index < 4; index += 1) {
      await user.click(screen.getByRole('button', { name: /Next/iu }));
    }
    expect(screen.getByText('5 of 5')).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Done' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Today at Isla Nail Studio' })).toHaveFocus());

    await user.click(screen.getByRole('button', { name: 'Replay tour' }));
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Replay tour' })).toHaveFocus());
  });

  it('derives Services from selected canonical IDs without creating dashboard records', async () => {
    const user = userEvent.setup();
    const commonProps = {
      document: initializeStarter('one_page', { siteName: profile.businessName }),
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

    view.rerender(<DashboardPreviewSurface {...commonProps} selectedServiceIds={['svc-manicure-gel']} />);
    expect(screen.getByText('1 selected service')).toBeVisible();
    expect(screen.getByText('Gel Manicure')).toBeVisible();
    expect(screen.queryByText('Russian Manicure')).not.toBeInTheDocument();
  });

  it('groups checklist state into Done and Whenever you’re ready with truthful labels', () => {
    renderSurface();
    const checklist = screen.getByRole('heading', { name: 'What’s next' }).closest('aside')!;
    const done = within(checklist).getByRole('heading', { name: 'Done' }).closest('section')!;
    const next = within(checklist).getByRole('heading', { name: 'Whenever you’re ready' }).closest('section')!;
    expect(within(done).getByText('Website created')).toBeVisible();
    expect(within(done).getByText('Booking page ready')).toBeVisible();
    expect(within(done).getByText('Services added')).toBeVisible();
    expect(within(done).getByText('Share booking link')).toBeVisible();
    expect(within(next).getByText('Connect Google Calendar')).toBeVisible();
    expect(within(next).getByText('Set up payments')).toBeVisible();
    expect(within(next).getByText('Not connected')).toBeVisible();
    expect(within(checklist).queryByText('Not shared yet')).not.toBeInTheDocument();
    expect(within(next).queryByRole('img', { name: /warning|error/iu })).not.toBeInTheDocument();
  });

  it('hides technical Review controls in normal mode and exposes them only in audit mode', async () => {
    const normal = renderSurface();
    expect(screen.queryByRole('button', { name: 'Return to onboarding review · Lab only' })).not.toBeInTheDocument();
    expect(screen.queryByText(/fixture states/iu)).not.toBeInTheDocument();
    normal.unmount();

    const user = userEvent.setup();
    const audit = renderSurface({ auditMode: true });
    await user.click(screen.getByRole('button', { name: 'Return to onboarding review · Lab only' }));
    expect(audit.onReturnToReview).toHaveBeenCalledOnce();
    expect(screen.getByText(/explicit UX Lab fixture states/iu)).toBeVisible();
  });

  it('makes Explore dashboard visibly dismiss the welcome and focus Today', async () => {
    const user = userEvent.setup();
    renderSurface();
    await user.click(screen.getByRole('button', { name: 'Explore dashboard' }));
    expect(screen.queryByText(/website, booking page and service menu are set up/iu)).not.toBeInTheDocument();
    const todayHeading = screen.getByRole('heading', { name: 'Today at Isla Nail Studio' });
    await waitFor(() => expect(todayHeading).toHaveFocus());
  });

  it.each([
    ['free', 'Free selected'],
    ['monthly', 'Monthly interest saved — we’ll let you know when details are ready'],
    ['founding', 'Founding offer reserved — we’ll let you know when details are ready'],
  ] as const)('shows the truthful %s intent at dashboard arrival', (planIntent, message) => {
    render(
      <DashboardPreviewSurface
        document={initializeStarter('one_page', { siteName: profile.businessName })}
        fixtures={{ googleCalendar: 'not_connected', payments: 'not_connected', shareBookingLink: 'not_connected' }}
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
    expect(screen.queryByText(/purchased|charged|entitled/iu)).not.toBeInTheDocument();
  });
});
