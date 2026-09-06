/**
 * OP-006 — no React key warning from `VisitUs` on a preview render.
 *
 * The arrival notes are three independent owner fields (Parking, Entrance,
 * Transit) that can legitimately carry the same sentence. They used to be
 * keyed by their own text, so identical notes produced duplicate React keys
 * on every render of the onboarding preview. They are keyed by the field they
 * came from now, which is unique by construction.
 */

import { cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getSectionRegistryEntry } from '../../model/section-library/registry';
import type { SitePlanPage } from '../../model/site-plan';
import { initializeStarter } from '../../model/starters';
import type { SectionInstance, SiteBuilderDocument } from '../../model/types';
import { createDemoOnboardingState, DEMO_SITE_CONTENT } from '../model/demo-content';
import { OnboardingSitePreview } from './OnboardingSitePreview';

vi.mock('../../custom-design/integration/CustomDesignAssetProvider', () => ({
  useCustomDesignAssetMap: () => new Map(),
}));

const SHARED_NOTE = 'Ring the bell beside the plant shop.';

function visitUsSection(): SectionInstance {
  const entry = getSectionRegistryEntry('visit_us');
  return {
    id: 'visit-us-notes',
    label: entry.label,
    order: 0,
    sectionType: 'visit_us',
    settings: entry.normalize(entry.defaultSettings()),
    visible: true,
  } as SectionInstance;
}

function renderVisitUs(location: Record<string, string>) {
  const baseState = createDemoOnboardingState();
  const state = {
    ...baseState,
    profile: {
      ...baseState.profile,
      location: { ...baseState.profile.location, ...location },
    },
  };

  const section = visitUsSection();
  const plan: SitePlanPage[] = [{
    id: 'visit-us-page',
    isHome: true,
    label: 'Visit',
    order: 0,
    sections: [{
      attachedToPrevious: false,
      id: section.id,
      injected: false,
      label: section.label,
      section,
      sectionType: section.sectionType,
      surface: getSectionRegistryEntry('visit_us').surface,
    }],
    slug: '',
    visibleInNavigation: true,
  }];

  let documentCounter = 0;
  const starter = initializeStarter('quick_book', {
    idFactory: kind => `visit-us-doc-${kind}-${documentCounter++}`,
  });
  const renderDocument: SiteBuilderDocument = {
    ...starter,
    navigation: { ...starter.navigation, enabled: false, items: [] },
    pages: [{
      ...starter.pages[0]!,
      id: plan[0]!.id,
      isHome: true,
      name: plan[0]!.label,
      order: 0,
      sections: [section],
      slug: plan[0]!.slug,
      visible: true,
      visibleInNavigation: true,
    }],
    siteContent: DEMO_SITE_CONTENT,
  };

  return render(
    <OnboardingSitePreview
      customerPagePlan={plan}
      device="phone"
      document={renderDocument}
      interactionMode="interactive"
      state={state}
    />,
  );
}

describe('VisitUs arrival notes (OP-006)', () => {
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    errorSpy.mockRestore();
    cleanup();
  });

  const keyWarnings = () =>
    errorSpy.mock.calls.filter(call =>
      call.some(argument => typeof argument === 'string' && /\bkey\b/i.test(argument)));

  it('renders distinct arrival notes without a key warning', () => {
    const { container } = renderVisitUs({});

    expect(container.querySelectorAll('.customer-lib-visit-notes li')).toHaveLength(3);
    expect(keyWarnings()).toEqual([]);
  });

  it('renders two identical arrival notes without a duplicate-key warning', () => {
    const { container } = renderVisitUs({
      entranceInstructions: SHARED_NOTE,
      parking: SHARED_NOTE,
    });

    const notes = [...container.querySelectorAll('.customer-lib-visit-notes li')];

    // Both notes survive: the owner set two fields, so two lines are shown.
    expect(notes.map(note => note.textContent)).toEqual([
      SHARED_NOTE,
      SHARED_NOTE,
      'Two minutes from the 501 Queen streetcar.',
    ]);
    expect(keyWarnings()).toEqual([]);
  });
});
