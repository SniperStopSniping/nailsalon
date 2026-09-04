import { readFileSync } from 'node:fs';

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';

import { BookingSectionRenderer } from './BookingSectionRenderer';
import {
  createEmptyBookingSession,
  createMenuFixture,
} from './helpers';
import {
  createDefaultBookingPresentationSettings,
  replaceActiveLayoutSettings,
  switchBookingLayout,
} from './presentation';
import type {
  BookingMenuLayout,
  BookingSectionPresentationSettings,
  BookingSessionState,
  MockMenuFixture,
} from './types';

const bookingCss = readFileSync('src/booking/booking.css', 'utf8');

const LAYOUT_REGION_NAMES: Record<BookingMenuLayout, string> = {
  visual_grid: 'Visual service grid',
  clean_list: 'Clean service list',
  editorial_cards: 'Editorial service stories',
  category_menu: 'Category service menu',
  editorial_price_list: 'Editorial service price list',
};

const LAYOUT_LABELS: Record<BookingMenuLayout, string> = {
  visual_grid: 'Visual Grid',
  clean_list: 'Clean List',
  editorial_cards: 'Editorial Cards',
  category_menu: 'Category Menu',
  editorial_price_list: 'Editorial Price List',
};

const APPROVED_LAYOUTS = Object.keys(LAYOUT_REGION_NAMES) as BookingMenuLayout[];

function settingsFor(layout: BookingMenuLayout): BookingSectionPresentationSettings {
  return switchBookingLayout(
    createDefaultBookingPresentationSettings(),
    layout,
  );
}

function SessionHarness({
  fixture,
  initialSession,
  mode = 'preview',
  settings,
}: {
  fixture?: MockMenuFixture;
  initialSession?: BookingSessionState;
  mode?: 'edit' | 'preview';
  settings: BookingSectionPresentationSettings;
}) {
  const [session, setSession] = useState<BookingSessionState>(
    initialSession ?? createEmptyBookingSession(),
  );

  return (
    <>
      <BookingSectionRenderer
        fixture={fixture}
        mode={mode}
        presentationSettings={settings}
        session={session}
        onSessionChange={setSession}
      />
      <output data-testid="controlled-booking-session">
        {JSON.stringify(session)}
      </output>
    </>
  );
}

function readSession(): BookingSessionState {
  return JSON.parse(
    screen.getByTestId('controlled-booking-session').textContent ?? '',
  ) as BookingSessionState;
}

