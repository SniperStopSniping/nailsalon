import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { WorkspaceQuickTour } from './WorkspaceQuickTour';

describe('WorkspaceQuickTour', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

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

  it('names the destination each step has opened', () => {
    render(
      <WorkspaceQuickTour
        onClose={vi.fn()}
        onComplete={vi.fn()}
        onTargetChange={vi.fn()}
        open
      />,
    );

    expect(screen.getByTestId('workspace-tour-where')).toHaveTextContent('Now open: Today tab');

    for (const where of ['Calendar tab', 'Clients tab', 'Services tab', 'More → Booking Page']) {
      fireEvent.click(screen.getByRole('button', { name: /Next/i }));

      expect(screen.getByTestId('workspace-tour-where')).toHaveTextContent(`Now open: ${where}`);
    }
  });

  it('takes focus back from a surface that a step opened underneath it', () => {
    render(
      <WorkspaceQuickTour
        onClose={vi.fn()}
        onComplete={vi.fn()}
        onTargetChange={vi.fn()}
        open
      />,
    );

    // Stand in for the Clients / Services sheet: the step's own surface mounts
    // behind the card and places its initial focus on itself.
    const sheetButton = document.createElement('button');
    document.body.append(sheetButton);

    fireEvent.click(screen.getByRole('button', { name: /Next/i }));
    sheetButton.focus();

    expect(sheetButton).toHaveFocus();

    act(() => {
      vi.advanceTimersByTime(200);
    });

    expect(screen.getByRole('dialog')).toHaveFocus();

    sheetButton.remove();
  });

  it('keeps Escape and Tab for itself while a sheet is open behind it', () => {
    const onClose = vi.fn();
    const sheetEscape = vi.fn();
    window.addEventListener('keydown', sheetEscape);

    render(
      <WorkspaceQuickTour
        onClose={onClose}
        onComplete={vi.fn()}
        onTargetChange={vi.fn()}
        open
      />,
    );

    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });

    expect(onClose).toHaveBeenCalledTimes(1);
    // The shared modal focus lifecycle listens on window in the bubble phase;
    // if it saw this key it would close the sheet behind the tour instead.
    expect(sheetEscape).not.toHaveBeenCalled();

    window.removeEventListener('keydown', sheetEscape);
  });
});
