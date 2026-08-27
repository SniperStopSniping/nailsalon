import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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
  return screen.findByRole('dialog', { name: /Booking/ });
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

    const editorPreview = screen.getByRole('group', {
      name: 'Booking menu preview — 24 services, Visual Grid. Not interactive while editing.',
    });
    expect(editorPreview).not.toHaveAttribute('inert');
    expect(editorPreview).not.toHaveAttribute('aria-hidden');
    expect(within(editorPreview).queryByRole('button')).not.toBeInTheDocument();
    expect(within(editorPreview).queryByRole('searchbox')).not.toBeInTheDocument();
    expect(editorPreview.querySelector('input[placeholder="Search services"]'))
      .toHaveAttribute('aria-hidden', 'true');

    const russianService = [...editorPreview.querySelectorAll<HTMLElement>('.vg-card-entry')]
      .find((candidate) => candidate.textContent?.includes('Russian Manicure'));
    if (!russianService) throw new Error('Russian Manicure preview card was not rendered.');
    await user.click(russianService);

    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith(section);
    expect(onSessionChange).not.toHaveBeenCalled();
    expect(screen.queryByTestId('service-detail-dialog')).not.toBeInTheDocument();
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

  it('contains mobile settings focus and releases inert, lock, and invoker focus on close', async () => {
    installViewport('mobile');
    const user = userEvent.setup();
    render(<App />);
    await chooseQuickBook(user);

    const actions = await selectBooking(user);
    const edit = within(actions).getByRole('button', { name: 'Edit' });
    await user.click(edit);
    const dialog = await screen.findByRole('dialog', { name: 'Booking' });
    const editor = screen.getByTestId('final-hybrid-editor');
    const heading = dialog.querySelector<HTMLElement>('[data-dialog-title]');
    if (!heading) throw new Error('Mobile Booking dialog title was not rendered.');
    await waitFor(() => expect(heading).toHaveFocus());
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(editor).toHaveAttribute('inert', '');
    expect(document.body.style.overflow).toBe('hidden');

    await user.tab({ shift: true });
    expect(dialog).toContainElement(document.activeElement as HTMLElement);
    await user.keyboard('{Escape}');

    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: 'Booking' })).not.toBeInTheDocument();
      expect(edit).toHaveFocus();
    });
    expect(editor).not.toHaveAttribute('inert');
    expect(document.body.style.overflow).toBe('');
    expect(document.body).not.toHaveFocus();
  });

  it('uses the temporary desktop right drawer while keeping the canvas mounted', async () => {
    installViewport('desktop');
    const user = userEvent.setup();
    render(<App />);
    await chooseQuickBook(user);

    const dialog = await openBookingSettings(user);
    expect(dialog).toHaveAccessibleName('Booking settings');
    expect(dialog).toHaveClass('final-booking-settings-drawer');
    expect(dialog).toHaveAttribute('aria-modal', 'false');
    expect(screen.queryByTestId('dialog-nonmodal-layer')).not.toBeInTheDocument();
    expect(screen.getByTestId('final-hybrid-editor')).toBeVisible();
    expect(screen.getByTestId('final-hybrid-editor')).not.toHaveAttribute('inert');
    expect(document.body.style.overflow).toBe('');
    expect(screen.getByRole('listitem', { name: 'Booking on Home' })).toBeVisible();
    expect(dialog.querySelectorAll('[data-layout-option]')).toHaveLength(5);
    expect(within(dialog).getAllByRole('heading', {
      level: 2,
      name: 'Booking',
    })).toHaveLength(1);
    expect(within(dialog).getAllByText(
      /Choose how clients browse your services.*booking settings stay the same\./,
    )).toHaveLength(1);
    expect(within(dialog).getByRole('heading', { name: 'Booking' })).toHaveFocus();

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

    const scrollBody = dialog.querySelector<HTMLElement>('.final-booking-settings-drawer__body');
    if (!scrollBody) throw new Error('Desktop Booking settings body was not rendered.');
    scrollBody.scrollTop = 180;
    await user.click(within(dialog).getByRole('button', { name: 'Hide settings' }));
    expect(dialog).not.toBeVisible();
    expect(screen.queryByRole('button', { name: 'Show Booking settings' }))
      .not.toBeInTheDocument();
    await user.click(within(screen.getByTestId('selected-section-toolbar'))
      .getByRole('button', { name: 'Edit' }));
    expect(dialog).toBeVisible();
    expect(scrollBody.scrollTop).toBe(180);
    expect(within(dialog).getByRole('heading', { name: 'Booking' })).toHaveFocus();
  });

  it('closes the desktop drawer with Escape and restores its invoking control without scrolling', async () => {
    installViewport('desktop');
    const user = userEvent.setup();
    render(<App />);
    await chooseQuickBook(user);
    vi.mocked(window.scrollTo).mockClear();

    const actions = await selectBooking(user);
    const edit = within(actions).getByRole('button', { name: 'Edit' });
    await user.click(edit);
    const dialog = await screen.findByRole('dialog', { name: 'Booking settings' });
    const scrollBody = dialog.querySelector<HTMLElement>(
      '.final-booking-settings-drawer__body',
    );
    if (!scrollBody) throw new Error('Desktop Booking settings body was not rendered.');
    scrollBody.scrollTop = 220;

    const typography = within(dialog).getByLabelText('Booking typography preset');
    typography.focus();
    expect(typography).toHaveFocus();
    await user.keyboard('{Escape}');

    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: 'Booking settings' }))
        .not.toBeInTheDocument();
      expect(edit).toHaveFocus();
    });
    expect(document.body).not.toHaveFocus();
    expect(scrollBody.scrollTop).toBe(220);
    expect(window.scrollTo).not.toHaveBeenCalled();
  });

  it('lets a higher-priority modal consume Escape before the desktop drawer', async () => {
    installViewport('desktop');
    const user = userEvent.setup();
    render(<App />);
    await chooseQuickBook(user);

    const actions = await selectBooking(user);
    const edit = within(actions).getByRole('button', { name: 'Edit' });
    await user.click(edit);
    const drawer = await screen.findByRole('dialog', { name: 'Booking settings' });
    await user.click(screen.getByRole('button', { name: 'More site options' }));
    const more = await screen.findByRole('dialog', { name: 'More' });
    expect(more).toHaveAttribute('aria-modal', 'true');

    await user.keyboard('{Escape}');
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: 'More' })).not.toBeInTheDocument();
    });
    expect(drawer).toBeVisible();

    const typography = within(drawer).getByLabelText('Booking typography preset');
    typography.focus();
    await user.keyboard('{Escape}');
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: 'Booking settings' }))
        .not.toBeInTheDocument();
      expect(edit).toHaveFocus();
    });
  });

  it('lets a pointer-opened native select consume Escape before the desktop drawer', async () => {
    installViewport('desktop');
    const user = userEvent.setup();
    render(<App />);
    await chooseQuickBook(user);

    const actions = await selectBooking(user);
    const edit = within(actions).getByRole('button', { name: 'Edit' });
    await user.click(edit);
    const drawer = await screen.findByRole('dialog', { name: 'Booking settings' });
    const typography = within(drawer).getByLabelText('Booking typography preset');

    await user.click(typography);
    await user.keyboard('{Escape}');
    expect(drawer).toBeVisible();
    expect(typography).toHaveFocus();

    await user.keyboard('{Escape}');
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: 'Booking settings' }))
        .not.toBeInTheDocument();
      expect(edit).toHaveFocus();
    });
  });
});

