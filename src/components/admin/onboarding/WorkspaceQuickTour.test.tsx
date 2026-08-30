import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { WorkspaceQuickTour } from './WorkspaceQuickTour';

describe('WorkspaceQuickTour', () => {
  it('is optional, stays on the real workspace, and visits only the approved five targets', () => {
    const onClose = vi.fn();
    const onComplete = vi.fn();
    const onTargetChange = vi.fn();

    render(
      <WorkspaceQuickTour
        onClose={onClose}
        onComplete={onComplete}
        onTargetChange={onTargetChange}
        open
      />,
    );

    expect(screen.getByRole('dialog', { name: 'Your day at a glance' })).toBeInTheDocument();
    expect(onTargetChange).toHaveBeenLastCalledWith('today');

    fireEvent.click(screen.getByRole('button', { name: /Next/i }));

    expect(screen.getByRole('dialog', { name: 'Your calendar' })).toBeInTheDocument();
    expect(onTargetChange).toHaveBeenLastCalledWith('calendar');

    fireEvent.click(screen.getByRole('button', { name: /Back/i }));

    expect(screen.getByRole('dialog', { name: 'Your day at a glance' })).toBeInTheDocument();

    for (const target of ['calendar', 'clients', 'services', 'website']) {
      fireEvent.click(screen.getByRole('button', { name: /Next|Done/i }));

      expect(onTargetChange).toHaveBeenLastCalledWith(target);
    }
    fireEvent.click(screen.getByRole('button', { name: /Done/i }));

    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it('keeps Skip tour reachable and supports Escape without stealing focus on close', () => {
    const opener = document.createElement('button');
    document.body.append(opener);
    opener.focus();
    const onClose = vi.fn();

    const view = render(
      <WorkspaceQuickTour
        onClose={onClose}
        onComplete={vi.fn()}
        onTargetChange={vi.fn()}
        open
      />,
    );

    expect(screen.getAllByRole('button', { name: 'Skip tour' }).length).toBeGreaterThan(0);

    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });

    expect(onClose).toHaveBeenCalledTimes(1);

    view.unmount();

    expect(opener).toHaveFocus();

    opener.remove();
  });
});
