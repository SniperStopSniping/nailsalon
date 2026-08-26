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
    expect(await within(detail).findByRole('heading', {
      name: 'Russian Manicure',
    })).toBeVisible();
    const french = within(detail).getByRole('checkbox', { name: /French/ });
    await user.click(french);
    expect(french).toBeChecked();
    expect(within(detail).getByTestId('service-detail-total'))
      .toHaveTextContent('1 hr 45 min·From $80');
    await user.click(within(detail).getByRole('button', {
      name: 'Select service',
    }));

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
    expect(within(handoff).getByLabelText('Future canonical booking flow'))
      .toHaveTextContent('ServiceOptionsTechnicianTimeDetailsPaymentConfirmation');
  });

  it('saves or explicitly discards every Change options draft', async () => {
    const user = userEvent.setup();
    const committedFrench: BookingSessionState = {
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

    let detail = await openOptions();
    await toggleFrench(detail);
    expect(within(detail).getByTestId('service-detail-total'))
      .toHaveTextContent('1 hr 30 min·From $65');
    expect(summary).toHaveTextContent('1 hr 45 min · From $80');
    await user.click(within(detail).getByRole('button', { name: 'Keep browsing' }));
    expect(summary).toHaveTextContent('1 hr 30 min · From $65');
    expect(readSession().selection.addOnIds).toEqual([]);

    detail = await openOptions();
    await toggleFrench(detail);
    const close = within(detail).getByRole('button', { name: 'Close service details' });
    await user.click(close);
    let warning = await screen.findByRole('dialog', { name: 'Save your option changes?' });
    expect(detail).toHaveAttribute('aria-hidden', 'true');
    expect(detail).toHaveAttribute('inert');
    await waitFor(() => {
      expect(within(warning).getByRole('button', { name: 'Discard changes' }))
        .toHaveFocus();
    });
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: 'Save your option changes?' }))
      .not.toBeInTheDocument();
    expect(detail).not.toHaveAttribute('aria-hidden');
    expect(detail).not.toHaveAttribute('inert');
    await waitFor(() => expect(close).toHaveFocus());

    fireEvent.mouseDown(screen.getByTestId('service-detail-dialog-backdrop'));
    warning = await screen.findByRole('dialog', { name: 'Save your option changes?' });
    fireEvent.mouseDown(screen.getByTestId('booking-option-warning-dialog-backdrop'));
    expect(screen.queryByRole('dialog', { name: 'Save your option changes?' }))
      .not.toBeInTheDocument();
    expect(detail).toBeVisible();

    await user.keyboard('{Escape}');
    warning = await screen.findByRole('dialog', { name: 'Save your option changes?' });
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

    detail = await openOptions();
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
      name: 'Booking menu preview — 24 services, Visual Grid. Not interactive while editing.',
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
    expect(editor.querySelector('input[placeholder="Search services"]'))
      .toHaveAttribute('aria-hidden', 'true');
    expect(editor.querySelector('input[placeholder="Search services"]'))
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
    if (!customerRegion) throw new Error(`${layout} did not render its customer region.`);
    expect(customerRegion).toHaveAccessibleName(
      `Booking menu preview — 24 services, ${LAYOUT_LABELS[layout]}. Not interactive while editing.`,
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

    expect(screen.getByTestId('booking-section-edit').querySelector('input[placeholder="Search services"]'))
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

      await user.clear(search);
      expect(screen.queryByRole('button', { name: /Russian Manicure/ }))
        .not.toBeInTheDocument();
      if (layout === 'category_menu') {
        expect(container.querySelector('.category-sidebar-button.is-active'))
          .toHaveTextContent('Pedicure');
      } else {
        expect(container.querySelector('.booking-category-pill.is-active'))
          .toHaveTextContent('Pedicure');
      }
    },
  );

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
    expect(headings.some(heading => heading.textContent === 'Manicure · 3 services'))
      .toBe(true);
    expect(headings.some(heading => /·\d/.test(heading.textContent ?? '')))
      .toBe(false);

    await user.type(screen.getByRole('searchbox', { name: 'Search services' }), 'Russian');
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
});
