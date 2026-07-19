import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { AppGrid } from './AppGrid';

describe('AppGrid', () => {
  it('shows the approved More apps, including the Integrations tile with its description', () => {
    render(
      <AppGrid
        onAppTap={vi.fn()}
        hiddenIds={['schedule', 'bookings', 'clients', 'services']}
      />,
    );

    for (const id of ['luster', 'integrations', 'marketing', 'settings', 'analytics', 'reviews', 'rewards', 'staff', 'staff-ops']) {
      expect(screen.getByTestId(`admin-app-tile-${id}`)).toBeInTheDocument();
    }

    expect(screen.getByTestId('admin-app-tile-integrations')).toHaveTextContent(
      'Calendar, text and email',
    );
    expect(screen.getByTestId('admin-app-tile-settings')).toHaveTextContent(
      'Business and booking setup',
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
});
