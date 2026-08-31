/**
 * The settings dialog is where an owner finds out whether a section is on
 * their site. Readiness answers for the section's own content, but some
 * sections are dropped for reasons a single section cannot see — an anchor
 * menu with too few places to go, a page that publishes nothing — and a
 * section that silently disappears while its editor says nothing is the
 * worst of both. This pins that the dialog says so.
 */

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { createDeterministicIdFactory } from '../../model/ids';
import {
  getSectionRegistryEntry,
  isLibrarySection,
} from '../../model/section-library/registry';
import { createLibrarySectionInstance, initializeStarter } from '../../model/starters';
import type {
  LibrarySectionInstance,
  SectionInstance,
  SiteBuilderDocument,
} from '../../model/types';
import { createDefaultOnboardingState } from '../../onboarding/model/defaults';
import { DEMO_SITE_CONTENT } from '../../onboarding/model/demo-content';
import {
  deriveSiteLibraryContext,
  deriveSitePlanToggles,
} from '../../onboarding/model/site-library-context';
import { LibrarySectionSettingsDialog } from './LibrarySectionSettingsDialog';

/*
 * A studio that has published nothing but its records. Injected sections —
 * About, Contact — are navigable targets of their own and would decide the
 * outcome instead of the page composition this is meant to test.
 */
const state = createDefaultOnboardingState();
state.profile.businessName = 'Isla Nail Studio';
state.recipe.aboutEnabled = false;
state.recipe.galleryEnabled = false;
state.recipe.policiesEnabled = false;

/** A page carrying an anchor menu above `targets` navigable sections. */
const documentWithNavigation = (
  targets: readonly ('reviews' | 'team')[],
): SiteBuilderDocument => {
  const idFactory = createDeterministicIdFactory('nav-honesty');
  const base = initializeStarter('one_page', { idFactory });
  const home = base.pages[0]!;
  const navigation = createLibrarySectionInstance(
    'section_navigation',
    () => 'nav-under-test',
    { order: 0 },
  );
  const sections: SectionInstance[] = [
    navigation,
    ...targets.map((type, index) => {
      const section = createLibrarySectionInstance(
        type,
        () => `target-${type}`,
        { order: index + 1 },
      );
      // Bind the records, or the target gates away on readiness and the menu
      // would be dropped for the wrong reason.
      const bound = type === 'reviews'
        ? { reviewIds: DEMO_SITE_CONTENT.reviews.map(review => review.id) }
        : { memberIds: DEMO_SITE_CONTENT.staff.map(member => member.id) };
      return {
        ...section,
        settings: { ...getSectionRegistryEntry(type).defaultSettings(), ...bound },
      } as SectionInstance;
    }),
  ];
  return {
    ...base,
    pages: [{ ...home, sections }],
    siteContent: DEMO_SITE_CONTENT,
  };
};

/** The menu under test, narrowed the way the dialog's own caller does. */
const navigationOf = (document: SiteBuilderDocument): LibrarySectionInstance => {
  const section = document.pages
    .flatMap(page => page.sections)
    .find(candidate => candidate.id === 'nav-under-test');
  if (!section || !isLibrarySection(section)) throw new Error('menu missing');
  return section;
};

const renderDialog = (document: SiteBuilderDocument, section: LibrarySectionInstance) => render(
  <LibrarySectionSettingsDialog
    context={deriveSiteLibraryContext(state, document)}
    document={document}
    onClose={() => {}}
    onSave={() => {}}
    onSiteContent={() => true}
    profile={state.profile}
    section={section}
    toggles={deriveSitePlanToggles(state)}
  />,
);

afterEach(() => {
  cleanup();
});

describe('settings dialog tells the truth about what publishes', () => {
  it('says an anchor menu is not live when it has too few places to go', () => {
    const document = documentWithNavigation(['reviews']);
    renderDialog(document, navigationOf(document));

    expect(screen.getByRole('status'))
      .toHaveTextContent(/at least two sections on this page/iu);
  });

  it('says nothing once the menu has somewhere to point', () => {
    const document = documentWithNavigation(['reviews', 'team']);
    renderDialog(document, navigationOf(document));

    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });
});
