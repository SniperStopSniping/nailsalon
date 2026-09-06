import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { AppGrid, APPS } from './AppGrid';

/** WCAG relative luminance of an #rrggbb colour. */
function relativeLuminance(hex: string): number {
  const value = hex.replace('#', '');
  const channels = [0, 2, 4].map((offset) => {
    const channel = Number.parseInt(value.slice(offset, offset + 2), 16) / 255;
    return channel <= 0.03928
      ? channel / 12.92
      : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0]! + 0.7152 * channels[1]! + 0.0722 * channels[2]!;
}

/** Contrast of a white glyph on the given fill. */
function contrastWithWhite(hex: string): number {
  return 1.05 / (relativeLuminance(hex) + 0.05);
}

describe('AppGrid', () => {
  it('puts Booking Page first and keeps the tour and Luster after the business tools', () => {
    render(<AppGrid onAppTap={vi.fn()} />);
    const buttons = screen.getAllByRole('button');
    const indexOf = (id: string) =>
      buttons.findIndex(button => button.dataset.testid === `admin-app-tile-${id}`);

    expect(buttons[0]).toHaveAttribute('data-testid', 'admin-app-tile-booking-page');
    expect(indexOf('workspace-tour')).toBeGreaterThan(indexOf('portfolio'));
    expect(indexOf('luster')).toBeGreaterThan(indexOf('workspace-tour'));
    expect(indexOf('luster')).toBe(buttons.length - 1);
    expect(screen.getByTestId('admin-app-tile-staff-ops')).toHaveTextContent('Time-off requests');
  });

  it('shows the approved More apps, including the Integrations tile with its description', () => {
    render(
      <AppGrid
        onAppTap={vi.fn()}
        hiddenIds={['schedule', 'bookings', 'clients', 'services']}
      />,
    );

    for (const id of ['luster', 'integrations', 'marketing', 'settings', 'analytics', 'reviews', 'rewards', 'staff', 'staff-ops', 'workspace-tour']) {
      expect(screen.getByTestId(`admin-app-tile-${id}`)).toBeInTheDocument();
    }

    // Descriptions name the destination rather than a department. "Reviews"
    // in particular has to read differently from Marketing → Reviews, which is
    // where the Google review *link* is configured (AG-w2-more-tools-05).
    expect(screen.getByTestId('admin-app-tile-integrations')).toHaveTextContent(
      'Google Calendar, texting and email',
    );
    expect(screen.getByTestId('admin-app-tile-settings')).toHaveTextContent(
      'Business, booking and payment setup',
    );
    expect(screen.getByTestId('admin-app-tile-reviews')).toHaveTextContent(
      'Google review rewards',
    );
    expect(screen.getByTestId('admin-app-tile-workspace-tour')).toHaveTextContent(
      'Replay the five-step guide',
    );
  });

  it('hides bottom-nav destinations and entitlement-gated apps', () => {
    render(
      <AppGrid
        onAppTap={vi.fn()}
        hiddenIds={['schedule', 'bookings', 'clients', 'services', 'analytics', 'rewards']}
      />,
    );

    expect(screen.queryByTestId('admin-app-tile-schedule')).not.toBeInTheDocument();
    expect(screen.queryByTestId('admin-app-tile-clients')).not.toBeInTheDocument();
    expect(screen.queryByTestId('admin-app-tile-analytics')).not.toBeInTheDocument();
    expect(screen.queryByTestId('admin-app-tile-rewards')).not.toBeInTheDocument();
    expect(screen.getByTestId('admin-app-tile-integrations')).toBeInTheDocument();
  });

  it('names the entitlement-gated apps instead of letting them vanish, and never lists the nav-only four', () => {
    render(
      <AppGrid
        onAppTap={vi.fn()}
        hiddenIds={['schedule', 'bookings', 'clients', 'services', 'analytics', 'rewards']}
      />,
    );

    const locked = screen.getByTestId('more-locked-apps');

    expect(within(locked).getByTestId('locked-feature-analytics')).toHaveTextContent('Analytics');
    expect(within(locked).getByTestId('locked-feature-rewards')).toHaveTextContent('Rewards');
    expect(within(locked).getByTestId('locked-feature-analytics')).toHaveTextContent(
      /Not available for this salon yet/i,
    );
    expect(within(locked).queryByTestId('locked-feature-clients')).not.toBeInTheDocument();
    expect(within(locked).queryByTestId('locked-feature-schedule')).not.toBeInTheDocument();
  });

  it('has no locked section when every app this salon can have is on the grid', () => {
    render(
      <AppGrid
        onAppTap={vi.fn()}
        hiddenIds={['schedule', 'bookings', 'clients', 'services']}
      />,
    );

    expect(screen.queryByTestId('more-locked-apps')).not.toBeInTheDocument();
  });

  it('makes the entire tile tappable and reports the app id', () => {
    const onAppTap = vi.fn();
    render(<AppGrid onAppTap={onAppTap} hiddenIds={[]} />);

    fireEvent.click(screen.getByTestId('admin-app-tile-integrations'));

    expect(onAppTap).toHaveBeenCalledWith('integrations');
    expect(screen.getByTestId('admin-app-tile-integrations').tagName).toBe('BUTTON');
  });

  it('renders real badge counts only — zero renders no badge', () => {
    render(
      <AppGrid
        onAppTap={vi.fn()}
        hiddenIds={[]}
        badges={{ marketing: 3, reviews: 0 }}
      />,
    );

    expect(screen.getByTestId('admin-app-tile-marketing')).toHaveTextContent('3');
    expect(screen.getByTestId('admin-app-tile-reviews')).not.toHaveTextContent(/\d/);
  });

  it('keeps every icon chip dark enough for its white glyph', () => {
    // The old chips ran to stone-300 (#d6d3d1) and yellow-300 (#fde047),
    // where a white icon sits near 1.3:1. 4.5:1 is the text minimum and is
    // comfortably above the 3:1 floor for a graphical object.
    const failures = APPS.flatMap(app => [
      ['from', app.iconFrom] as const,
      ['to', app.iconTo] as const,
    ].filter(([, hex]) => contrastWithWhite(hex) < 4.5)
      .map(([stop, hex]) =>
        `${app.id} ${stop} ${hex} = ${contrastWithWhite(hex).toFixed(2)}:1`,
      ));

    expect(failures).toEqual([]);
  });

  describe('Account row', () => {
    it('is absent when the caller passes no account', () => {
      render(<AppGrid onAppTap={vi.fn()} />);

      expect(screen.queryByTestId('more-account')).not.toBeInTheDocument();
    });

    it('names the session and only logs out after a confirmation', () => {
      const onLogOut = vi.fn();
      render(
        <AppGrid
          account={{ name: 'Admin User', salonName: 'Nail Salon No.5', onLogOut }}
          onAppTap={vi.fn()}
        />,
      );

      const account = screen.getByTestId('more-account');

      expect(account).toHaveTextContent('Admin User');
      expect(account).toHaveTextContent('Signed in for Nail Salon No.5');

      fireEvent.click(screen.getByTestId('more-account-logout'));

      expect(onLogOut).not.toHaveBeenCalled();
      expect(screen.getByTestId('more-account-logout-confirm-panel')).toHaveTextContent(
        'Log out of Nail Salon No.5?',
      );
      expect(screen.getByTestId('more-account-logout-confirm')).toHaveFocus();

      fireEvent.click(screen.getByTestId('more-account-logout-confirm'));

      expect(onLogOut).toHaveBeenCalledTimes(1);
    });

    it('returns focus to Log out when the owner stays signed in', () => {
      const onLogOut = vi.fn();
      render(
        <AppGrid
          account={{ name: 'Admin User', salonName: 'Nail Salon No.5', onLogOut }}
          onAppTap={vi.fn()}
        />,
      );

      fireEvent.click(screen.getByTestId('more-account-logout'));
      fireEvent.click(screen.getByTestId('more-account-logout-cancel'));

      expect(onLogOut).not.toHaveBeenCalled();
      expect(screen.queryByTestId('more-account-logout-confirm-panel')).not.toBeInTheDocument();
      expect(screen.getByTestId('more-account-logout')).toHaveFocus();
    });
  });
});