describe('nested Page settings surface', () => {
  it('keeps Pages & Structure mounted, scrolled, and focused through every child close path', async () => {
    installViewport('mobile');
    const user = userEvent.setup();
    render(<App />);
    await chooseQuickBook(user);

    const structureTrigger = screen.getByRole('button', {
      name: 'Open Pages & Structure for Home',
    });
    await user.click(structureTrigger);
    const structure = await screen.findByRole('dialog', { name: 'Pages & Structure' });
    const structureBody = structure.querySelector<HTMLElement>('.dialog-body');
    if (!structureBody) throw new Error('Pages & Structure scroll body was not rendered.');
    structureBody.scrollTop = 96;

    const expectReturnedToPageTrigger = async (pageName: string) => {
      const trigger = within(structure).getByRole('button', {
        name: `Page settings for ${pageName}`,
      });
      await waitFor(() => expect(trigger).toHaveFocus());
      expect(structure).toBeVisible();
      expect(structureBody.scrollTop).toBe(96);
      expect(document.activeElement).not.toBe(document.body);
      expect(document.body.style.overflow).toBe('hidden');
      return trigger;
    };

    let pageTrigger = within(structure).getByRole('button', {
      name: 'Page settings for Home',
    });
    await user.click(pageTrigger);
    let settings = await screen.findByRole('dialog', { name: 'Home settings' });
    const name = within(settings).getByLabelText('Page name');
    await user.clear(name);
    await user.type(name, 'Studio');
    await user.click(within(settings).getByRole('button', { name: 'Save page' }));
    expect(screen.queryByRole('dialog', { name: 'Home settings' }))
      .not.toBeInTheDocument();
    pageTrigger = await expectReturnedToPageTrigger('Studio');

    await user.click(pageTrigger);
    settings = await screen.findByRole('dialog', { name: 'Studio settings' });
    await user.clear(within(settings).getByLabelText('Page name'));
    await user.type(within(settings).getByLabelText('Page name'), 'Discarded');
    await user.click(within(settings).getByRole('button', { name: 'Cancel' }));
    pageTrigger = await expectReturnedToPageTrigger('Studio');

    await user.click(pageTrigger);
    settings = await screen.findByRole('dialog', { name: 'Studio settings' });
    await user.click(within(settings).getByRole('button', {
      name: 'Close Studio settings',
    }));
    pageTrigger = await expectReturnedToPageTrigger('Studio');

    await user.click(pageTrigger);
    settings = await screen.findByRole('dialog', { name: 'Studio settings' });
    within(settings).getByLabelText('Page name').focus();
    await user.keyboard('{Escape}');
    pageTrigger = await expectReturnedToPageTrigger('Studio');

    await user.click(pageTrigger);
    settings = await screen.findByRole('dialog', { name: 'Studio settings' });
    const childBackdrop = settings.closest<HTMLElement>('.dialog-backdrop');
    if (!childBackdrop) throw new Error('Page settings backdrop was not rendered.');
    fireEvent.mouseDown(childBackdrop);
    await expectReturnedToPageTrigger('Studio');

    await user.keyboard('{Escape}');
    await waitFor(() => expect(structure).not.toBeInTheDocument());
    await waitFor(() => expect(structureTrigger).toHaveFocus());
    expect(document.body.style.overflow).toBe('');
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
    expect(within(dialog).getByText(/There are no other pages yet/)).toBeVisible();
    expect(within(dialog).getByPlaceholderText('Page name')).toBeVisible();
  });
});

