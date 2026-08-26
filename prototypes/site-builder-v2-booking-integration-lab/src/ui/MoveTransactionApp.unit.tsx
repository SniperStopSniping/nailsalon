import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, vi } from 'vitest';

import { SITE_BUILDER_STORAGE_KEY } from '../model/validation';
import { App } from './App';

function installMobileViewport(): void {
  vi.stubGlobal('matchMedia', vi.fn((query: string): MediaQueryList => ({
    matches: query.includes('max-width: 899px') || query.includes('max-width: 700px'),
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(() => true),
  })));
  vi.stubGlobal('scrollTo', vi.fn());
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 375 });
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: 600 });
  Object.defineProperty(document.body, 'clientWidth', { configurable: true, value: 375 });
}

async function chooseQuickBook(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  await user.click(screen.getByRole('button', { name: /Quick Book/ }));
  await screen.findByTestId('final-hybrid-editor');
  await waitFor(() => expect(window.localStorage.getItem(SITE_BUILDER_STORAGE_KEY)).not.toBeNull());
}

async function openBookingMove(user: ReturnType<typeof userEvent.setup>): Promise<HTMLElement> {
  const booking = screen.getByRole('listitem', { name: 'Booking on Home' });
  const select = booking.querySelector<HTMLButtonElement>('.section-card__select-surface--booking');
  if (!select) throw new Error('Booking selection surface is missing.');
  if (select.getAttribute('aria-pressed') !== 'true') await user.click(select);
  const actions = await screen.findByRole('group', { name: 'Booking actions' });
  await user.click(within(actions).getByRole('button', { name: 'Move' }));
  return screen.findByRole('dialog', { name: 'Move Booking' });
}

async function moveBookingToFirst(
  user: ReturnType<typeof userEvent.setup>,
  dialog: HTMLElement,
): Promise<void> {
  const position = within(dialog).getByLabelText('Position for Booking');
  await user.clear(position);
  await user.type(position, '1{Enter}');
}

