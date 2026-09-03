import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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

async function chooseMultiPage(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  await user.click(screen.getByRole('button', { name: /Multi-page website/ }));
  await screen.findByTestId('final-hybrid-editor');
  await waitFor(() => expect(window.localStorage.getItem(SITE_BUILDER_STORAGE_KEY)).not.toBeNull());
  await user.click(screen.getByRole('button', { name: 'Open Pages & Structure for Home' }));
  const structure = await screen.findByRole('dialog', { name: 'Pages & Structure' });
  const servicesButton = within(structure).getByText('Services & Booking').closest('button');
  if (!servicesButton) throw new Error('Services & Booking page button is missing.');
  await user.click(servicesButton);
  await screen.findByRole('heading', { level: 1, name: 'Services & Booking' });
}

async function openBookingMove(
  user: ReturnType<typeof userEvent.setup>,
  pageName = 'Home',
): Promise<HTMLElement> {
  const booking = screen.getByRole('listitem', { name: `Booking on ${pageName}` });
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

function sectionOrder(pageName = 'Home'): string[] {
  return [...screen.getByRole('list', { name: `Sections on ${pageName}` })
    .querySelectorAll<HTMLElement>('[data-section-label]')]
    .map((element) => element.dataset.sectionLabel ?? '');
}

const QUICK_BOOK_DEFAULT_ORDER = [
  'Salon intro',
  'Booking',
  'Gallery',
  'Visit & Contact',
];

const QUICK_BOOK_BOOKING_FIRST_ORDER = [
  'Booking',
  'Salon intro',
  'Gallery',
  'Visit & Contact',
];

const MULTI_PAGE_HOME_ORDER = ['Welcome', 'Reviews'];
const MULTI_PAGE_SERVICES_ORDER = ['Booking', 'Before You Book'];

afterEach(() => {
  document.body.style.removeProperty('overflow');
  document.body.style.removeProperty('padding-right');
  document.body.style.removeProperty('pointer-events');
  document.body.style.removeProperty('position');
  document.body.style.removeProperty('top');
  document.documentElement.style.removeProperty('overflow');
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
    expect(sectionOrder()).toEqual(QUICK_BOOK_BOOKING_FIRST_ORDER);
    expect(window.localStorage.getItem(SITE_BUILDER_STORAGE_KEY)).toBe(committed);
    expect(screen.getByLabelText('Save status')).toHaveTextContent('Order not saved yet');

    view.unmount();
    render(<App />);
    expect(await screen.findByTestId('final-hybrid-editor')).toBeVisible();
    expect(sectionOrder()).toEqual(QUICK_BOOK_DEFAULT_ORDER);
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

    expect(sectionOrder()).toEqual(QUICK_BOOK_DEFAULT_ORDER);
    expect(screen.getByRole('button', { name: 'Undo' })).toBeDisabled();
    await new Promise((resolve) => window.setTimeout(resolve, 230));
    expect(write).not.toHaveBeenCalled();
    expect(screen.getByTestId('reorder-live-region'))
      .toHaveTextContent('Order restored. Booking is back at position 2.');
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

    expect(sectionOrder()).toEqual(QUICK_BOOK_BOOKING_FIRST_ORDER);
    expect(screen.getByLabelText('Save status')).toHaveTextContent('Saving…');
    expect(screen.queryByText('Section order saved.')).not.toBeInTheDocument();
    await waitFor(() => expect(write).toHaveBeenCalledTimes(1));
    expect(write).toHaveBeenCalledWith(SITE_BUILDER_STORAGE_KEY, expect.any(String));
    await waitFor(() => expect(screen.getByLabelText('Save status')).toHaveTextContent('Saved'));
    expect(await screen.findByText('Section order saved.', { selector: '.toast span' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Undo' })).toBeEnabled();
    await user.click(screen.getByRole('button', { name: 'Undo' }));
    expect(sectionOrder()).toEqual(QUICK_BOOK_DEFAULT_ORDER);
    expect(screen.getByRole('button', { name: 'Undo' })).toBeDisabled();
  });

  it('coalesces rapid double-Done into one mutation, persistence write, and history step', async () => {
    installMobileViewport();
    const user = userEvent.setup();
    render(<App />);
    await chooseQuickBook(user);
    const write = vi.spyOn(Storage.prototype, 'setItem');
    write.mockClear();

    const dialog = await openBookingMove(user);
    await moveBookingToFirst(user, dialog);
    const done = within(dialog).getByRole('button', { name: 'Done' });
    act(() => {
      done.click();
      done.click();
    });

    expect(sectionOrder()).toEqual(QUICK_BOOK_BOOKING_FIRST_ORDER);
    await waitFor(() => expect(write).toHaveBeenCalledTimes(1));
    await user.click(screen.getByRole('button', { name: 'Undo' }));
    expect(sectionOrder()).toEqual(QUICK_BOOK_DEFAULT_ORDER);
    expect(screen.getByRole('button', { name: 'Undo' })).toBeDisabled();
    expect(screen.queryByRole('dialog', { name: 'That change isn’t available' }))
      .not.toBeInTheDocument();
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
    expect(sectionOrder()).toEqual(QUICK_BOOK_BOOKING_FIRST_ORDER);

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

    expect(sectionOrder()).toEqual(QUICK_BOOK_BOOKING_FIRST_ORDER);
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
    expect(position).toHaveValue(2);
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
    expect(confirmation).toHaveTextContent('Booking is at position 1 instead of 2.');
    await user.click(within(confirmation).getByRole('button', { name: 'Discard changes' }));
    expect(sectionOrder()).toEqual(QUICK_BOOK_DEFAULT_ORDER);

    moveDialog = await openBookingMove(user);
    await moveBookingToFirst(user, moveDialog);
    moveDialog.focus();
    await waitFor(() => expect(moveDialog).toHaveFocus());
    fireEvent.keyDown(moveDialog, { key: 'Escape' });
    confirmation = await screen.findByRole('dialog', { name: 'Keep this new order?' });
    await user.click(within(confirmation).getByRole('button', { name: 'Keep order' }));
    expect(sectionOrder()).toEqual(QUICK_BOOK_BOOKING_FIRST_ORDER);
    await user.click(screen.getByRole('button', { name: 'Undo' }));
    expect(sectionOrder()).toEqual(QUICK_BOOK_DEFAULT_ORDER);

    moveDialog = await openBookingMove(user);
    await moveBookingToFirst(user, moveDialog);
    fireEvent.mouseDown(screen.getByTestId('dialog-backdrop'));
    confirmation = await screen.findByRole('dialog', { name: 'Keep this new order?' });
    await user.click(within(confirmation).getByRole('button', { name: 'Discard changes' }));
    expect(sectionOrder()).toEqual(QUICK_BOOK_DEFAULT_ORDER);
  });

  it.each([
    ['Escape', 'Keep order'],
    ['Escape', 'Discard changes'],
    ['close button', 'Keep order'],
    ['close button', 'Discard changes'],
    ['backdrop', 'Keep order'],
    ['backdrop', 'Discard changes'],
  ] as const)(
    'fully restores document state and moved-section focus after dirty %s → %s',
    async (dismissal, resolution) => {
      installMobileViewport();
      document.body.style.setProperty('overflow', 'auto', 'important');
      document.body.style.setProperty('padding-right', '7px');
      document.body.style.setProperty('pointer-events', 'auto');
      document.body.style.setProperty('position', 'relative');
      document.body.style.setProperty('top', '2px');
      document.documentElement.style.setProperty('overflow', 'clip', 'important');
      const user = userEvent.setup();
      render(<App />);
      await chooseQuickBook(user);
      const booking = screen.getByRole('listitem', { name: 'Booking on Home' });
      const bookingId = booking.dataset.sectionInstanceId;
      if (!bookingId) throw new Error('Booking section id is missing.');

      const moveDialog = await openBookingMove(user);
      await moveBookingToFirst(user, moveDialog);
      expect(document.body.style.overflow).toBe('hidden');
      expect(screen.getByTestId('final-hybrid-editor')).toHaveAttribute('inert');

      if (dismissal === 'Escape') {
        moveDialog.focus();
        await waitFor(() => expect(moveDialog).toHaveFocus());
        fireEvent.keyDown(moveDialog, { key: 'Escape' });
      } else if (dismissal === 'close button') {
        await user.click(within(moveDialog).getByRole('button', { name: 'Close Move Booking' }));
      } else {
        fireEvent.mouseDown(screen.getByTestId('dialog-backdrop'));
      }

      const warning = await screen.findByRole('dialog', { name: 'Keep this new order?' });
      await user.click(within(warning).getByRole('button', { name: resolution }));

      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
      expect(document.body.style.getPropertyValue('overflow')).toBe('auto');
      expect(document.body.style.getPropertyPriority('overflow')).toBe('important');
      expect(document.documentElement.style.getPropertyValue('overflow')).toBe('clip');
      expect(document.documentElement.style.getPropertyPriority('overflow')).toBe('important');
      expect(document.body.style.paddingRight).toBe('7px');
      expect(document.body.style.pointerEvents).toBe('auto');
      expect(document.body.style.position).toBe('relative');
      expect(document.body.style.top).toBe('2px');
      expect(screen.getByTestId('final-hybrid-editor')).not.toHaveAttribute('inert');
      expect(window.document.querySelector('[aria-hidden="true"]#root')).toBeNull();
      await waitFor(() => expect(window.document.activeElement).not.toBe(window.document.body));
      const activeElement = window.document.activeElement as HTMLElement;
      expect(
        activeElement.getAttribute('data-move-trigger-for') === bookingId
        || activeElement.closest('[data-section-instance-id]')?.getAttribute('data-section-instance-id') === bookingId,
      ).toBe(true);
      expect(activeElement).toHaveAttribute('data-restored-focus', 'true');
      expect(document.querySelector('.final-topbar')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Preview' })).toBeEnabled();
      expect(screen.getByRole('button', { name: 'More site options' })).toBeEnabled();
      expect(screen.getByRole('button', { name: 'Open Pages & Structure for Home' })).toBeEnabled();
    },
  );

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

  it('restores focus after Arrange completes without a preselected section', async () => {
    installMobileViewport();
    const user = userEvent.setup();
    render(<App />);
    await chooseQuickBook(user);

    await user.click(screen.getByRole('button', { name: 'Open Pages & Structure for Home' }));
    const structure = await screen.findByRole('dialog', { name: 'Pages & Structure' });
    await user.click(within(structure).getByRole('button', { name: 'Arrange sections' }));
    const arrange = await screen.findByRole('dialog', { name: 'Arrange sections' });
    await moveBookingToFirst(user, arrange);
    await user.click(within(arrange).getByRole('button', { name: 'Cancel' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await waitFor(() => {
      const activeElement = document.activeElement as HTMLElement;
      expect(activeElement).not.toBe(document.body);
      expect(activeElement.closest('[data-section-instance-id]'))
        .toHaveAttribute('data-section-instance-id');
      expect(activeElement).toHaveAttribute('data-restored-focus', 'true');
    });
  });

  it('pins the cross-page target during incidental movement and announces explicit retargeting', async () => {
    installMobileViewport();
    const user = userEvent.setup();
    render(<App />);
    await chooseQuickBook(user);

    let dialog = await openBookingMove(user);
    await user.click(within(dialog).getByRole('button', { name: 'Move Salon intro down' }));

    dialog = screen.getByRole('dialog', { name: 'Move Booking' });
    expect(within(dialog).getByRole('button', { name: 'Move Booking to another page' }))
      .toBeVisible();
    expect(within(dialog).getByTestId('move-section-panel').querySelector('[data-move-target-row="true"]'))
      .toHaveTextContent('Booking');

    const selectSalonIntro = within(dialog).getByRole('button', {
      name: /Select Salon intro for cross-page movement/,
    });
    await user.click(selectSalonIntro);

    dialog = screen.getByRole('dialog', { name: 'Move Salon intro' });
    expect(within(dialog).getByRole('button', { name: 'Move Salon intro to another page' }))
      .toBeVisible();
    expect(screen.getByTestId('reorder-live-region'))
      .toHaveTextContent('Salon intro selected for cross-page movement.');
    expect(selectSalonIntro).toHaveAttribute('aria-pressed', 'true');
  });

  it('stages a cross-page destination without document, storage, history, navigation, or close', async () => {
    installMobileViewport();
    const user = userEvent.setup();
    render(<App />);
    await chooseMultiPage(user);
    const committed = window.localStorage.getItem(SITE_BUILDER_STORAGE_KEY);
    const write = vi.spyOn(Storage.prototype, 'setItem');
    write.mockClear();

    const dialog = await openBookingMove(user, 'Services & Booking');
    await user.click(within(dialog).getByRole('button', {
      name: 'Move Booking to another page',
    }));
    await user.click(within(dialog).getByRole('button', { name: /^Home/ }));

    expect(screen.getByRole('dialog', { name: 'Move Booking' })).toBeVisible();
    expect(within(dialog).getByText('Staged destination')).toBeVisible();
    expect(within(dialog).getByText('Order not saved yet')).toBeVisible();
    expect(screen.getByRole('heading', { level: 1, name: 'Services & Booking' })).toBeVisible();
    expect(sectionOrder('Services & Booking')).toEqual(MULTI_PAGE_SERVICES_ORDER);
    expect(window.localStorage.getItem(SITE_BUILDER_STORAGE_KEY)).toBe(committed);
    expect(screen.getByRole('button', { name: 'Undo' })).toBeDisabled();
    await new Promise((resolve) => window.setTimeout(resolve, 230));
    expect(write).not.toHaveBeenCalled();

    await user.click(within(dialog).getByRole('button', {
      name: /Services & Booking.*Current page.*Keep here/,
    }));
    expect(within(dialog).queryByText('Staged destination')).not.toBeInTheDocument();
    expect(within(dialog).getByText('Saved')).toBeVisible();
    await user.click(within(dialog).getByRole('button', { name: /^Home/ }));

    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(sectionOrder('Services & Booking')).toEqual(MULTI_PAGE_SERVICES_ORDER);
    expect(window.localStorage.getItem(SITE_BUILDER_STORAGE_KEY)).toBe(committed);
    expect(screen.getByRole('button', { name: 'Undo' })).toBeDisabled();
  });

  it('uses the same atomic destination transaction for dirty Discard and Keep', async () => {
    installMobileViewport();
    const user = userEvent.setup();
    render(<App />);
    await chooseMultiPage(user);
    const committed = window.localStorage.getItem(SITE_BUILDER_STORAGE_KEY);
    const write = vi.spyOn(Storage.prototype, 'setItem');
    write.mockClear();

    let dialog = await openBookingMove(user, 'Services & Booking');
    await user.click(within(dialog).getByRole('button', {
      name: 'Move Booking to another page',
    }));
    await user.click(within(dialog).getByRole('button', { name: /^Home/ }));
    await user.click(within(dialog).getByRole('button', { name: 'Close Move Booking' }));
    let warning = await screen.findByRole('dialog', { name: 'Keep this new order?' });
    expect(warning).toHaveTextContent('Booking will move to Home');
    await user.click(within(warning).getByRole('button', { name: 'Discard changes' }));

    expect(screen.getByRole('heading', { level: 1, name: 'Services & Booking' })).toBeVisible();
    expect(sectionOrder('Services & Booking')).toEqual(MULTI_PAGE_SERVICES_ORDER);
    expect(window.localStorage.getItem(SITE_BUILDER_STORAGE_KEY)).toBe(committed);
    await new Promise((resolve) => window.setTimeout(resolve, 230));
    expect(write).not.toHaveBeenCalled();

    dialog = await openBookingMove(user, 'Services & Booking');
    await user.click(within(dialog).getByRole('button', {
      name: 'Move Booking to another page',
    }));
    await user.click(within(dialog).getByRole('button', { name: /^Home/ }));
    await user.click(within(dialog).getByRole('button', { name: 'Close Move Booking' }));
    warning = await screen.findByRole('dialog', { name: 'Keep this new order?' });
    await user.click(within(warning).getByRole('button', { name: 'Keep order' }));

    await screen.findByRole('heading', { level: 1, name: 'Home' });
    expect(sectionOrder()).toEqual([...MULTI_PAGE_HOME_ORDER, 'Booking']);
    await waitFor(() => expect(write).toHaveBeenCalledTimes(1));
    await user.click(screen.getByRole('button', { name: 'Undo' }));
    expect(sectionOrder()).toEqual(MULTI_PAGE_HOME_ORDER);
  });

  it('commits a staged destination once and one Undo/Redo restores both pages', async () => {
    installMobileViewport();
    const user = userEvent.setup();
    render(<App />);
    await chooseMultiPage(user);
    const write = vi.spyOn(Storage.prototype, 'setItem');
    write.mockClear();

    let dialog = await openBookingMove(user, 'Services & Booking');
    await user.click(within(dialog).getByRole('button', {
      name: 'Move Booking to another page',
    }));
    await user.click(within(dialog).getByRole('button', { name: /^Home/ }));
    await user.selectOptions(within(dialog).getByRole('combobox', { name: 'Position on Home' }), '1');
    await user.click(within(dialog).getByRole('button', { name: 'Done' }));

    await screen.findByRole('heading', { level: 1, name: 'Home' });
    expect(sectionOrder()).toEqual(['Booking', ...MULTI_PAGE_HOME_ORDER]);
    await waitFor(() => expect(write).toHaveBeenCalledTimes(1));
    expect(screen.getByRole('button', { name: 'Undo' })).toBeEnabled();

    await user.click(screen.getByRole('button', { name: 'Undo' }));
    expect(sectionOrder()).toEqual(MULTI_PAGE_HOME_ORDER);
    expect(screen.getByRole('button', { name: 'Redo' })).toBeEnabled();
    await user.click(screen.getByRole('button', { name: 'Redo' }));
    expect(sectionOrder()).toEqual(['Booking', ...MULTI_PAGE_HOME_ORDER]);
    dialog = screen.queryByRole('dialog', { name: 'Move Booking' }) as HTMLElement;
    expect(dialog).not.toBeInTheDocument();
  });

  it('keeps Create page and move staged until Done and undoes page creation with the move', async () => {
    installMobileViewport();
    const user = userEvent.setup();
    render(<App />);
    await chooseQuickBook(user);
    const committed = window.localStorage.getItem(SITE_BUILDER_STORAGE_KEY);
    const write = vi.spyOn(Storage.prototype, 'setItem');
    write.mockClear();

    let dialog = await openBookingMove(user);
    await user.click(within(dialog).getByRole('button', {
      name: 'Move Booking to another page',
    }));
    await user.type(within(dialog).getByPlaceholderText('Page name'), 'Portfolio');
    await user.click(within(dialog).getByRole('button', { name: 'Create page and move' }));

    dialog = screen.getByRole('dialog', { name: 'Move Booking' });
    expect(within(dialog).getByRole('region', { name: 'Staged destination' }))
      .toHaveTextContent('Portfolio will be created when you press Done.');
    expect(window.localStorage.getItem(SITE_BUILDER_STORAGE_KEY)).toBe(committed);
    expect(screen.getByRole('button', { name: 'Undo' })).toBeDisabled();
    await new Promise((resolve) => window.setTimeout(resolve, 230));
    expect(write).not.toHaveBeenCalled();

    await user.click(within(dialog).getByRole('button', { name: 'Done' }));
    const menuPrompt = await screen.findByRole('dialog', { name: 'Add a menu?' });
    await user.click(within(menuPrompt).getByRole('button', { name: 'Not now' }));
    await screen.findByRole('heading', { level: 1, name: 'Portfolio' });
    expect(sectionOrder('Portfolio')).toEqual(['Booking']);
    await waitFor(() => expect(write).toHaveBeenCalledTimes(1));

    await user.click(screen.getByRole('button', { name: 'Undo' }));
    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 1, name: 'Home' })).toBeVisible();
    });
    expect(sectionOrder()).toEqual(QUICK_BOOK_DEFAULT_ORDER);
    expect(screen.getByRole('button', { name: 'Undo' })).toBeDisabled();
  });
});