describe('App customer Preview boundary', () => {
  it('announces the measured preview-frame width while preserving device state', async () => {
    installViewport('desktop');
    const widths = {
      desktop: 1_184,
      mobile: 386,
      tablet: 742,
    } as const;
    const originalGetBoundingClientRect = HTMLElement.prototype.getBoundingClientRect;
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      if (this.classList.contains('preview-frame')) {
        const viewport = this.dataset.previewViewport as keyof typeof widths;
        const width = widths[viewport];
        return {
          bottom: 640,
          height: 640,
          left: 0,
          right: width,
          top: 0,
          width,
          x: 0,
          y: 0,
          toJSON: () => ({}),
        };
      }
      return originalGetBoundingClientRect.call(this);
    });
    const user = userEvent.setup();
    render(<App />);
    await chooseQuickBook(user);
    await user.click(screen.getByRole('button', { name: 'Preview' }));

    const devices = screen.getByRole('group', { name: 'Preview viewport' });
    const desktop = within(devices).getByRole('button', { name: 'Desktop' });
    const tablet = within(devices).getByRole('button', { name: 'Tablet' });
    const phone = within(devices).getByRole('button', { name: 'Phone' });
    const liveRegion = screen.getByTestId('preview-viewport-announcement');

    expect(desktop).toHaveAttribute('aria-pressed', 'true');
    expect(tablet).toHaveAttribute('aria-pressed', 'false');
    expect(phone).toHaveAttribute('aria-pressed', 'false');

    await user.click(phone);
    expect(phone).toHaveAttribute('aria-pressed', 'true');
    expect(desktop).toHaveAttribute('aria-pressed', 'false');
    await waitFor(() => {
      expect(liveRegion).toHaveTextContent(
        'Phone preview selected — 386 pixels wide.',
      );
    });

    tablet.focus();
    await user.keyboard('{Enter}');
    expect(tablet).toHaveAttribute('aria-pressed', 'true');
    expect(phone).toHaveAttribute('aria-pressed', 'false');
    await waitFor(() => {
      expect(liveRegion).toHaveTextContent(
        'Tablet preview selected — 742 pixels wide.',
      );
    });

    const announcementBeforeRepeat = liveRegion.textContent;
    const repeatedAnnouncement = vi.fn();
    const observer = new MutationObserver(repeatedAnnouncement);
    observer.observe(liveRegion, {
      characterData: true,
      childList: true,
      subtree: true,
    });
    await user.click(tablet);
    await new Promise(resolve => window.setTimeout(resolve, 0));
    observer.disconnect();
    expect(liveRegion).toHaveTextContent(
      'Tablet preview selected — 742 pixels wide.',
    );
    expect(liveRegion.textContent).toBe(announcementBeforeRepeat);
    expect(repeatedAnnouncement).not.toHaveBeenCalled();
    expect(tablet).toHaveAttribute('aria-pressed', 'true');
  });

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
      .toHaveTextContent('Russian Manicure1 hr 45 min · From $80 · 1 add-on');
    expect(window.localStorage.getItem(SITE_BUILDER_STORAGE_KEY))
      .toBe(storedBeforeCustomerFlow);
    expect(storedBeforeCustomerFlow).not.toMatch(/svc-manicure-russian|addon-french|russian/);

    await user.click(screen.getByRole('button', { name: 'Back to editor' }));
    const editPreview = await screen.findByTestId('booking-section-edit');
    expect(editPreview.querySelector('input[placeholder="Search services"]'))
      .toHaveValue('');
    expect(editPreview.querySelector('[data-has-selection="false"]')).toBeInTheDocument();
    expect(screen.queryByTestId('selected-service-summary')).not.toBeInTheDocument();
    expect(screen.queryByTestId('service-detail-dialog')).not.toBeInTheDocument();
    expect(screen.queryByTestId('booking-handoff-dialog')).not.toBeInTheDocument();
    expect(within(editPreview).getAllByText('Russian Manicure').length).toBeGreaterThan(0);
    const settingsDialog = await openBookingSettings(user);
    const listOption = settingsDialog.querySelector<HTMLButtonElement>(
      '[data-layout-option="clean_list"]',
    );
    if (!listOption) {
      throw new Error('Clean List layout choice was not rendered.');
    }
    await user.click(listOption);
    await user.click(within(settingsDialog).getByRole('button', {
      name: /Close Booking/,
    }));
    await user.click(screen.getByRole('button', { name: 'Preview' }));

    const nextPreview = await screen.findByTestId('booking-section-preview');
    expect(screen.getByTestId('selected-service-summary'))
      .toHaveTextContent('Russian Manicure1 hr 45 min · From $80 · 1 add-on');
    expect(within(nextPreview).getByRole('searchbox', {
      name: 'Search services',
    })).toHaveValue('');
    await user.click(within(screen.getByTestId('selected-service-summary')).getByRole('button', {
      name: 'Continue',
    }));
    const handoff = screen.getByTestId('booking-handoff-dialog');
    expect(handoff).toHaveAttribute('aria-modal', 'true');
    expect(handoff).toHaveTextContent('Booking flow continues here');
  });
});
