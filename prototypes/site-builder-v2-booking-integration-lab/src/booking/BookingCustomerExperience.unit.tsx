import { render, screen, waitFor, within } from '@testing-library/react';
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
    expect(within(detail).getByRole('checkbox', { name: /French/ })).toBeChecked();
    expect(within(detail).getByRole('button', { name: 'Continue' })).toBeVisible();
    await user.click(within(detail).getByRole('button', { name: 'Keep browsing' }));
    await user.click(within(summary).getByRole('button', { name: 'Continue' }));

    const handoff = screen.getByTestId('booking-handoff-dialog');
    await waitFor(() => expect(handoff).toHaveAttribute('open'));
    expect(handoff).toHaveTextContent('Booking flow continues here');
    expect(handoff).toHaveTextContent('Russian Manicure · 1 hr 45 min · From $80');
    expect(within(handoff).getByLabelText('Future canonical booking flow'))
      .toHaveTextContent('ServiceOptionsTechnicianTimeDetailsPaymentConfirmation');
  });
});

describe('Booking renderer mode and session boundaries', () => {
  it('makes the real customer renderer inert in Edit and never mounts customer dialogs', () => {
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
    expect(customerRegion).toHaveAttribute('inert');
    expect(customerRegion).toHaveAttribute('aria-hidden', 'true');
    expect(editor).toHaveAttribute('data-booking-mode', 'edit');
    expect(screen.queryByTestId('service-detail-dialog')).not.toBeInTheDocument();
    expect(screen.queryByTestId('booking-handoff-dialog')).not.toBeInTheDocument();
    expect(onSessionChange).not.toHaveBeenCalled();
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
