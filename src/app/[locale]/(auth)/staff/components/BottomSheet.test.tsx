import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { type ReactElement, useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { BottomSheet } from './BottomSheet';

const noop = () => {};

function dispatchPointer(
  target: Element,
  type: 'pointerdown' | 'pointermove' | 'pointerup',
  { pointerId, clientY, button = 0 }: { pointerId: number; clientY: number; button?: number },
) {
  const event = new MouseEvent(type, { bubbles: true, button, clientY });
  Object.defineProperty(event, 'pointerId', { value: pointerId });
  fireEvent(target, event);
}

function Harness({ onClose = noop }: { onClose?: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>Open details</button>
      <BottomSheet
        isOpen={open}
        ariaLabel="Appointment details"
        onClose={() => {
          onClose();
          setOpen(false);
        }}
        initialSnap="half"
      >
        <button type="button">First detail action</button>
        <button type="button" hidden>Hidden detail action</button>
        <button type="button">Final detail action</button>
      </BottomSheet>
    </>
  );
}

describe('BottomSheet', () => {
  it('renders an open sheet within its slider bounds before effects run', async () => {
    const { renderToString } = await vi.importActual<{
      renderToString: (element: ReactElement) => string;
    }>('react-dom/server');
    const markup = renderToString(
      <BottomSheet isOpen ariaLabel="Appointment details" onClose={noop} initialSnap="half">
        <button type="button">Detail action</button>
      </BottomSheet>,
    );

    expect(markup).toContain('aria-valuemin="30"');
    expect(markup).toContain('aria-valuenow="60"');
    expect(markup).not.toContain('aria-valuenow="0"');
  });

  it('exposes truthful discrete resize semantics and keyboard bounds', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole('button', { name: 'Open details' }));

    const sheet = await screen.findByRole('dialog', { name: 'Appointment details' });
    const handle = screen.getByRole('slider', { name: 'Resize Appointment details' });
    await waitFor(() => expect(handle).toHaveFocus());

    expect(handle).toHaveAttribute('aria-valuemin', '30');
    expect(handle).toHaveAttribute('aria-valuemax', '92');
    expect(handle).toHaveAttribute('aria-valuenow', '60');
    expect(handle).toHaveAttribute('aria-valuetext', 'Half height, 60% of viewport');

    await user.keyboard('{ArrowUp}');

    expect(sheet).toHaveAttribute('data-snap-point', 'full');
    expect(handle).toHaveAttribute('aria-valuenow', '92');

    await user.keyboard('{ArrowRight}');

    expect(sheet).toHaveAttribute('data-snap-point', 'full');

    await user.keyboard('{Home}');

    expect(sheet).toHaveAttribute('data-snap-point', 'peek');

    await user.keyboard('{ArrowDown}');

    expect(sheet).toHaveAttribute('data-snap-point', 'peek');

    await user.keyboard('{End}');

    expect(sheet).toHaveAttribute('data-snap-point', 'full');
  });

  it('keeps consecutive pointer drags on the same valid snap states', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole('button', { name: 'Open details' }));

    const sheet = await screen.findByRole('dialog', { name: 'Appointment details' });
    const handle = screen.getByRole('slider', { name: 'Resize Appointment details' });
    await waitFor(() => expect(sheet).toHaveAttribute('data-snap-point', 'half'));

    // A browser can deliver the first move before React commits the visual
    // dragging state. Gesture ownership therefore needs synchronous ref state.
    act(() => {
      dispatchPointer(handle, 'pointerdown', { pointerId: 1, clientY: 300 });
      dispatchPointer(handle, 'pointermove', { pointerId: 1, clientY: 140 });
      dispatchPointer(handle, 'pointerup', { pointerId: 1, clientY: 140 });
    });

    await waitFor(() => expect(sheet).toHaveAttribute('data-snap-point', 'full'));

    act(() => {
      dispatchPointer(handle, 'pointerdown', { pointerId: 2, clientY: 140 });
      dispatchPointer(handle, 'pointermove', { pointerId: 2, clientY: 300 });
      dispatchPointer(handle, 'pointerup', { pointerId: 2, clientY: 300 });
    });

    await waitFor(() => expect(sheet).toHaveAttribute('data-snap-point', 'half'));

    expect(handle).toHaveAttribute('aria-valuenow', '60');
  });

  it('commits one close when a pointer release bubbles from the resize handle', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);
    await user.click(screen.getByRole('button', { name: 'Open details' }));

    const handle = await screen.findByRole('slider', { name: 'Resize Appointment details' });
    await user.keyboard('{Home}');

    expect(handle).toHaveAttribute('aria-valuenow', '30');

    dispatchPointer(handle, 'pointerdown', { pointerId: 3, clientY: 100 });
    dispatchPointer(handle, 'pointermove', { pointerId: 3, clientY: 240 });
    dispatchPointer(handle, 'pointerup', { pointerId: 3, clientY: 240 });

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });

  it('cancels an active drag before Escape closes and ignores the later release', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);
    await user.click(screen.getByRole('button', { name: 'Open details' }));

    const handle = await screen.findByRole('slider', { name: 'Resize Appointment details' });
    dispatchPointer(handle, 'pointerdown', { pointerId: 4, clientY: 200 });
    dispatchPointer(handle, 'pointermove', { pointerId: 4, clientY: 330 });
    fireEvent.keyDown(window, { key: 'Escape' });
    dispatchPointer(handle, 'pointerup', { pointerId: 4, clientY: 330 });

    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: 'Appointment details' })).not.toBeInTheDocument();
    });

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('contains focus, closes only the active sheet with Escape, and restores its opener', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);
    const opener = screen.getByRole('button', { name: 'Open details' });
    await user.click(opener);

    const handle = await screen.findByRole('slider', { name: 'Resize Appointment details' });
    await waitFor(() => expect(handle).toHaveFocus());
    fireEvent.keyDown(window, { key: 'Tab', shiftKey: true });

    expect(screen.getByRole('button', { name: 'Final detail action' })).toHaveFocus();

    fireEvent.keyDown(window, { key: 'Tab' });

    expect(handle).toHaveFocus();

    await user.keyboard('{Escape}');

    await waitFor(() => expect(opener).toHaveFocus());

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog', { name: 'Appointment details' })).not.toBeInTheDocument();
  });
});
