import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { QuickActionsWidget } from './QuickActionsWidget';

describe('QuickActionsWidget', () => {
  // AG-today-calendar-01: the four shortcuts on the owner's main screen used to
  // expose no accessible name at all — the caption sat outside the button.
  it('exposes every quick action as a named button', () => {
    render(<QuickActionsWidget />);

    for (const name of ['New Appt', 'Walk-in', 'Send SMS', 'Schedule']) {
      expect(screen.getByRole('button', { name })).toBeInTheDocument();
    }
  });

  it('reports the action id when a named button is activated', async () => {
    const user = userEvent.setup();
    const onAction = vi.fn();
    render(<QuickActionsWidget onAction={onAction} />);

    await user.click(screen.getByRole('button', { name: 'Send SMS' }));

    expect(onAction).toHaveBeenCalledWith('send-sms');
  });

  it('does not leak the decorative icon tile into the accessible name', () => {
    render(<QuickActionsWidget />);

    const button = screen.getByRole('button', { name: 'Walk-in' });

    expect(button.querySelector('[aria-hidden="true"]')).not.toBeNull();
    expect(button).toHaveAccessibleName('Walk-in');
  });
});
