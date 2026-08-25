import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, vi } from 'vitest';

import {
  createEmptyBookingSession,
  createMenuFixture,
} from '../booking/helpers';
import { initializeStarter } from '../model/starters';
import type { BookingSectionInstance } from '../model/types';
import { SITE_BUILDER_STORAGE_KEY } from '../model/validation';
import { App } from './App';
import { BookingSectionCard } from './BookingSectionCard';

function installViewport(viewport: 'desktop' | 'mobile'): void {
  const desktop = viewport === 'desktop';
  const matchMedia = vi.fn((query: string): MediaQueryList => {
    const matches = query.includes('min-width: 900px')
      ? desktop
      : query.includes('max-width: 899px') || query.includes('max-width: 700px')
        ? !desktop
        : false;
    return {
      matches,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(() => true),
    };
  });

  vi.stubGlobal('matchMedia', matchMedia);
  vi.stubGlobal('scrollTo', vi.fn());
  Object.defineProperty(window, 'innerWidth', {
    configurable: true,
    value: desktop ? 1440 : 375,
  });
  Object.defineProperty(document.body, 'clientWidth', {
    configurable: true,
    value: desktop ? 1440 : 375,
  });
}

async function chooseQuickBook(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: /Quick Book/ }));
  return screen.findByTestId('final-hybrid-editor');
}

async function selectBooking(
  user: ReturnType<typeof userEvent.setup>,
  pageName = 'Home',
) {
  const item = screen.getByRole('listitem', {
    name: `Booking on ${pageName}`,
  });
  const surface = item.querySelector<HTMLButtonElement>(
    '.section-card__select-surface--booking',
  );
  if (!surface) {
    throw new Error('Booking selection surface was not rendered.');
  }
  await user.click(surface);
  return screen.findByRole('group', { name: 'Booking actions' });
}

