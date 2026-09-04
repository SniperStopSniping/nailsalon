import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';

import { createDefaultCustomDesignSettings } from '../../custom-design/model/settings';
import type { CustomDesignDisplayMode } from '../../custom-design/model/types';
import { initializeStarter } from '../../model';
import type { CustomDesignSectionInstance } from '../../model/types';
import { OnboardingCustomDesignSections } from './OnboardingCustomDesignSections';

vi.mock('../../custom-design/integration/CustomDesignAssetProvider', () => ({
  useCustomDesignAssetMap: (assetIds: readonly string[]) => new Map(
    assetIds.map(assetId => [assetId, {
      original: { assetId, kind: 'original', status: 'ready', url: `blob:${assetId}` },
      thumbnail: { assetId, kind: 'thumbnail', status: 'ready', url: `blob:thumb-${assetId}` },
    }]),
  ),
}));

const makeSection = (
  displayMode: CustomDesignDisplayMode,
  order: number,
): CustomDesignSectionInstance => ({
  id: `section-${displayMode}`,
  label: `${displayMode} Canva design`,
  order,
  sectionType: 'custom_design',
  settings: {
    ...createDefaultCustomDesignSettings(),
    displayMode,
    images: [{
      altText: '',
      aspectRatio: 0.75,
      assetId: `asset-${displayMode}`,
      decorative: true,
      fileName: `${displayMode}.png`,
      fileSize: 10,
      height: 1_600,
      id: `image-${displayMode}`,
      interactiveAreas: [],
      mimeType: 'image/png',
      width: 1_200,
    }],
  },
  visible: true,
});

describe('OnboardingCustomDesignSections', () => {
  it('uses the final customer renderer with distinct Poster, Contained, and Full width modes', () => {
    const siteDocument = initializeStarter('quick_book');
    const page = siteDocument.pages[0]!;
    page.sections.push(
      makeSection('poster', 10),
      makeSection('contained', 11),
      makeSection('full_width', 12),
    );

    const view = render(
      <OnboardingCustomDesignSections
        document={siteDocument}
        onDocumentTarget={vi.fn()}
        pageId={page.id}
      />,
    );

    for (const mode of ['poster', 'contained', 'full_width'] as const) {
      const wrapper = view.container.querySelector(
        `[data-onboarding-custom-design-mode="${mode}"]`,
      );

      expect(wrapper).not.toBeNull();

      const renderer = wrapper!.querySelector<HTMLElement>(
        '[data-testid="custom-design-customer-renderer"]',
      );

      expect(renderer).toHaveAttribute('data-display-mode', mode);
      expect(renderer?.style.getPropertyValue('--custom-design-content-max-width'))
        .toBe('calc(100% - clamp(32px, 10cqw, 112px))');
    }

    expect(screen.getAllByTestId('custom-design-customer-renderer')).toHaveLength(3);
  });

  it('hands validated Booking actions to the preview host instead of following fallback hashes', async () => {
    const user = userEvent.setup();
    const siteDocument = initializeStarter('quick_book');
    const page = siteDocument.pages[0]!;
    const booking = page.sections.find(section => section.sectionType === 'booking')!;
    const section = makeSection('contained', booking.order - 0.5);
    section.settings.cta = {
      label: 'Book now',
      placement: { type: 'after_all' },
      type: 'book_now',
    };
    page.sections.push(section);
    const onDocumentTarget = vi.fn();
    window.location.hash = '#stay-in-preview';

    const view = render(
      <OnboardingCustomDesignSections
        document={siteDocument}
        onDocumentTarget={onDocumentTarget}
        pageId={page.id}
      />,
    );
    const wrapper = view.container.querySelector<HTMLElement>(
      `[data-onboarding-custom-design-section="${section.id}"]`,
    );

    expect(wrapper).not.toBeNull();

    await user.click(within(wrapper!).getByRole('button', { name: 'Book now' }));

    expect(onDocumentTarget).toHaveBeenCalledWith({
      kind: 'booking',
      pageId: page.id,
      relationship: 'same_page',
      sectionId: booking.id,
    });
    expect(window.location.hash).toBe('#stay-in-preview');
  });
});