describe.each(APPROVED_LAYOUTS)('%s customer renderer', (layout) => {
  it('uses the shared detail, Russian + French selection, summary, and handoff flow', async () => {
    const user = userEvent.setup();
    render(<SessionHarness settings={settingsFor(layout)} />);

    const activeRegion = screen.getByRole('region', {
      name: LAYOUT_REGION_NAMES[layout],
    });

    expect(activeRegion.closest('[data-booking-renderer="shared-booking-section"]'))
      .toHaveAttribute('data-layout', layout);
    expect(document.querySelectorAll('[data-booking-renderer="shared-booking-section"]'))
      .toHaveLength(1);

    for (const inactiveLayout of APPROVED_LAYOUTS.filter(candidate => candidate !== layout)) {
      expect(screen.queryByRole('region', {
        name: LAYOUT_REGION_NAMES[inactiveLayout],
      })).not.toBeInTheDocument();
    }

    const russianAction = within(activeRegion).getAllByRole('button', {
      name: /Russian Manicure/,
    })[0];
    if (!russianAction) {
      throw new Error(`${layout} did not render the Russian Manicure action.`);
    }
    await user.click(russianAction);

    const detail = screen.getByTestId('service-detail-dialog');
    const scrollBody = within(detail).getByTestId('service-detail-scroll-body');
    const actionFooter = within(detail).getByTestId('service-detail-action-footer');
    const closeControls = within(detail).getAllByRole('button', {
      name: 'Close service details',
    });
    const closeControl = closeControls[0];
    if (!closeControl) {
      throw new Error(`${layout} did not render the Service Detail close control.`);
    }

    expect(detail).toHaveClass('booking-service-detail-shell');
    expect(closeControls).toHaveLength(1);
    expect(scrollBody).not.toContainElement(closeControl);
    expect(closeControl.parentElement).toBe(scrollBody.parentElement);
    expect(closeControl.nextElementSibling).toBe(scrollBody);
    expect(scrollBody.nextElementSibling).toBe(actionFooter);
    expect(scrollBody.parentElement).toHaveClass('booking-dialog-panel');
    expect(scrollBody).not.toContainElement(actionFooter);
    expect(within(actionFooter).getByRole('button', { name: 'Keep browsing' })).toBeVisible();
    expect(within(actionFooter).getByRole('button', { name: 'Continue' })).toBeVisible();
    expect(within(actionFooter).getAllByRole('button')).toHaveLength(2);
    expect(within(actionFooter).queryByRole('button', { name: 'Select service' }))
      .not.toBeInTheDocument();
    expect(readSession().selection).toEqual({
      serviceId: 'svc-manicure-russian',
      addOnIds: [],
    });
    expect(scrollBody).toHaveAttribute(
      'data-image-mode',
      layout === 'visual_grid' ? 'auto' : 'show',
    );
    expect(await within(detail).findByRole('heading', {
      name: 'Russian Manicure',
    })).toBeVisible();

    const french = within(detail).getByRole('checkbox', { name: /French/ });
    await user.click(french);

    expect(french).toBeChecked();
    expect(within(detail).getByTestId('service-detail-total'))
      .toHaveTextContent('1 hr 45 min·From $80');
    expect(readSession().selection.addOnIds).toEqual([]);

    await user.click(within(detail).getByRole('button', { name: 'Keep browsing' }));

    const summary = await screen.findByTestId('selected-service-summary');

    expect(summary).toHaveTextContent('Russian Manicure');
    expect(summary).toHaveTextContent('1 hr 45 min · From $80');
    expect(readSession().selection).toEqual({
      serviceId: 'svc-manicure-russian',
      addOnIds: ['addon-french'],
    });

    await user.click(within(summary).getByRole('button', { name: 'Change' }));
    const changedDetail = await screen.findByTestId('service-detail-dialog');

    expect(changedDetail).not.toBe(detail);
    expect(within(changedDetail).getByRole('checkbox', { name: /French/ })).toBeChecked();
    expect(within(changedDetail).getByRole('button', { name: 'Continue' })).toBeVisible();

    await user.click(within(changedDetail).getByRole('button', { name: 'Keep browsing' }));
    await user.click(within(summary).getByRole('button', { name: 'Continue' }));

    const handoff = await screen.findByRole('dialog', {
      name: 'Booking flow continues here',
    });

    expect(handoff).toBe(screen.getByTestId('booking-handoff-dialog'));
    expect(handoff).toHaveAttribute('aria-modal', 'true');
    expect(handoff).not.toHaveAttribute('open');
    expect(handoff).toHaveTextContent('Booking flow continues here');
    expect(handoff).toHaveTextContent('Russian Manicure · 1 hr 45 min · From $80');
    expect(within(handoff).getByLabelText('Booking steps'))
      .toHaveTextContent('ServiceOptionsTechnicianTimeDetailsPaymentConfirmation');
  });

  function setupChangeOptions(addOnIds = ['addon-french']) {
    const user = userEvent.setup();
    const committedFrench: BookingSessionState = {
      selection: {
        serviceId: 'svc-manicure-russian',
        addOnIds,
      },
      query: '',
      activeCategory: 'all',
      detailServiceId: null,
      draftAddOnIds: [],
      handoffOpen: false,
    };
    render(
      <SessionHarness
        initialSession={committedFrench}
        settings={settingsFor(layout)}
      />,
    );

    const summary = screen.getByTestId('selected-service-summary');
    const openOptions = async () => {
      await user.click(within(summary).getByRole('button', { name: 'Change' }));
      return screen.findByTestId('service-detail-dialog');
    };
    const toggleFrench = async (detail: HTMLElement) => {
      await user.click(within(detail).getByRole('checkbox', { name: 'French' }));
    };

    return { user, summary, openOptions, toggleFrench };
  }

  it('commits Change options when the customer keeps browsing', async () => {
    const { user, summary, openOptions, toggleFrench } = setupChangeOptions();
    const detail = await openOptions();
    await toggleFrench(detail);

    expect(within(detail).getByTestId('service-detail-total'))
      .toHaveTextContent('1 hr 30 min·From $65');
    expect(summary).toHaveTextContent('1 hr 45 min · From $80');

    await user.click(within(detail).getByRole('button', { name: 'Keep browsing' }));

    expect(summary).toHaveTextContent('1 hr 30 min · From $65');
    expect(readSession().selection.addOnIds).toEqual([]);
  });

  it('preserves dirty options when each service-detail dismissal returns to editing', async () => {
    const { user, summary, openOptions, toggleFrench } = setupChangeOptions([]);
    const detail = await openOptions();
    await toggleFrench(detail);
    const close = within(detail).getByRole('button', { name: 'Close service details' });
    await user.click(close);
    let warning = await screen.findByRole('dialog', { name: 'Save your option changes?' });

    expect(detail).toHaveAttribute('aria-hidden', 'true');
    expect(detail).toHaveAttribute('inert');

    await waitFor(() => {
      expect(within(warning).getByRole('button', { name: 'Keep editing' }))
        .toHaveFocus();
    });
    await user.click(within(warning).getByRole('button', { name: 'Keep editing' }));

    expect(screen.queryByRole('dialog', { name: 'Save your option changes?' }))
      .not.toBeInTheDocument();
    expect(detail).not.toHaveAttribute('aria-hidden');
    expect(detail).not.toHaveAttribute('inert');
    expect(within(detail).getByRole('checkbox', { name: 'French' })).toBeChecked();
    expect(within(detail).getByTestId('service-detail-total'))
      .toHaveTextContent('1 hr 45 min·From $80');
    expect(summary).toHaveTextContent('1 hr 30 min · From $65');
    expect(readSession().selection.addOnIds).toEqual([]);
    expect(document.body.style.overflow).toBe('');

    await waitFor(() => expect(close).toHaveFocus());

    await user.keyboard('{Escape}');
    warning = await screen.findByRole('dialog', { name: 'Save your option changes?' });
    await user.click(within(warning).getByRole('button', { name: 'Keep editing' }));

    expect(within(detail).getByRole('checkbox', { name: 'French' })).toBeChecked();

    await waitFor(() => expect(close).toHaveFocus());

    fireEvent.mouseDown(screen.getByTestId('service-detail-dialog-backdrop'));
    warning = await screen.findByRole('dialog', { name: 'Save your option changes?' });
    await user.click(within(warning).getByRole('button', { name: 'Keep editing' }));

    expect(within(detail).getByRole('checkbox', { name: 'French' })).toBeChecked();

    await waitFor(() => expect(close).toHaveFocus());
  });

  it('dismisses only the option warning with Escape or its backdrop', async () => {
    const { user, openOptions, toggleFrench } = setupChangeOptions([]);
    const detail = await openOptions();
    await toggleFrench(detail);
    const close = within(detail).getByRole('button', { name: 'Close service details' });
    await user.click(close);
    await screen.findByRole('dialog', { name: 'Save your option changes?' });
    await user.keyboard('{Escape}');

    expect(screen.queryByRole('dialog', { name: 'Save your option changes?' }))
      .not.toBeInTheDocument();
    expect(detail).not.toHaveAttribute('aria-hidden');
    expect(detail).not.toHaveAttribute('inert');

    await waitFor(() => expect(close).toHaveFocus());

    fireEvent.mouseDown(screen.getByTestId('service-detail-dialog-backdrop'));
    await screen.findByRole('dialog', { name: 'Save your option changes?' });
    fireEvent.mouseDown(screen.getByTestId('booking-option-warning-dialog-backdrop'));

    expect(screen.queryByRole('dialog', { name: 'Save your option changes?' }))
      .not.toBeInTheDocument();
    expect(detail).toBeVisible();
    expect(within(detail).getByRole('checkbox', { name: 'French' })).toBeChecked();
    expect(readSession().selection.addOnIds).toEqual([]);
  });

  it('explicitly saves or discards dirty Change options', async () => {
    const { user, summary, openOptions, toggleFrench } = setupChangeOptions([]);
    let detail = await openOptions();
    await toggleFrench(detail);
    await user.keyboard('{Escape}');
    let warning = await screen.findByRole('dialog', { name: 'Save your option changes?' });
    await user.click(within(warning).getByRole('button', { name: 'Save changes' }));

    expect(summary).toHaveTextContent('1 hr 45 min · From $80');
    expect(readSession().selection.addOnIds).toEqual(['addon-french']);

    detail = await openOptions();
    await toggleFrench(detail);
    await user.click(within(detail).getByRole('button', { name: 'Close service details' }));
    warning = await screen.findByRole('dialog', { name: 'Save your option changes?' });
    await user.click(within(warning).getByRole('button', { name: 'Discard changes' }));

    expect(summary).toHaveTextContent('1 hr 45 min · From $80');
    expect(readSession().selection.addOnIds).toEqual(['addon-french']);
  });

  it('closes unchanged options without a warning and commits when continuing', async () => {
    const { user, openOptions, toggleFrench } = setupChangeOptions();
    let detail = await openOptions();
    await user.click(within(detail).getByRole('button', { name: 'Close service details' }));

    expect(screen.queryByTestId('service-detail-dialog')).not.toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: 'Save your option changes?' }))
      .not.toBeInTheDocument();

    detail = await openOptions();
    await user.keyboard('{Escape}');

    expect(screen.queryByTestId('service-detail-dialog')).not.toBeInTheDocument();

    detail = await openOptions();
    fireEvent.mouseDown(screen.getByTestId('service-detail-dialog-backdrop'));

    expect(screen.queryByTestId('service-detail-dialog')).not.toBeInTheDocument();

    detail = await openOptions();
    await toggleFrench(detail);
    await user.click(within(detail).getByRole('button', { name: 'Continue' }));

    expect(readSession().selection.addOnIds).toEqual([]);
    expect(await screen.findByRole('dialog', { name: 'Booking flow continues here' }))
      .toHaveTextContent('Russian Manicure · 1 hr 30 min · From $65');
  });
});

