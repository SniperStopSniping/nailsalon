import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { StaffBottomNav } from './StaffBottomNav';

vi.mock('next/navigation', () => ({
  useParams: () => ({ locale: 'en' }),
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock('@/hooks/useStaffCapabilities', () => ({
  useStaffCapabilities: () => ({ modules: { staffEarnings: true } }),
}));

describe('StaffBottomNav', () => {
  it('composes contextual action and navigation into one fixed safe-area region', () => {
    render(
      <StaffBottomNav
        activeItem="home"
        action={<button type="button">Start Service for Morgan</button>}
      />,
    );

    const region = screen.getByTestId('staff-bottom-region');

    expect(region).toHaveClass('fixed', 'inset-x-0', 'bottom-0');
    expect(region.querySelectorAll('.fixed')).toHaveLength(0);
    expect(screen.getByTestId('staff-bottom-context-action')).toContainElement(
      screen.getByRole('button', { name: 'Start Service for Morgan' }),
    );
    expect(screen.getByRole('navigation', { name: 'Staff navigation' })).toHaveStyle({
      paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom, 0px))',
    });
    expect(screen.getByRole('button', { name: 'Home' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Photos' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Schedule' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Earnings' })).toBeEnabled();
  });
});
