import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';

import { BookingSectionRenderer } from './BookingSectionRenderer';
import { BookingSettingsPanel } from './SettingsPanel';
import { createEmptyBookingSession, createMenuFixture } from './helpers';
import {
  createDefaultBookingPresentationSettings,
  replaceActiveLayoutSettings,
  switchBookingLayout,
} from './presentation';
import type {
  BookingMenuLayout,
  BookingSessionState,
  BookingSectionPresentationSettings,
  MockMenuFixture,
} from './types';

function RendererHarness({
  fixture,
  initialSettings = createDefaultBookingPresentationSettings(),
  mode = 'preview',
}: {
  fixture?: MockMenuFixture;
  initialSettings?: BookingSectionPresentationSettings;
  mode?: 'edit' | 'preview';
}) {
  const [session, setSession] = useState<BookingSessionState>(
    createEmptyBookingSession,
  );
  return (
    <BookingSectionRenderer
      fixture={fixture}
      mode={mode}
      presentationSettings={initialSettings}
      session={session}
      onSessionChange={setSession}
    />
  );
}

function SettingsHarness() {
  const [settings, setSettings] = useState(
    createDefaultBookingPresentationSettings,
  );
  return <BookingSettingsPanel settings={settings} onChange={setSettings} />;
}

describe('shared Booking Section renderer', () => {
  it('renders each approved layout through one active dispatcher', () => {
    const labels: Record<BookingMenuLayout, string> = {
      visual_grid: 'Visual service grid',
      clean_list: 'Clean service list',
      editorial_cards: 'Editorial service stories',
      category_menu: 'Category service menu',
      editorial_price_list: 'Editorial service price list',
    };
    let settings = createDefaultBookingPresentationSettings();
    const { rerender } = render(
      <RendererHarness initialSettings={settings} />,
    );

    for (const layout of Object.keys(labels) as BookingMenuLayout[]) {
      settings = switchBookingLayout(settings, layout);
      rerender(<RendererHarness initialSettings={settings} />);
      expect(screen.getByRole('region', { name: labels[layout] })).toBeVisible();
    }
  });

  it('makes customer controls inert in Edit mode', () => {
    render(<RendererHarness mode="edit" />);
    const region = screen.getByTestId('booking-section-edit')
      .querySelector('.booking-customer-region');
    expect(region).toHaveAttribute('inert');
    expect(region).toHaveAttribute('aria-hidden', 'true');
    expect(screen.queryByTestId('service-detail-dialog')).not.toBeInTheDocument();
  });

  it('shares Service Detail, add-ons, selection summary, and mock handoff', async () => {
    const user = userEvent.setup();
    render(<RendererHarness />);

    const russianAction = screen.getAllByRole('button', {
      name: /View details for Russian Manicure/,
    })[0];
    if (!russianAction) {
      throw new Error('Russian Manicure action was not rendered.');
    }
    await user.click(russianAction);

    const detail = await screen.findByTestId('service-detail-dialog');
    expect(within(detail).getByRole('heading', { name: 'Russian Manicure' })).toBeVisible();
    await user.click(within(detail).getByRole('checkbox', { name: /French/ }));
    expect(within(detail).getByTestId('service-detail-total')).toHaveTextContent(
      '1 hr 45 min·From $80',
    );
    await user.click(within(detail).getByRole('button', { name: 'Select service' }));

    const summary = await screen.findByTestId('selected-service-summary');
    expect(summary).toHaveTextContent('Russian Manicure');
    expect(summary).toHaveTextContent('1 hr 45 min · From $80');
    await user.click(within(summary).getByRole('button', { name: 'Continue' }));
    expect(await screen.findByTestId('booking-handoff-dialog')).toHaveTextContent(
      'Booking flow continues here',
    );
  });

  it('renders deliberate image fallbacks and the deterministic 100-service menu', () => {
    const noImages = createMenuFixture({ imageFixture: 'no_images' });
    const visual = createDefaultBookingPresentationSettings();
    if (visual.layout !== 'visual_grid') {
      throw new Error('Expected Visual Grid defaults.');
    }
    const showFallbacks = replaceActiveLayoutSettings(visual, {
      ...visual.layoutSettings,
      imageMode: 'show',
    });
    const { unmount } = render(
      <RendererHarness fixture={noImages} initialSettings={showFallbacks} />,
    );
    expect(screen.getAllByRole('img', { name: /No service photo available/ }).length)
      .toBeGreaterThan(0);
    unmount();

    const stress = createMenuFixture({ menuSize: 'stress_100' });
    const categorySettings = switchBookingLayout(
      createDefaultBookingPresentationSettings(),
      'category_menu',
    );
    const { container } = render(
      <RendererHarness fixture={stress} initialSettings={categorySettings} />,
    );
    expect(container.querySelectorAll('.category-service-row')).toHaveLength(100);
  });
});

describe('Booking owner settings', () => {
  it('keeps the chooser open and reveals only compatible controls', () => {
    const { container } = render(<SettingsHarness />);
    expect(screen.getByRole('heading', { name: 'Booking' })).toBeVisible();
    expect(screen.getByText('Photos recommended')).toBeVisible();
    expect(screen.getByText('Featured services')).toBeVisible();
    expect(screen.queryByText('Tiny thumbnails')).not.toBeInTheDocument();

    const listOption = container.querySelector<HTMLButtonElement>(
      '[data-layout-option="clean_list"]',
    );
    if (!listOption) {
      throw new Error('Clean List layout option was not rendered.');
    }
    fireEvent.click(listOption);
    expect(screen.getByTestId('booking-settings-panel')).toBeVisible();
    expect(screen.getByText('Tiny thumbnails')).toBeVisible();
    expect(screen.queryByText('Featured services')).not.toBeInTheDocument();
  });
});