describe('personalized Booking identity', () => {
  it('uses the active salon identity in service-detail fallbacks', async () => {
    const user = userEvent.setup();
    const fixture = createMenuFixture();
    const firstService = fixture.services[0];
    if (!firstService) {
      throw new Error('The canonical Booking fixture has no services.');
    }
    const personalized: MockMenuFixture = {
      ...fixture,
      salon: { ...fixture.salon, name: 'Mia’s Nail Studio' },
      services: fixture.services.map(service => service.id === firstService.id
        ? { ...service, image: null, longDescription: null }
        : service),
    };

    render(
      <SessionHarness
        fixture={personalized}
        settings={settingsFor('clean_list')}
      />,
    );
    await user.click(screen.getAllByRole('button', {
      name: `View details for ${firstService.name}`,
    })[0]!);

    const detail = await screen.findByTestId('service-detail-dialog');

    expect(within(detail).getByRole('img', {
      name: `No service photo available for ${firstService.name}`,
    })).toHaveTextContent('Mia’s Nail Studio');
    expect(detail).toHaveTextContent(
      'Ask Mia’s Nail Studio about the finish and options available for this service.',
    );
    expect(detail).not.toHaveTextContent('Isla Nail Studio');
  });

  it('keeps canonical service descriptions neutral under a different salon identity', async () => {
    const user = userEvent.setup();
    const fixture = createMenuFixture();
    const gelService = fixture.services.find(service => service.id === 'svc-manicure-gel');
    if (!gelService) {
      throw new Error('The canonical Booking fixture has no Gel Manicure.');
    }

    render(
      <SessionHarness
        fixture={{ ...fixture, salon: { ...fixture.salon, name: 'Mia’s Nail Studio' } }}
        settings={settingsFor('clean_list')}
      />,
    );
    await user.click(screen.getAllByRole('button', {
      name: `View details for ${gelService.name}`,
    })[0]!);

    const detail = await screen.findByTestId('service-detail-dialog');

    expect(detail).toHaveTextContent('the studio colour collection');
    expect(detail).not.toHaveTextContent(/Isla/iu);
  });
});