async function openBookingSettings(user: ReturnType<typeof userEvent.setup>) {
  const actions = await selectBooking(user);
  await user.click(within(actions).getByRole('button', { name: 'Edit' }));
  return screen.findByRole('dialog', { name: 'Booking' });
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('Booking editor selection boundary', () => {
  it('selects the owner section exactly once without mutating customer session', async () => {
    installViewport('mobile');
    const user = userEvent.setup();
    const document = initializeStarter('quick_book');
    const page = document.pages[0];
    const section = page?.sections.find(
      (candidate): candidate is BookingSectionInstance => candidate.sectionType === 'booking',
    );
    if (!page || !section) {
      throw new Error('Quick Book did not initialize Booking on Home.');
    }
    const onSelect = vi.fn();
    const onSessionChange = vi.fn();

    render(
      <BookingSectionCard
        fixture={createMenuFixture()}
        page={page}
        section={section}
        selected={false}
        session={createEmptyBookingSession()}
        tokenPreset="warm"
        onEdit={vi.fn()}
        onEnterReorder={vi.fn()}
        onMove={vi.fn()}
        onRemove={vi.fn()}
        onSelect={onSelect}
        onSessionChange={onSessionChange}
        onToggleVisible={vi.fn()}
      />,
    );

    const surface = screen.getByRole('listitem', { name: 'Booking on Home' })
      .querySelector<HTMLButtonElement>('.section-card__select-surface--booking');
    if (!surface) {
      throw new Error('Booking selection surface was not rendered.');
    }
    await user.click(surface);

    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith(section);
    expect(onSessionChange).not.toHaveBeenCalled();
    expect(screen.getByTestId('booking-section-edit')
      .querySelector('.booking-customer-region')).toHaveAttribute('inert');
  });
});

describe('integrated Booking settings surfaces', () => {
  it('uses the mobile Sheet and exposes only controls compatible with each layout', async () => {
    installViewport('mobile');
    const user = userEvent.setup();
    render(<App />);
    await chooseQuickBook(user);

    const dialog = await openBookingSettings(user);
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveClass('dialog-panel--context-panel');
    expect(screen.getByTestId('dialog-backdrop')).toContainElement(dialog);
    expect(within(dialog).getByText(
      /Your services, prices and booking settings stay the same/,
    )).toBeVisible();
    expect(dialog.querySelectorAll('[data-layout-option]')).toHaveLength(5);
    expect(within(dialog).getByLabelText('Booking typography preset')).toBeVisible();
    expect(within(dialog).getByRole('group', { name: 'Booking heading scale' }))
      .toBeVisible();

    const cases = [
      {
        layout: 'visual_grid',
        control: 'Visual Grid image mode',
        incompatible: 'Clean List density',
        guidance: 'Photos recommended',
      },
      {
        layout: 'clean_list',
        control: 'Clean List density',
        incompatible: 'Visual Grid image mode',
        guidance: 'Photos optional',
      },
      {
        layout: 'editorial_cards',
        control: 'Editorial Cards image ratio',
        incompatible: 'Clean List density',
        guidance: 'Photos strongly recommended',
      },
      {
        layout: 'category_menu',
        control: 'Category Menu mobile navigation',
        incompatible: 'Editorial Cards image ratio',
        guidance: 'Photos optional',
      },
      {
        layout: 'editorial_price_list',
        control: 'Editorial Price List divider style',
        incompatible: 'Category Menu mobile navigation',
        guidance: 'Photos optional',
      },
    ] as const;

    for (const item of cases) {
      const option = dialog.querySelector<HTMLButtonElement>(
        `[data-layout-option="${item.layout}"]`,
      );
      if (!option) {
        throw new Error(`${item.layout} layout choice was not rendered.`);
      }
      await user.click(option);
      expect(within(dialog).getByRole('group', { name: item.control })).toBeVisible();
      expect(within(dialog).queryByRole('group', { name: item.incompatible }))
        .not.toBeInTheDocument();
      expect(within(dialog).getByText(item.guidance)).toBeVisible();
      expect(screen.getByTestId('booking-section-edit')
        .querySelector('[data-booking-renderer="shared-booking-section"]'))
        .toHaveAttribute('data-layout', item.layout);
    }
  });

  it('uses the temporary desktop right drawer while keeping the canvas mounted', async () => {
    installViewport('desktop');
    const user = userEvent.setup();
    render(<App />);
    await chooseQuickBook(user);

    const dialog = await openBookingSettings(user);
    expect(screen.getByTestId('dialog-nonmodal-layer')).toContainElement(dialog);
    expect(dialog).not.toHaveAttribute('aria-modal');
    expect(dialog).toHaveClass('dialog-panel--context-panel');
    expect(screen.getByTestId('final-hybrid-editor')).toBeVisible();
    expect(screen.getByRole('listitem', { name: 'Booking on Home' })).toBeVisible();
    expect(dialog.querySelectorAll('[data-layout-option]')).toHaveLength(5);

    const priceList = dialog.querySelector<HTMLButtonElement>(
      '[data-layout-option="editorial_price_list"]',
    );
    if (!priceList) {
      throw new Error('Price List layout choice was not rendered.');
    }
    await user.click(priceList);
    expect(within(dialog).getByRole('group', {
      name: 'Editorial Price List divider style',
    })).toBeVisible();
    expect(screen.getByTestId('booking-section-edit')
      .querySelector('[data-booking-renderer="shared-booking-section"]'))
      .toHaveAttribute('data-layout', 'editorial_price_list');
  });
});

describe('unified section movement', () => {
  it('reorders Booking by number with transactional Cancel and Done controls', async () => {
    installViewport('mobile');
    const user = userEvent.setup();
    render(<App />);
    await chooseQuickBook(user);

    const sectionOrder = () => [...screen.getByRole('list', { name: 'Sections on Home' })
      .querySelectorAll<HTMLElement>('[data-section-label]')]
      .map((element) => element.dataset.sectionLabel);

    const actions = await selectBooking(user);
    await user.click(within(actions).getByRole('button', { name: 'Move' }));
    let dialog = await screen.findByRole('dialog', { name: 'Move Booking' });

    expect(within(dialog).getByLabelText('Position for Section 01')).toHaveValue(1);
    expect(within(dialog).getByLabelText('Position for Section 02')).toHaveValue(2);
    expect(within(dialog).getByLabelText('Position for Booking')).toHaveValue(3);
    expect(within(dialog).getByLabelText('Position for Booking'))
      .toHaveAttribute('aria-describedby', 'move-position-help');
    expect(within(dialog).queryByRole('list', { name: 'Destination pages' }))
      .not.toBeInTheDocument();

    await user.clear(within(dialog).getByLabelText('Position for Booking'));
    await user.type(within(dialog).getByLabelText('Position for Booking'), '1{Enter}');
    expect(sectionOrder()).toEqual(['Booking', 'Section 01', 'Section 02']);

    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(sectionOrder()).toEqual(['Section 01', 'Section 02', 'Booking']);

    await user.click(within(screen.getByRole('group', { name: 'Booking actions' }))
      .getByRole('button', { name: 'Move' }));
    dialog = await screen.findByRole('dialog', { name: 'Move Booking' });
    await user.clear(within(dialog).getByLabelText('Position for Booking'));
    await user.type(within(dialog).getByLabelText('Position for Booking'), '1{Enter}');
    await user.click(within(dialog).getByRole('button', { name: 'Move Booking down' }));
    expect(within(dialog).getByLabelText('Position for Booking')).toHaveValue(2);
    await user.click(within(dialog).getByRole('button', { name: 'Move Booking up' }));
    await user.click(within(dialog).getByRole('button', { name: 'Done' }));

    expect(sectionOrder()).toEqual(['Booking', 'Section 01', 'Section 02']);
  });

  it('keeps cross-page movement behind a secondary disclosure', async () => {
    installViewport('desktop');
    const user = userEvent.setup();
    render(<App />);
    await chooseQuickBook(user);

    const actions = await selectBooking(user);
    await user.click(within(actions).getByRole('button', { name: 'Move' }));
    const dialog = await screen.findByRole('dialog', { name: 'Move Booking' });
    const disclosure = within(dialog).getByRole('button', {
      name: 'Move Booking to another page',
    });

    expect(disclosure).toHaveAttribute('aria-expanded', 'false');
    expect(within(dialog).queryByPlaceholderText('Page name')).not.toBeInTheDocument();
    await user.click(disclosure);
    expect(disclosure).toHaveAttribute('aria-expanded', 'true');
    expect(within(dialog).getByRole('list', { name: 'Destination pages' }))
      .toBeVisible();
    expect(within(dialog).getByPlaceholderText('Page name')).toBeVisible();
  });
});

describe('App customer Preview boundary', () => {
  it('keeps customer intent across owner layout changes while filters and storage stay separate', async () => {
    installViewport('desktop');
    const user = userEvent.setup();
    render(<App />);
    await chooseQuickBook(user);
    await waitFor(() => {
      expect(window.localStorage.getItem(SITE_BUILDER_STORAGE_KEY)).not.toBeNull();
    });
    const storedBeforeCustomerFlow = window.localStorage.getItem(
      SITE_BUILDER_STORAGE_KEY,
    );

    await user.click(screen.getByRole('button', { name: 'Preview' }));
    const preview = await screen.findByTestId('booking-section-preview');
    expect(screen.queryByLabelText('Quick actions for Booking')).not.toBeInTheDocument();
    expect(screen.queryByText('Collapse Booking preview')).not.toBeInTheDocument();
    const search = within(preview).getByRole('searchbox', {
      name: 'Search services',
    });
    await user.type(search, 'russian');
    const russianAction = within(preview).getAllByRole('button', {
      name: /View details for Russian Manicure/,
    })[0];
    if (!russianAction) {
      throw new Error('Preview did not render Russian Manicure.');
    }
    await user.click(russianAction);
    const detail = screen.getByTestId('service-detail-dialog');
    await user.click(within(detail).getByRole('checkbox', { name: /French/ }));
    expect(within(detail).getByTestId('service-detail-total'))
      .toHaveTextContent('1 hr 45 min·From $80');
    await user.click(within(detail).getByRole('button', {
      name: 'Select service',
    }));
    expect(await screen.findByTestId('selected-service-summary'))
      .toHaveTextContent('Russian Manicure1 hr 45 min · From $80');
    expect(window.localStorage.getItem(SITE_BUILDER_STORAGE_KEY))
      .toBe(storedBeforeCustomerFlow);
    expect(storedBeforeCustomerFlow).not.toMatch(/svc-manicure-russian|addon-french|russian/);

    await user.click(screen.getByRole('button', { name: 'Back to editor' }));
    const settingsDialog = await openBookingSettings(user);
    const listOption = settingsDialog.querySelector<HTMLButtonElement>(
      '[data-layout-option="clean_list"]',
    );
    if (!listOption) {
      throw new Error('Clean List layout choice was not rendered.');
    }
    await user.click(listOption);
    await user.click(within(settingsDialog).getByRole('button', {
      name: 'Close Booking',
    }));
    await user.click(screen.getByRole('button', { name: 'Preview' }));

    const nextPreview = await screen.findByTestId('booking-section-preview');
    expect(within(nextPreview).getByTestId('selected-service-summary'))
      .toHaveTextContent('Russian Manicure1 hr 45 min · From $80');
    expect(within(nextPreview).getByRole('searchbox', {
      name: 'Search services',
    })).toHaveValue('');
    await user.click(within(nextPreview).getByRole('button', {
      name: 'Continue',
    }));
    const handoff = screen.getByTestId('booking-handoff-dialog');
    await waitFor(() => expect(handoff).toHaveAttribute('open'));
    expect(handoff).toHaveTextContent('Booking flow continues here');
  });
});
