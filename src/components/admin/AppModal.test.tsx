import { fireEvent, render, screen, waitFor } from '@testing-library/react';
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