describe('Booking renderer mode and session boundaries', () => {
  it('keeps the real menu readable but makes customer controls read-only in Edit', () => {
    const onSessionChange = vi.fn();
    render(
      <BookingSectionRenderer
        mode="edit"
        presentationSettings={createDefaultBookingPresentationSettings()}
        session={createEmptyBookingSession()}
        onSessionChange={onSessionChange}
      />,
    );

    const editor = screen.getByTestId('booking-section-edit');
    const customerRegion = editor.querySelector('.booking-customer-region');

    expect(screen.getByRole('group', {
      name: `Booking menu preview — ${createMenuFixture().services.length} services, Visual Grid. Not interactive while editing.`,
    })).toBe(customerRegion);
    expect(customerRegion).not.toHaveAttribute('inert');
    expect(customerRegion).not.toHaveAttribute('aria-hidden');
    expect(editor).toHaveAttribute('data-booking-mode', 'edit');
    expect(editor.querySelector('.booking-surface')).toHaveAttribute(
      'data-has-selection',
      'false',
    );
    expect(within(editor).queryByRole('button')).not.toBeInTheDocument();
    expect(within(editor).queryByRole('searchbox')).not.toBeInTheDocument();
    expect(editor.querySelector('input[placeholder="Try “Russian manicure”"]'))
      .toHaveAttribute('aria-hidden', 'true');
    expect(editor.querySelector('input[placeholder="Try “Russian manicure”"]'))
      .toHaveAttribute('readonly');

    const customerControls = editor.querySelectorAll<HTMLElement>(
      'button, input, select, textarea, a[href]',
    );

    expect(customerControls.length).toBeGreaterThan(0);

    customerControls.forEach((control) => {
      expect(control).toHaveAttribute('tabindex', '-1');
      expect(control).toHaveAttribute('aria-hidden', 'true');
    });

    expect(editor.querySelectorAll('[data-editor-readonly-control]').length)
      .toBeGreaterThan(customerControls.length);
    expect(screen.getAllByText('Russian Manicure').length).toBeGreaterThan(0);
    expect(screen.queryByTestId('service-detail-dialog')).not.toBeInTheDocument();
    expect(screen.queryByTestId('booking-handoff-dialog')).not.toBeInTheDocument();
    expect(screen.queryByTestId('selected-service-summary')).not.toBeInTheDocument();
    expect(onSessionChange).not.toHaveBeenCalled();
  });

  it.each(APPROVED_LAYOUTS)('keeps %s readable without Edit-mode tab stops or key suppression', (layout) => {
    render(
      <BookingSectionRenderer
        mode="edit"
        presentationSettings={settingsFor(layout)}
        session={createEmptyBookingSession()}
        onSessionChange={vi.fn()}
      />,
    );

    const editor = screen.getByTestId('booking-section-edit');
    const customerRegion = editor.querySelector<HTMLElement>('.booking-customer-region');
    if (!customerRegion) {
      throw new Error(`${layout} did not render its customer region.`);
    }

    expect(customerRegion).toHaveAccessibleName(
      `Booking menu preview — ${createMenuFixture().services.length} services, ${LAYOUT_LABELS[layout]}. Not interactive while editing.`,
    );
    expect(customerRegion).toHaveTextContent('Russian Manicure');
    expect(customerRegion).toHaveTextContent('From $65');

    customerRegion.querySelectorAll<HTMLElement>(
      'button, input, select, textarea, a[href], .booking-category-strip, .featured-scroller, .category-sidebar',
    ).forEach((candidate) => {
      expect(candidate.tabIndex).toBeLessThan(0);
    });
    for (const key of ['Tab', 'Escape']) {
      const keyboardEvent = new KeyboardEvent('keydown', {
        bubbles: true,
        cancelable: true,
        key,
      });
      customerRegion.dispatchEvent(keyboardEvent);

      expect(keyboardEvent.defaultPrevented).toBe(false);
    }
  });

  it('suppresses preserved customer filters, selection, and overlays in Edit mode', () => {
    const initialSession: BookingSessionState = {
      selection: {
        serviceId: 'svc-manicure-russian',
        addOnIds: ['addon-french'],
      },
      query: 'russ',
      activeCategory: 'manicure',
      detailServiceId: 'svc-manicure-russian',
      draftAddOnIds: ['addon-french'],
      handoffOpen: true,
    };

    render(
      <SessionHarness
        initialSession={initialSession}
        mode="edit"
        settings={settingsFor('visual_grid')}
      />,
    );

    expect(screen.getByTestId('booking-section-edit').querySelector('input[placeholder="Try “Russian manicure”"]'))
      .toHaveValue('');
    expect(screen.getByTestId('booking-section-edit').querySelector('.booking-category-pill.is-active'))
      .toHaveTextContent('All');
    expect(document.querySelectorAll('[data-selected="true"]')).toHaveLength(0);
    expect(screen.getByTestId('booking-section-edit').querySelector('.booking-surface'))
      .toHaveAttribute('data-has-selection', 'false');
    expect(screen.queryByTestId('selected-service-summary')).not.toBeInTheDocument();
    expect(screen.queryByTestId('service-detail-dialog')).not.toBeInTheDocument();
    expect(screen.queryByTestId('booking-handoff-dialog')).not.toBeInTheDocument();
    expect(readSession()).toEqual(initialSession);
  });

  it('preserves committed selection and add-ons while clearing filters on layout change', async () => {
    const initialSession: BookingSessionState = {
      selection: {
        serviceId: 'svc-manicure-russian',
        addOnIds: ['addon-french'],
      },
      query: 'russian',
      activeCategory: 'manicure',
      detailServiceId: null,
      draftAddOnIds: [],
      handoffOpen: false,
    };
    const visual = settingsFor('visual_grid');
    const { rerender } = render(
      <SessionHarness initialSession={initialSession} settings={visual} />,
    );

    expect(screen.getByRole('searchbox', { name: 'Search services' }))
      .toHaveValue('russian');
    expect(screen.getByTestId('selected-service-summary'))
      .toHaveTextContent('Russian Manicure1 hr 45 min · From $80');

    rerender(
      <SessionHarness
        initialSession={initialSession}
        settings={switchBookingLayout(visual, 'clean_list')}
      />,
    );

    await waitFor(() => {
      expect(readSession()).toMatchObject({
        selection: {
          serviceId: 'svc-manicure-russian',
          addOnIds: ['addon-french'],
        },
        query: '',
        activeCategory: 'all',
        detailServiceId: null,
        draftAddOnIds: [],
        handoffOpen: false,
      });
    });

    expect(screen.getByRole('searchbox', { name: 'Search services' })).toHaveValue('');
    expect(screen.getByTestId('selected-service-summary'))
      .toHaveTextContent('Russian Manicure1 hr 45 min · From $80');
  });

  it.each(['visual_grid', 'clean_list', 'category_menu'] as const)(
    'searches the full canonical menu in %s and restores the prior category',
    async (layout) => {
      const user = userEvent.setup();
      const initialSession: BookingSessionState = {
        selection: { serviceId: null, addOnIds: [] },
        query: '',
        activeCategory: 'pedicure',
        detailServiceId: null,
        draftAddOnIds: [],
        handoffOpen: false,
      };
      const { container } = render(
        <SessionHarness
          initialSession={initialSession}
          settings={settingsFor(layout)}
        />,
      );

      expect(screen.queryByRole('button', { name: /Russian Manicure/ }))
        .not.toBeInTheDocument();

      const search = screen.getByRole('searchbox', { name: 'Search services' });

      expect(search).toHaveAttribute('placeholder', 'Try “Russian manicure”');
      expect(screen.getByText('Search services')).toHaveClass('sr-only');
      expect(bookingCss).toContain(
        '.booking-search-field input[type=\'search\']::-webkit-search-cancel-button',
      );
      expect(bookingCss).toContain('.booking-search-field .sr-only {');
      expect(bookingCss).toContain('-webkit-appearance: none;');

      await user.type(search, '  RuSs  ');

      expect(screen.getAllByRole('button', { name: /Russian Manicure/ }).length)
        .toBeGreaterThan(0);

      if (layout === 'category_menu') {
        expect(container.querySelector('.category-sidebar-button.is-active'))
          .toHaveTextContent('All services');
      } else {
        expect(container.querySelector('.booking-category-pill.is-active'))
          .toHaveTextContent('All');
      }

      expect(readSession().activeCategory).toBe('pedicure');

      const searchField = search.closest<HTMLElement>('.booking-search-field');
      if (!searchField) {
        throw new Error(`${layout} search field was not rendered.`);
      }

      expect(within(searchField).getAllByRole('button', {
        name: 'Clear service search',
      })).toHaveLength(1);

      await user.click(within(searchField).getByRole('button', {
        name: 'Clear service search',
      }));
      await waitFor(() => expect(search).toHaveFocus());

      expect(search).toHaveValue('');
      expect(search).toHaveAttribute('placeholder', 'Try “Russian manicure”');
      expect(screen.queryByRole('button', { name: /Russian Manicure/ }))
        .not.toBeInTheDocument();

      if (layout === 'category_menu') {
        expect(container.querySelector('.category-sidebar-button.is-active'))
          .toHaveTextContent('Pedicure');
      } else {
        expect(container.querySelector('.booking-category-pill.is-active'))
          .toHaveTextContent('Pedicure');
      }

      await user.type(search, 'no matching service');

      expect(screen.getByRole('heading', { name: 'No services found' })).toBeVisible();
      expect(screen.getByText('Try another search across the full menu.')).toBeVisible();

      await user.click(within(searchField).getByRole('button', {
        name: 'Clear service search',
      }));
      await waitFor(() => expect(search).toHaveFocus());

      expect(screen.queryByRole('heading', { name: 'No services found' }))
        .not.toBeInTheDocument();
    },
  );

  it.each(['editorial_cards', 'editorial_price_list'] as const)(
    'keeps search absent by design from the canonical %s menu',
    (layout) => {
      render(<SessionHarness settings={settingsFor(layout)} />);

      expect(screen.queryByRole('searchbox', { name: 'Search services' }))
        .not.toBeInTheDocument();
    },
  );

  it('keeps Visual Grid Featured geometry equal in Edit and interactive Preview', () => {
    const { container, unmount } = render(
      <SessionHarness mode="edit" settings={settingsFor('visual_grid')} />,
    );
    const editFeatured = container.querySelector<HTMLElement>('.featured-tile');

    expect(editFeatured).not.toBeNull();
    expect(editFeatured?.tagName).toBe('DIV');

    unmount();

    const preview = render(
      <SessionHarness settings={settingsFor('visual_grid')} />,
    );
    const previewFeatured = preview.container.querySelector<HTMLButtonElement>('.featured-tile');

    expect(previewFeatured).not.toBeNull();
    expect(previewFeatured?.tagName).toBe('BUTTON');

    const featuredRule = bookingCss.match(
      /\.luster-booking \.featured-tile \{([^}]*)\}/,
    )?.[1];

    expect(featuredRule).toContain('min-height: 176px;');

    const genericButtonRule = bookingCss.match(
      /\.luster-booking button \{([^}]*)\}/,
    )?.[1];

    expect(genericButtonRule).toContain('min-height: 44px;');
  });

  it('defines the Service Detail body as the sole internal vertical scroller', () => {
    const bodyRule = bookingCss.match(
      /\.booking-service-detail-body \{([^}]*)\}/,
    )?.[1];

    expect(bodyRule).toContain('min-height: 0;');
    expect(bodyRule).toContain('flex: 1 1 auto;');
    expect(bodyRule).toContain('overflow-y: auto;');
    expect(bodyRule).toContain('overscroll-behavior: contain;');
    expect(bodyRule).toContain('-webkit-overflow-scrolling: touch;');

    const compactPanelRule = bookingCss.match(
      /@media \(max-width: 620px\), \(max-height: 620px\) \{[\s\S]*?\.booking-service-detail-shell > \.booking-dialog-panel \{([^}]*)\}/,
    )?.[1];

    expect(compactPanelRule).toContain('display: grid;');
    expect(compactPanelRule).toContain('grid-template-rows: 72px minmax(0, 1fr) auto;');

    const compactCloseRule = bookingCss.match(
      /\.booking-service-detail-shell \.booking-dialog-close \{([^}]*)\}/,
    )?.[1];

    expect(compactCloseRule).toContain('position: relative;');
    expect(compactCloseRule).toContain('grid-row: 1;');
    expect(compactCloseRule).toContain('margin-inline-end: 14px;');

    const simulatedPhonePanelRule = bookingCss.match(
      /\.booking-preview-overlays\[data-preview-viewport='mobile'\]\s+\.booking-service-detail-shell > \.booking-dialog-panel \{([^}]*)\}/,
    )?.[1];

    expect(simulatedPhonePanelRule).toContain('display: grid;');
    expect(simulatedPhonePanelRule)
      .toContain('grid-template-rows: 72px minmax(0, 1fr) auto;');

    const containedPanelRule = bookingCss.match(
      /\.booking-contained-dialog\.booking-service-detail-shell > \.booking-dialog-panel \{([^}]*)\}/,
    )?.[1];

    expect(containedPanelRule).toContain('height: 100%;');
    expect(containedPanelRule).toContain('max-height: 100%;');

    const simulatedPhoneShellRule = bookingCss.match(
      /\.booking-preview-overlays\[data-preview-viewport='mobile'\]\s+\.booking-contained-dialog\.booking-service-detail-shell \{([^}]*)\}/,
    )?.[1];

    expect(simulatedPhoneShellRule).toContain('height: 94%;');

    const footerRule = bookingCss.match(
      /\.booking-service-detail-footer \{([^}]*)\}/,
    )?.[1];

    expect(footerRule).toContain('flex: 0 0 auto;');
    expect(footerRule).toContain('border-top: 1px solid var(--booking-border);');

    const actionRules = [...bookingCss.matchAll(/\.booking-detail-actions \{([^}]*)\}/gu)];

    expect(actionRules.length).toBeGreaterThan(0);

    for (const actionRule of actionRules) {
      expect(actionRule[1]).not.toContain('position: sticky;');
    }
  });

  it('gives the Visual Grid featured tile the selected service semantics', async () => {
    const user = userEvent.setup();
    const initialSession: BookingSessionState = {
      selection: {
        serviceId: 'svc-manicure-russian',
        addOnIds: ['addon-french'],
      },
      query: '',
      activeCategory: 'all',
      detailServiceId: null,
      draftAddOnIds: [],
      handoffOpen: false,
    };
    const { container } = render(
      <SessionHarness
        initialSession={initialSession}
        settings={settingsFor('visual_grid')}
      />,
    );

    const featured = container.querySelector<HTMLButtonElement>(
      '.featured-tile[data-selected="true"]',
    );

    expect(featured).not.toBeNull();
    expect(featured).toHaveAttribute('aria-pressed', 'true');
    expect(featured).toHaveAccessibleName(/Russian Manicure.*selected/);
    expect(within(featured as HTMLButtonElement).getByText('Selected')).toBeVisible();

    await user.click(featured as HTMLButtonElement);
    const detail = await screen.findByTestId('service-detail-dialog');
    await user.click(within(detail).getByRole('button', {
      name: 'Remove selected service',
    }));
    const deselectedFeatured = container.querySelector<HTMLButtonElement>('.featured-tile');

    expect(deselectedFeatured).toHaveAttribute('aria-pressed', 'false');
    expect(deselectedFeatured).toHaveAttribute('data-selected', 'false');
  });

  it.each([
    ['svc-manicure-gel', 'Gel Manicure'],
    ['svc-manicure-russian', 'Russian Manicure'],
    ['svc-builder-refill', 'BIAB Refill / Builder Gel Fill'],
    ['svc-combo-gel', 'Gel Manicure + Gel Pedicure'],
  ])('keeps the selected Category Menu name intact for %s', (serviceId, serviceName) => {
    const initialSession: BookingSessionState = {
      selection: { serviceId, addOnIds: [] },
      query: '',
      activeCategory: 'all',
      detailServiceId: null,
      draftAddOnIds: [],
      handoffOpen: false,
    };
    const { container } = render(
      <SessionHarness
        initialSession={initialSession}
        settings={settingsFor('category_menu')}
      />,
    );

    const selectedRow = container.querySelector<HTMLButtonElement>(
      '.category-service-row[data-selected="true"]',
    );
    const serviceNameElement = selectedRow?.querySelector<HTMLElement>(
      '.category-row-service-name',
    );
    const selectedLine = selectedRow?.querySelector<HTMLElement>(
      '.category-row-title + .category-row-selected',
    );

    expect(selectedRow).not.toBeNull();
    expect(selectedRow?.getAttribute('aria-label')).toContain(serviceName);
    expect(selectedRow).toHaveAccessibleName(/selected/i);
    expect(serviceNameElement).toHaveTextContent(serviceName);
    expect(serviceNameElement?.childNodes).toHaveLength(1);
    expect(serviceNameElement?.firstChild?.nodeType).toBe(Node.TEXT_NODE);
    expect(selectedLine).toHaveTextContent('Selected');
  });

  it('spaces Clean List category counts for singular and plural labels', async () => {
    const user = userEvent.setup();
    const fixture = createMenuFixture();
    const { container } = render(
      <SessionHarness
        fixture={fixture}
        settings={settingsFor('clean_list')}
      />,
    );

    const headings = screen.getAllByRole('heading', { level: 2 });
    const manicureCount = fixture.services.filter(service => service.category === 'manicure').length;

    expect(headings.some(heading => heading.textContent === `Manicure · ${manicureCount} services`))
      .toBe(true);
    expect(headings.some(heading => /·\d/.test(heading.textContent ?? '')))
      .toBe(false);

    await user.type(screen.getByRole('searchbox', { name: 'Search services' }), 'Russian Manicure — No Colour');

    expect(container.querySelector('.clean-category-heading'))
      .toHaveTextContent('Manicure · 1 service');
  });

  it('renders deliberate no-image detail fallbacks and the long 100-service menu', async () => {
    const user = userEvent.setup();
    const noImages = createMenuFixture({ imageFixture: 'no_images' });
    const visual = createDefaultBookingPresentationSettings();
    if (visual.layout !== 'visual_grid') {
      throw new Error('Expected Visual Grid defaults.');
    }
    const showingFallbacks = replaceActiveLayoutSettings(visual, {
      ...visual.layoutSettings,
      imageMode: 'show',
    });
    const { unmount } = render(
      <SessionHarness fixture={noImages} settings={showingFallbacks} />,
    );

    expect(screen.getAllByRole('img', {
      name: /No service photo available/,
    })).not.toHaveLength(0);
    expect(screen.getAllByText('Nail service').length).toBeGreaterThan(0);
    expect(screen.queryByText('Isla studio service')).not.toBeInTheDocument();

    const russianAction = screen.getAllByRole('button', {
      name: /View details for Russian Manicure/,
    })[0];
    if (!russianAction) {
      throw new Error('No-image Visual Grid did not render Russian Manicure.');
    }
    await user.click(russianAction);

    expect(within(screen.getByTestId('service-detail-dialog')).getByRole('img', {
      name: 'No service photo available for Russian Manicure',
    })).toBeVisible();

    unmount();

    const stress = createMenuFixture({ menuSize: 'stress_100' });
    const { container } = render(
      <SessionHarness fixture={stress} settings={settingsFor('category_menu')} />,
    );

    expect(container.querySelectorAll('.category-service-row')).toHaveLength(100);
    expect(screen.getByRole('button', {
      name: /The Complete Structured Manicure with Precision Cuticle Care/,
    })).toBeVisible();
  });

  it.each(['hide', 'show', 'auto'] as const)(
    'applies Visual Grid Images: %s coherently to Service Detail',
    async (imageMode) => {
      const user = userEvent.setup();
      const visual = createDefaultBookingPresentationSettings();
      if (visual.layout !== 'visual_grid') {
        throw new Error('Expected Visual Grid defaults.');
      }
      const settings = replaceActiveLayoutSettings(visual, {
        ...visual.layoutSettings,
        imageMode,
      });
      render(<SessionHarness settings={settings} />);
      const russianAction = screen.getAllByRole('button', {
        name: /View details for Russian Manicure/,
      })[0];
      if (!russianAction) {
        throw new Error('Russian Manicure was not rendered.');
      }
      await user.click(russianAction);
      const detail = await screen.findByTestId('service-detail-dialog');
      const body = within(detail).getByTestId('service-detail-scroll-body');

      expect(body).toHaveAttribute('data-image-mode', imageMode);

      if (imageMode === 'hide') {
        expect(body.querySelector('.booking-detail-image-wrap')).not.toBeInTheDocument();
      } else {
        expect(within(body).getByRole('img', {
          name: 'Precision manicure with clean cuticle work',
        })).toBeVisible();
      }
    },
  );
});
