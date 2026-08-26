import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StrictMode, useState } from 'react';
import { afterEach, vi } from 'vitest';

import { Dialog } from './Dialog';

const installViewport = (wide: boolean): void => {
  vi.stubGlobal('matchMedia', vi.fn((query: string): MediaQueryList => ({
    matches: wide && query.includes('min-width: 900px'),
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(() => true),
  })));
};

function NestedDialogHarness() {
  const [outerOpen, setOuterOpen] = useState(false);
  const [innerOpen, setInnerOpen] = useState(false);

  return (
    <>
      <button type="button" onClick={() => setOuterOpen(true)}>Open Move</button>
      <Dialog onClose={() => setOuterOpen(false)} open={outerOpen} title="Move Booking">
        <button type="button" onClick={() => setInnerOpen(true)}>Open warning</button>
        <button type="button" onClick={() => setOuterOpen(false)}>Close Move</button>
      </Dialog>
      <Dialog onClose={() => setInnerOpen(false)} open={innerOpen} title="Keep this new order?">
        <button type="button" onClick={() => setInnerOpen(false)}>Return to Move</button>
        <button
          type="button"
          onClick={() => {
            setInnerOpen(false);
            setOuterOpen(false);
          }}
        >
          Close both
        </button>
      </Dialog>
    </>
  );
}

function DesktopMoveHarness() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>Open desktop Move</button>
      <Dialog onClose={() => setOpen(false)} open={open} title="Move Booking" variant="move-panel">
        <p>Move controls</p>
      </Dialog>
    </>
  );
}

afterEach(() => {
  document.body.style.removeProperty('overflow');
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('Dialog document lifecycle', () => {
  it('releases nested modal locks only after the final owner closes and restores the exact baseline', async () => {
    installViewport(false);
    document.body.style.setProperty('overflow', 'auto', 'important');
    const user = userEvent.setup();
    render(<StrictMode><NestedDialogHarness /></StrictMode>);
    const trigger = screen.getByRole('button', { name: 'Open Move' });

    for (let cycle = 0; cycle < 3; cycle += 1) {
      await user.click(trigger);
      expect(document.body.style.overflow).toBe('hidden');
      await user.click(screen.getByRole('button', { name: 'Open warning' }));
      expect(document.body.style.overflow).toBe('hidden');

      await user.click(screen.getByRole('button', { name: 'Return to Move' }));
      expect(document.body.style.overflow).toBe('hidden');
      expect(screen.getByRole('dialog', { name: 'Move Booking' })).toBeVisible();

      await user.click(screen.getByRole('button', { name: 'Open warning' }));
      await user.click(screen.getByRole('button', { name: 'Close both' }));

      await waitFor(() => expect(document.body.style.overflow).toBe('auto'));
      expect(document.body.style.getPropertyPriority('overflow')).toBe('important');
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      await waitFor(() => expect(trigger).toHaveFocus());
    }
  });

  it('gives a desktop Move panel a clickable modal backdrop without losing adjacent geometry', async () => {
    installViewport(true);
    const user = userEvent.setup();
    render(<StrictMode><DesktopMoveHarness /></StrictMode>);
    const trigger = screen.getByRole('button', { name: 'Open desktop Move' });
    await user.click(trigger);

    const backdrop = screen.getByTestId('dialog-backdrop');
    expect(backdrop).toHaveClass('dialog-backdrop--adjacent');
    expect(screen.queryByTestId('dialog-nonmodal-layer')).not.toBeInTheDocument();
    expect(document.body.style.overflow).toBe('hidden');

    fireEvent.mouseDown(backdrop);

    await waitFor(() => expect(document.body.style.overflow).toBe(''));
    expect(screen.queryByRole('dialog', { name: 'Move Booking' })).not.toBeInTheDocument();
    await waitFor(() => expect(trigger).toHaveFocus());
  });
});
