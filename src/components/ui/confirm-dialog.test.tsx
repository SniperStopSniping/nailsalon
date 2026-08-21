import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { ConfirmDialog } from './confirm-dialog';

function renderDialog(overrides: Partial<Parameters<typeof ConfirmDialog>[0]> = {}) {
  const handlers = { onConfirm: vi.fn(), onClose: vi.fn() };
  render(
    <ConfirmDialog
      isOpen
      title="Cancel appointment?"
      description="This frees the time slot."
      confirmLabel="Cancel appointment"
      {...handlers}
      {...overrides}
    />,
  );
  return handlers;
}

describe('ConfirmDialog', () => {
  it('uses the shared focus lifecycle and returns focus to its opener', async () => {
    const user = userEvent.setup();

    function ConfirmDialogHarness() {
      const [isOpen, setIsOpen] = useState(false);
      return (
        <>
          <button type="button" onClick={() => setIsOpen(true)}>Open confirmation</button>
          <ConfirmDialog
            isOpen={isOpen}
            title="Cancel appointment?"
            confirmLabel="Cancel appointment"
            onConfirm={() => setIsOpen(false)}
            onClose={() => setIsOpen(false)}
          />
        </>
      );
    }

    render(<ConfirmDialogHarness />);
    const opener = screen.getByRole('button', { name: 'Open confirmation' });
    await user.click(opener);

    const cancel = screen.getByTestId('confirm-dialog-cancel');
    const confirm = screen.getByTestId('confirm-dialog-confirm');
    await waitFor(() => expect(cancel).toHaveFocus());

    confirm.focus();
    await user.tab();

    expect(cancel).toHaveFocus();

    await user.click(confirm);
    await waitFor(() => expect(opener).toHaveFocus());
  });

  it('renders title, description, and fires confirm/cancel callbacks', () => {
    const handlers = renderDialog();

    expect(screen.getByText('Cancel appointment?')).toBeInTheDocument();
    expect(screen.getByText('This frees the time slot.')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('confirm-dialog-confirm'));
    fireEvent.click(screen.getByTestId('confirm-dialog-cancel'));

    expect(handlers.onConfirm).toHaveBeenCalledTimes(1);
    expect(handlers.onClose).toHaveBeenCalledTimes(1);
  });

  it('disables both actions and backdrop dismissal while busy', () => {
    const handlers = renderDialog({ busy: true });

    expect(screen.getByTestId('confirm-dialog-confirm')).toBeDisabled();
    expect(screen.getByTestId('confirm-dialog-cancel')).toBeDisabled();

    fireEvent.click(screen.getByRole('presentation'));

    expect(handlers.onClose).not.toHaveBeenCalled();
  });

  it('closes on backdrop click when not busy', () => {
    const handlers = renderDialog();

    fireEvent.click(screen.getByRole('presentation'));

    expect(handlers.onClose).toHaveBeenCalledTimes(1);
  });

  it('renders children between description and actions', () => {
    renderDialog({ children: <div data-testid="dialog-extra">Reason picker</div> });

    expect(screen.getByTestId('dialog-extra')).toBeInTheDocument();
  });
});