function sectionOrder(): string[] {
  return [...screen.getByRole('list', { name: 'Sections on Home' })
    .querySelectorAll<HTMLElement>('[data-section-label]')]
    .map((element) => element.dataset.sectionLabel ?? '');
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('transactional shared Move surface', () => {
  it('keeps working order out of storage and reloads the last committed order mid-Move', async () => {
    installMobileViewport();
    const user = userEvent.setup();
    const view = render(<App />);
    await chooseQuickBook(user);
    const committed = window.localStorage.getItem(SITE_BUILDER_STORAGE_KEY);

    const dialog = await openBookingMove(user);
    await moveBookingToFirst(user, dialog);
    expect(sectionOrder()).toEqual(['Booking', 'Section 01', 'Section 02']);
    expect(window.localStorage.getItem(SITE_BUILDER_STORAGE_KEY)).toBe(committed);
    expect(screen.getByLabelText('Save status')).toHaveTextContent('Order not saved yet');

    view.unmount();
    render(<App />);
    expect(await screen.findByTestId('final-hybrid-editor')).toBeVisible();
    expect(sectionOrder()).toEqual(['Section 01', 'Section 02', 'Booking']);
    expect(screen.queryByRole('dialog', { name: 'Move Booking' })).not.toBeInTheDocument();
  });

  it('Cancel creates no history entry and writes nothing', async () => {
    installMobileViewport();
    const user = userEvent.setup();
    render(<App />);
    await chooseQuickBook(user);
    const write = vi.spyOn(Storage.prototype, 'setItem');
    write.mockClear();

    const dialog = await openBookingMove(user);
    await moveBookingToFirst(user, dialog);
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));

    expect(sectionOrder()).toEqual(['Section 01', 'Section 02', 'Booking']);
    expect(screen.getByRole('button', { name: 'Undo' })).toBeDisabled();
    await new Promise((resolve) => window.setTimeout(resolve, 230));
    expect(write).not.toHaveBeenCalled();
    expect(screen.getByTestId('reorder-live-region'))
      .toHaveTextContent('Order restored. Booking is back at position 3.');
  });

  it('Done commits once, persists once, and produces one undoable change', async () => {
    installMobileViewport();
    const user = userEvent.setup();
    render(<App />);
    await chooseQuickBook(user);
    const write = vi.spyOn(Storage.prototype, 'setItem');
    write.mockClear();

    const dialog = await openBookingMove(user);
    await moveBookingToFirst(user, dialog);
    await user.click(within(dialog).getByRole('button', { name: 'Done' }));

    expect(sectionOrder()).toEqual(['Booking', 'Section 01', 'Section 02']);
    expect(screen.getByLabelText('Save status')).toHaveTextContent('Saving…');
    expect(screen.queryByText('Section order saved.')).not.toBeInTheDocument();
    await waitFor(() => expect(write).toHaveBeenCalledTimes(1));
    expect(write).toHaveBeenCalledWith(SITE_BUILDER_STORAGE_KEY, expect.any(String));
    await waitFor(() => expect(screen.getByLabelText('Save status')).toHaveTextContent('Saved'));
    expect(await screen.findByText('Section order saved.', { selector: '.toast span' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Undo' })).toBeEnabled();
    await user.click(screen.getByRole('button', { name: 'Undo' }));
    expect(sectionOrder()).toEqual(['Section 01', 'Section 02', 'Booking']);
    expect(screen.getByRole('button', { name: 'Undo' })).toBeDisabled();
  });

  it('keeps history shortcuts suspended until a Move transaction closes', async () => {
    installMobileViewport();
    const user = userEvent.setup();
    render(<App />);
    await chooseQuickBook(user);

    let dialog = await openBookingMove(user);
    await moveBookingToFirst(user, dialog);
    await user.click(within(dialog).getByRole('button', { name: 'Done' }));
    await waitFor(() => expect(screen.getByLabelText('Save status')).toHaveTextContent('Saved'));
    expect(sectionOrder()).toEqual(['Booking', 'Section 01', 'Section 02']);

    dialog = await openBookingMove(user);
    const position = within(dialog).getByLabelText('Position for Booking');
    await user.clear(position);
    await user.type(position, '3{Enter}');
    const shortcut = new KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      ctrlKey: true,
      key: 'z',
    });
    window.dispatchEvent(shortcut);
    expect(shortcut.defaultPrevented).toBe(true);
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));

    expect(sectionOrder()).toEqual(['Booking', 'Section 01', 'Section 02']);
    expect(screen.getByRole('button', { name: 'Undo' })).toBeEnabled();
  });

  it('keeps Escape local to a position edit and closes a clean no-op Move silently', async () => {
    installMobileViewport();
    const user = userEvent.setup();
    render(<App />);
    await chooseQuickBook(user);
    const write = vi.spyOn(Storage.prototype, 'setItem');
    write.mockClear();

    const dialog = await openBookingMove(user);
    const position = within(dialog).getByLabelText('Position for Booking');
    await user.clear(position);
    await user.type(position, '1{Escape}');

    expect(screen.getByRole('dialog', { name: 'Move Booking' })).toBeVisible();
    expect(screen.queryByRole('dialog', { name: 'Keep this new order?' })).not.toBeInTheDocument();
    expect(position).toHaveValue(3);
    expect(position.closest('.reorder-row')).toHaveFocus();

    await user.click(within(dialog).getByRole('button', { name: 'Done' }));
    expect(screen.queryByText('Section order saved.')).not.toBeInTheDocument();
    await new Promise((resolve) => window.setTimeout(resolve, 230));
    expect(write).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Undo' })).toBeDisabled();
  });

  it('asks once before dirty X, Escape, or backdrop dismissal', async () => {
    installMobileViewport();
    const user = userEvent.setup();
    render(<App />);
    await chooseQuickBook(user);

    let moveDialog = await openBookingMove(user);
    await moveBookingToFirst(user, moveDialog);
    await user.click(within(moveDialog).getByRole('button', { name: 'Close Move Booking' }));
    let confirmation = await screen.findByRole('dialog', { name: 'Keep this new order?' });
    expect(confirmation).toHaveTextContent('Booking is at position 1 instead of 3.');
    await user.click(within(confirmation).getByRole('button', { name: 'Discard changes' }));
    expect(sectionOrder()).toEqual(['Section 01', 'Section 02', 'Booking']);

    moveDialog = await openBookingMove(user);
    await moveBookingToFirst(user, moveDialog);
    moveDialog.focus();
    await user.keyboard('{Escape}');
    confirmation = await screen.findByRole('dialog', { name: 'Keep this new order?' });
    await user.click(within(confirmation).getByRole('button', { name: 'Keep order' }));
    expect(sectionOrder()).toEqual(['Booking', 'Section 01', 'Section 02']);
    await user.click(screen.getByRole('button', { name: 'Undo' }));
    expect(sectionOrder()).toEqual(['Section 01', 'Section 02', 'Booking']);

    moveDialog = await openBookingMove(user);
    await moveBookingToFirst(user, moveDialog);
    fireEvent.mouseDown(screen.getByTestId('dialog-backdrop'));
    confirmation = await screen.findByRole('dialog', { name: 'Keep this new order?' });
    await user.click(within(confirmation).getByRole('button', { name: 'Discard changes' }));
    expect(sectionOrder()).toEqual(['Section 01', 'Section 02', 'Booking']);
  });

  it('opens the same Move panel from Pages & Structure with Booking active', async () => {
    installMobileViewport();
    const user = userEvent.setup();
    render(<App />);
    await chooseQuickBook(user);

    const booking = screen.getByRole('listitem', { name: 'Booking on Home' });
    const select = booking.querySelector<HTMLButtonElement>('.section-card__select-surface--booking');
    if (!select) throw new Error('Booking selection surface is missing.');
    await user.click(select);
    await user.click(screen.getByRole('button', { name: 'Open Pages & Structure for Home' }));
    const structure = await screen.findByRole('dialog', { name: 'Pages & Structure' });
    await user.click(within(structure).getByRole('button', { name: 'Arrange sections' }));

    const arrange = await screen.findByRole('dialog', { name: 'Arrange sections' });
    expect(within(arrange).getByTestId('move-section-panel')).toBeVisible();
    expect(within(arrange).getByRole('button', { name: /Booking Keeps booking available · Moving/ }))
      .toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByRole('dialog', { name: 'Pages & Structure' })).not.toBeInTheDocument();
  });
});
