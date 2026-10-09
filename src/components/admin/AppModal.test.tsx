import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { DialogShell } from '@/components/ui/dialog-shell';

import { AppModal } from './AppModal';

vi.mock('framer-motion', async () => {
  const React = await import('react');
  const MotionDiv = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement> & Record<string, unknown>>(
    (props, ref) => {
      const domProps = { ...props };
      const children = domProps.children as React.ReactNode;

      for (const key of [
        'animate',
        'children',
        'drag',
        'dragConstraints',
        'dragControls',
        'dragElastic',
        'dragListener',
        'exit',
        'initial',
        'onDragEnd',
        'transition',
      ]) {
        delete domProps[key];
      }

      return React.createElement('div', { ...domProps, ref }, children);
    },
  );
  MotionDiv.displayName = 'MotionDiv';

  return {
    AnimatePresence: ({ children }: { children: React.ReactNode }) => children,
    motion: {
      div: MotionDiv,
    },
    useAnimation: () => ({ start: vi.fn() }),
    useDragControls: () => ({ start: vi.fn() }),
  };
});

describe('AppModal', () => {
  it.each(['Close', 'Escape'])('waits for a loading shortcut to remount after %s', async (dismissal) => {
    const user = userEvent.setup();
    function Workspace({ balanceReady }: { balanceReady: boolean }) {
      const [open, setOpen] = useState(true);
      return (
        <>
          {balanceReady && <button type="button" data-dialog-return-focus-key="sms:isla:today:topup">Buy texts</button>}
          <AppModal isOpen={open} onClose={() => setOpen(false)} returnFocusKey="sms:isla:today:topup">
            <DialogShell isOpen={open} onClose={() => setOpen(false)}>
              <button type="button" onClick={() => setOpen(false)}>Close credits</button>
            </DialogShell>
          </AppModal>
        </>
      );
    }
    const { rerender } = render(<Workspace balanceReady={false} />);
    if (dismissal === 'Escape') {
      await user.keyboard('{Escape}');
    } else {
      await user.click(screen.getByRole('button', { name: 'Close credits' }));
    }
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Close credits' })).not.toBeInTheDocument());
    rerender(<Workspace balanceReady />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Buy texts' })).toHaveFocus());
  });

  it.each(['pointer', 'keyboard', 'focus'])('does not steal deferred shortcut focus after another %s interaction', async (interaction) => {
    function Workspace({ open, balanceReady }: { open: boolean; balanceReady: boolean }) {
      return (
        <>
          <button type="button">Another action</button>
          {balanceReady && <button type="button" data-dialog-return-focus-key="sms:isla:today:topup">Buy texts</button>}
          <AppModal isOpen={open} onClose={() => {}} returnFocusKey="sms:isla:today:topup">
            <button type="button">Close credits</button>
          </AppModal>
        </>
      );
    }
    const { rerender } = render(<Workspace open balanceReady={false} />);
    rerender(<Workspace open={false} balanceReady={false} />);
    await act(async () => {});
    if (interaction === 'focus') {
      screen.getByRole('button', { name: 'Another action' }).focus();
    } else if (interaction === 'pointer') {
      fireEvent.pointerDown(document.body);
    } else {
      fireEvent.keyDown(window, { key: 'Tab' });
    }
    rerender(<Workspace open={false} balanceReady />);
    await act(async () => {});

    expect(screen.getByRole('button', { name: 'Buy texts' })).not.toHaveFocus();
  });

  it('expires deferred shortcut focus instead of moving focus after a slow request', async () => {
    vi.useFakeTimers();
    try {
      const { rerender } = render(
        <AppModal isOpen onClose={() => {}} returnFocusKey="sms:isla:today:topup"><button type="button">Close credits</button></AppModal>,
      );
      rerender(<AppModal isOpen={false} onClose={() => {}} returnFocusKey="sms:isla:today:topup"><span /></AppModal>);
      await act(async () => {});
      act(() => vi.advanceTimersByTime(2_001));
      rerender(<button type="button" data-dialog-return-focus-key="sms:isla:today:topup">Buy texts</button>);
      await act(async () => {});

      expect(screen.getByRole('button', { name: 'Buy texts' })).not.toHaveFocus();
    } finally {
      vi.useRealTimers();
    }
  });

  it('waits for one visible matching shortcut without selecting another salon', async () => {
    function Workspace({ open, ready }: { open: boolean; ready: boolean }) {
      return (
        <>
          <button type="button" data-dialog-return-focus-key="sms:other:today:topup">Other salon</button>
          <button type="button" hidden={!ready} disabled={!ready} data-dialog-return-focus-key="sms:isla:today:topup">Buy texts</button>
          <AppModal isOpen={open} onClose={() => {}} returnFocusKey="sms:isla:today:topup"><span>Credits</span></AppModal>
        </>
      );
    }
    const { rerender } = render(<Workspace open ready={false} />);
    rerender(<Workspace open={false} ready={false} />);
    await act(async () => {});

    expect(screen.getByRole('button', { name: 'Other salon' })).not.toHaveFocus();

    rerender(<Workspace open={false} ready />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Buy texts' })).toHaveFocus());
  });

  it('cancels deferred restoration when the same modal reopens', async () => {
    function Workspace({ open, ready }: { open: boolean; ready: boolean }) {
      return (
        <>
          {ready && <button type="button" data-dialog-return-focus-key="sms:isla:today:topup">Buy texts</button>}
          <AppModal isOpen={open} onClose={() => {}} returnFocusKey="sms:isla:today:topup"><span>Credits</span></AppModal>
        </>
      );
    }
    const { rerender } = render(<Workspace open ready={false} />);
    rerender(<Workspace open={false} ready={false} />);
    await act(async () => {});
    rerender(<Workspace open ready={false} />);
    rerender(<Workspace open ready />);
    await act(async () => {});

    expect(screen.getByTestId('app-modal-scroll-region')).toHaveFocus();
    expect(screen.getByRole('button', { name: 'Buy texts' })).not.toHaveFocus();
  });

  it.each(['Close', 'Escape'])('restores an explicit shortcut after an auth remount with %s', async (dismissal) => {
    const user = userEvent.setup();
    const returnFocusKey = 'sms:isla:today:topup';
    const { rerender } = render(<button type="button">Original shortcut</button>);
    await user.click(screen.getByRole('button', { name: 'Original shortcut' }));
    // The salon-scoped auth check removes the entire workspace, including
    // its modal focus subscribers, before admitting the requested sheet.
    rerender(<p>Checking account</p>);

    function RestoredWorkspace() {
      const [open, setOpen] = useState(true);
      return (
        <>
          <button type="button" data-dialog-return-focus-key={returnFocusKey}>Buy texts</button>
          <AppModal isOpen={open} onClose={() => setOpen(false)} returnFocusKey={returnFocusKey}>
            <DialogShell isOpen={open} onClose={() => setOpen(false)}>
              <button type="button" onClick={() => setOpen(false)}>Close credits</button>
            </DialogShell>
          </AppModal>
        </>
      );
    }

    rerender(<RestoredWorkspace />);
    await screen.findByRole('button', { name: 'Close credits' });
    if (dismissal === 'Escape') {
      await user.keyboard('{Escape}');
    } else {
      await user.click(screen.getByRole('button', { name: 'Close credits' }));
    }
    await waitFor(() => expect(screen.getByRole('button', { name: 'Buy texts' })).toHaveFocus());
  });

  it('gives every dashboard app a bounded native touch-scroll region', async () => {
    render(
      <AppModal isOpen onClose={vi.fn()} allowDragToDismiss={false}>
        <div>Dashboard content</div>
      </AppModal>,
    );

    expect(await screen.findByTestId('app-modal-panel')).toHaveClass('min-h-0', 'overflow-hidden');
    expect(screen.getByTestId('app-modal-scroll-region')).toHaveClass(
      'min-h-0',
      'flex-1',
      'touch-pan-y',
      'overflow-y-auto',
      'overscroll-contain',
    );
  });

  it('places and contains focus, closes with Escape, and restores the opener', async () => {
    const user = userEvent.setup();

    function Harness() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>Open owner app</button>
          <AppModal isOpen={open} onClose={() => setOpen(false)} title="Owner app" allowDragToDismiss={false}>
            <button type="button" hidden>Hidden action</button>
            <button type="button" disabled>Disabled action</button>
            <button type="button">First usable action</button>
            <button type="button">Final action</button>
          </AppModal>
        </>
      );
    }

    render(<Harness />);
    const opener = screen.getByRole('button', { name: 'Open owner app' });
    await user.click(opener);

    const content = await screen.findByTestId('app-modal-scroll-region');
    await waitFor(() => expect(content).toHaveFocus());
    await user.tab();

    expect(screen.getByRole('button', { name: 'First usable action' })).toHaveFocus();

    screen.getByRole('button', { name: 'Final action' }).focus();
    fireEvent.keyDown(window, { key: 'Tab' });

    expect(screen.getByRole('button', { name: 'First usable action' })).toHaveFocus();

    fireEvent.keyDown(window, { key: 'Tab', shiftKey: true });

    expect(screen.getByRole('button', { name: 'Final action' })).toHaveFocus();

    await user.keyboard('{Escape}');
    await waitFor(() => expect(opener).toHaveFocus());
  });

  it('dismisses from the backdrop and leaves a thumb-sized strip of it exposed', async () => {
    const user = userEvent.setup();

    function Harness() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>Open owner app</button>
          <AppModal isOpen={open} onClose={() => setOpen(false)} title="Owner app" allowDragToDismiss={false}>
            <button type="button">Inside action</button>
          </AppModal>
        </>
      );
    }

    render(<Harness />);
    const opener = screen.getByRole('button', { name: 'Open owner app' });
    await user.click(opener);

    const panel = await screen.findByTestId('app-modal-panel');

    // The exposed backdrop band is whatever the sheet's top inset leaves; a
    // 12 px strip is not a tap target on a phone (AG-w2-settings-integrations-11).
    expect(panel).toHaveStyle({
      top: 'max(calc(env(safe-area-inset-top, 0px) + 12px), 44px)',
    });

    const backdrop = screen.getByTestId('app-modal-backdrop');

    expect(backdrop).toHaveAttribute('aria-hidden', 'true');

    fireEvent.click(backdrop);

    await waitFor(() => expect(screen.queryByTestId('app-modal-panel')).not.toBeInTheDocument());
    await waitFor(() => expect(opener).toHaveFocus());
  });

  it('gives a nested DialogShell sole topmost ownership', async () => {
    const user = userEvent.setup();
    const outerClose = vi.fn();

    function Harness() {
      const [outerOpen, setOuterOpen] = useState(false);
      const [innerOpen, setInnerOpen] = useState(false);
      return (
        <>
          <button type="button" onClick={() => setOuterOpen(true)}>Open app</button>
          <AppModal
            isOpen={outerOpen}
            onClose={() => {
              outerClose();
              setOuterOpen(false);
            }}
            title="Owner app"
            allowDragToDismiss={false}
          >
            <button type="button" onClick={() => setInnerOpen(true)}>Open confirmation</button>
            <DialogShell isOpen={innerOpen} onClose={() => setInnerOpen(false)}>
              <button type="button">Inner first</button>
              <button type="button">Inner last</button>
            </DialogShell>
          </AppModal>
        </>
      );
    }

    render(<Harness />);
    const outerOpener = screen.getByRole('button', { name: 'Open app' });
    await user.click(outerOpener);
    await user.tab();
    const innerOpener = screen.getByRole('button', { name: 'Open confirmation' });

    expect(innerOpener).toHaveFocus();

    await user.click(innerOpener);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Inner first' })).toHaveFocus());

    await user.keyboard('{Escape}');
    await waitFor(() => expect(innerOpener).toHaveFocus());

    expect(outerClose).not.toHaveBeenCalled();

    await user.keyboard('{Escape}');
    await waitFor(() => expect(outerOpener).toHaveFocus());

    expect(outerClose).toHaveBeenCalledTimes(1);
  });
});
