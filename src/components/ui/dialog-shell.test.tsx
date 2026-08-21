import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useRef, useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { DialogShell } from './dialog-shell';

const noop = () => {};

function OpenableDialog({
  onClose = noop,
  withInitialTarget = false,
}: {
  onClose?: () => void;
  withInitialTarget?: boolean;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const initialFocusRef = useRef<HTMLButtonElement>(null);

  return (
    <>
      <button type="button" onClick={() => setIsOpen(true)}>Open dialog</button>
      <DialogShell
        isOpen={isOpen}
        initialFocusRef={withInitialTarget ? initialFocusRef : undefined}
        onClose={() => {
          onClose();
          setIsOpen(false);
        }}
      >
        <button type="button">First action</button>
        <button ref={initialFocusRef} type="button">Preferred action</button>
        <button type="button" onClick={() => setIsOpen(false)}>Close dialog</button>
      </DialogShell>
    </>
  );
}

describe('DialogShell', () => {
  it('escapes transformed dashboard ancestors and keeps a shrinkable viewport container', async () => {
    render(
      <div data-testid="transformed-parent" style={{ transform: 'translateX(0)' }}>
        <DialogShell isOpen onClose={vi.fn()}>
          <div>Dialog content</div>
        </DialogShell>
      </div>,
    );

    const overlay = await screen.findByTestId('dialog-shell-overlay');
    const container = screen.getByTestId('dialog-shell-container');
    const content = screen.getByTestId('dialog-shell-content');

    expect(overlay.parentElement).toBe(document.body);
    expect(overlay).toHaveClass('fixed', 'inset-0', 'min-h-0');
    expect(container).toHaveClass('min-h-0', 'w-full');
    expect(content).toHaveClass('touch-pan-y', 'overflow-y-auto', 'overscroll-contain');
    expect(screen.getByTestId('transformed-parent')).not.toContainElement(overlay);
  });

  it('honors an explicit initial-focus target', async () => {
    const user = userEvent.setup();
    render(<OpenableDialog withInitialTarget />);

    const opener = screen.getByRole('button', { name: 'Open dialog' });
    await user.click(opener);

    await waitFor(() => expect(screen.getByRole('button', { name: 'Preferred action' })).toHaveFocus());
  });

  it('honors an existing autofocus target', async () => {
    const user = userEvent.setup();

    function AutofocusHarness() {
      const [isOpen, setIsOpen] = useState(false);
      return (
        <>
          <button type="button" onClick={() => setIsOpen(true)}>Open autofocus dialog</button>
          <DialogShell isOpen={isOpen} onClose={() => setIsOpen(false)}>
            <button type="button">First action</button>
            <button type="button" autoFocus>Autofocus action</button>
          </DialogShell>
        </>
      );
    }

    render(<AutofocusHarness />);
    const opener = screen.getByRole('button', { name: 'Open autofocus dialog' });
    await user.click(opener);

    await waitFor(() => expect(screen.getByRole('button', { name: 'Autofocus action' })).toHaveFocus());

    await user.keyboard('{Escape}');
    await waitFor(() => expect(opener).toHaveFocus());
  });

  it('focuses the first usable element and skips disabled or hidden controls', async () => {
    render(
      <DialogShell isOpen onClose={vi.fn()}>
        <button type="button" disabled>Disabled action</button>
        <button type="button" hidden>Hidden action</button>
        <button type="button" style={{ display: 'none' }}>CSS-hidden action</button>
        <button type="button">Usable action</button>
      </DialogShell>,
    );

    await waitFor(() => expect(screen.getByRole('button', { name: 'Usable action' })).toHaveFocus());
  });

  it('uses the dialog content as a safe fallback when there are no focusable children', async () => {
    render(
      <DialogShell isOpen onClose={vi.fn()}>
        <p>Nothing to act on</p>
      </DialogShell>,
    );

    await waitFor(() => expect(screen.getByTestId('dialog-shell-content')).toHaveFocus());
  });

  it('wraps Tab and Shift+Tab within the usable controls', async () => {
    const user = userEvent.setup();
    render(
      <DialogShell isOpen onClose={vi.fn()}>
        <button type="button">First action</button>
        <button type="button" disabled>Disabled action</button>
        <button type="button" hidden>Hidden action</button>
        <button type="button">Middle action</button>
        <button type="button">Last action</button>
      </DialogShell>,
    );

    const first = screen.getByRole('button', { name: 'First action' });
    const middle = screen.getByRole('button', { name: 'Middle action' });
    const last = screen.getByRole('button', { name: 'Last action' });

    await waitFor(() => expect(first).toHaveFocus());
    await user.tab();

    expect(middle).toHaveFocus();

    await user.tab();

    expect(last).toHaveFocus();

    await user.tab();

    expect(first).toHaveFocus();

    await user.tab({ shift: true });

    expect(last).toHaveFocus();

    for (let index = 0; index < 6; index += 1) {
      await user.tab();

      expect(screen.getByTestId('dialog-shell-overlay')).toContainElement(document.activeElement as HTMLElement);
    }
  });

  it('restores opener focus after an explicit close and after Escape', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<OpenableDialog onClose={onClose} />);

    const opener = screen.getByRole('button', { name: 'Open dialog' });
    await user.click(opener);
    await waitFor(() => expect(screen.getByRole('button', { name: 'First action' })).toHaveFocus());
    await user.click(screen.getByRole('button', { name: 'Close dialog' }));
    await waitFor(() => expect(opener).toHaveFocus());

    await user.click(opener);
    await waitFor(() => expect(screen.getByRole('button', { name: 'First action' })).toHaveFocus());
    await user.keyboard('{Escape}');
    await waitFor(() => expect(opener).toHaveFocus());

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('restores a recent pointer opener when the browser does not focus it on activation', async () => {
    const user = userEvent.setup();

    function PointerOpenerHarness() {
      const [isOpen, setIsOpen] = useState(false);
      return (
        <>
          <button type="button">Previously focused control</button>
          <div
            role="button"
            tabIndex={0}
            onClick={() => setIsOpen(true)}
            onKeyDown={event => (event.key === 'Enter' || event.key === ' ') && setIsOpen(true)}
          >
            Open pointer dialog
          </div>
          <DialogShell isOpen={isOpen} onClose={() => setIsOpen(false)}>
            <button type="button">Dialog action</button>
          </DialogShell>
        </>
      );
    }

    render(<PointerOpenerHarness />);
    const previous = screen.getByRole('button', { name: 'Previously focused control' });
    const opener = screen.getByRole('button', { name: 'Open pointer dialog' });
    previous.focus();

    fireEvent.pointerDown(opener);
    fireEvent.click(opener);

    await waitFor(() => expect(screen.getByRole('button', { name: 'Dialog action' })).toHaveFocus());
    await user.keyboard('{Escape}');
    await waitFor(() => expect(opener).toHaveFocus());
  });

  it('restores a keyed replacement when the pointer opener is remounted after close', async () => {
    const user = userEvent.setup();

    function RemountedPointerOpenerHarness() {
      const [isOpen, setIsOpen] = useState(false);
      return (
        <>
          {!isOpen && (
            <div
              role="button"
              tabIndex={0}
              data-dialog-return-focus-key="remounted-opener"
              onClick={() => setIsOpen(true)}
              onKeyDown={event => (event.key === 'Enter' || event.key === ' ') && setIsOpen(true)}
            >
              Open remounting dialog
            </div>
          )}
          <DialogShell isOpen={isOpen} onClose={() => setIsOpen(false)}>
            <button type="button">Dialog action</button>
          </DialogShell>
        </>
      );
    }

    render(<RemountedPointerOpenerHarness />);
    const opener = screen.getByRole('button', { name: 'Open remounting dialog' });

    fireEvent.pointerDown(opener);
    fireEvent.click(opener);

    await waitFor(() => expect(screen.getByRole('button', { name: 'Dialog action' })).toHaveFocus());
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Open remounting dialog' })).toHaveFocus());
  });

  it('does not throw or focus a stale opener that was removed during close', async () => {
    const user = userEvent.setup();

    function RemovedOpenerHarness() {
      const [isOpen, setIsOpen] = useState(false);
      const [showOpener, setShowOpener] = useState(true);
      return (
        <>
          {showOpener && (
            <button type="button" onClick={() => setIsOpen(true)}>Open removable dialog</button>
          )}
          <DialogShell isOpen={isOpen} onClose={() => setIsOpen(false)}>
            <button
              type="button"
              onClick={() => {
                setShowOpener(false);
                setIsOpen(false);
              }}
            >
              Remove opener and close
            </button>
          </DialogShell>
        </>
      );
    }

    render(<RemovedOpenerHarness />);
    await user.click(screen.getByRole('button', { name: 'Open removable dialog' }));
    await user.click(screen.getByRole('button', { name: 'Remove opener and close' }));

    await waitFor(() => expect(screen.queryByTestId('dialog-shell-overlay')).not.toBeInTheDocument());

    expect(document.body).toHaveFocus();
  });

  it('does not steal focus placed by navigation while the dialog unmounts', async () => {
    const user = userEvent.setup();

    function NavigationHarness() {
      const [showDialog, setShowDialog] = useState(false);
      const destinationRef = useRef<HTMLButtonElement>(null);
      return (
        <>
          <button type="button" onClick={() => setShowDialog(true)}>Open navigation dialog</button>
          <button ref={destinationRef} type="button">Navigation destination</button>
          {showDialog && (
            <DialogShell isOpen onClose={() => setShowDialog(false)}>
              <button
                type="button"
                onClick={() => {
                  destinationRef.current?.focus();
                  setShowDialog(false);
                }}
              >
                Navigate away
              </button>
            </DialogShell>
          )}
        </>
      );
    }

    render(<NavigationHarness />);
    await user.click(screen.getByRole('button', { name: 'Open navigation dialog' }));
    await user.click(screen.getByRole('button', { name: 'Navigate away' }));

    await waitFor(() => expect(screen.getByRole('button', { name: 'Navigation destination' })).toHaveFocus());
  });

  it('does not accumulate Escape listeners across reopen cycles', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<OpenableDialog onClose={onClose} />);

    const opener = screen.getByRole('button', { name: 'Open dialog' });
    for (let cycle = 1; cycle <= 3; cycle += 1) {
      await user.click(opener);
      await waitFor(() => expect(screen.getByRole('button', { name: 'First action' })).toHaveFocus());
      await user.keyboard('{Escape}');
      await waitFor(() => expect(opener).toHaveFocus());

      expect(onClose).toHaveBeenCalledTimes(cycle);
    }
  });

  it('keeps nested focus and Escape handling on the topmost dialog', async () => {
    const user = userEvent.setup();

    function NestedDialogHarness() {
      const [outerOpen, setOuterOpen] = useState(false);
      const [innerOpen, setInnerOpen] = useState(false);
      return (
        <>
          <button type="button" onClick={() => setOuterOpen(true)}>Open outer dialog</button>
          <DialogShell isOpen={outerOpen} onClose={() => setOuterOpen(false)}>
            <button type="button" onClick={() => setInnerOpen(true)}>Open inner dialog</button>
            <button type="button">Outer final action</button>
            <DialogShell isOpen={innerOpen} onClose={() => setInnerOpen(false)}>
              <button type="button">Inner first action</button>
              <button type="button">Inner final action</button>
            </DialogShell>
          </DialogShell>
        </>
      );
    }

    render(<NestedDialogHarness />);
    const outerOpener = screen.getByRole('button', { name: 'Open outer dialog' });
    await user.click(outerOpener);

    const innerOpener = screen.getByRole('button', { name: 'Open inner dialog' });
    await waitFor(() => expect(innerOpener).toHaveFocus());
    await user.click(innerOpener);

    const innerFirst = screen.getByRole('button', { name: 'Inner first action' });
    const innerLast = screen.getByRole('button', { name: 'Inner final action' });
    await waitFor(() => expect(innerFirst).toHaveFocus());
    innerLast.focus();
    fireEvent.keyDown(window, { key: 'Tab' });

    expect(innerFirst).toHaveFocus();

    await user.keyboard('{Escape}');
    await waitFor(() => expect(innerOpener).toHaveFocus());

    expect(screen.getAllByTestId('dialog-shell-overlay')).toHaveLength(1);

    await user.keyboard('{Escape}');
    await waitFor(() => expect(outerOpener).toHaveFocus());

    expect(screen.queryByTestId('dialog-shell-overlay')).not.toBeInTheDocument();
  });
});
