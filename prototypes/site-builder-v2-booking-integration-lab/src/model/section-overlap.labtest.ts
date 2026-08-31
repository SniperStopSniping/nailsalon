import { describe, expect, it } from 'vitest';

import { createDemoOnboardingState } from '../onboarding/model/demo-content';
import { deriveSiteLibraryContext } from '../onboarding/model/site-library-context';
import {
  applyHistoryCommand,
  createHistoryState,
  undoHistory,
} from './history';
import { updateLibrarySectionSettings } from './operations';
import { isLibrarySection } from './section-library/registry';
import {
  getAddSectionBlocker,
  getAddSectionWarnings,
  getDocumentOverlapAdvisories,
} from './section-overlap';
import { initializeStarter } from './starters';

describe('section overlap resolutions', () => {
  it('points hard limits and recommended duplicates at the exact existing section', () => {
    const document = initializeStarter('one_page');
    const home = document.pages[0]!;
    const hero = home.sections.find(section => section.sectionType === 'hero')!;
    const context = deriveSiteLibraryContext(createDemoOnboardingState(), document);

    const blocker = getAddSectionBlocker(document, home.id, 'hero');

    expect(blocker?.message).toContain('Home');
    expect(blocker?.resolutions).toContainEqual({
      id: 'go_existing',
      kind: 'navigate',
      label: 'Go to Hero',
      target: { pageId: home.id, sectionId: hero.id },
    });

    for (const type of [
      'announcement_bar',
      'footer',
      'section_navigation',
    ] as const) {
      const existing = home.sections.find(section => section.sectionType === type)!;

      expect(getAddSectionBlocker(document, home.id, type)?.resolutions)
        .toContainEqual(expect.objectContaining({
          id: 'go_existing',
          target: { pageId: home.id, sectionId: existing.id },
        }));
    }
    const booking = home.sections.find(section => section.sectionType === 'booking')!;

    expect(getAddSectionBlocker(document, home.id, 'booking')?.resolutions)
      .toContainEqual(expect.objectContaining({
        id: 'go_existing',
        target: { pageId: home.id, sectionId: booking.id },
      }));

    const about = home.sections.find(section => section.sectionType === 'about')!;

    expect(getAddSectionBlocker(document, home.id, 'about')).toBeNull();

    const duplicate = getAddSectionWarnings(
      document,
      home.id,
      'about',
      context,
      home.sections.length + 1,
    ).find(warning => warning.id === 'duplicate_about');

    expect(duplicate?.resolutions).toContainEqual({
      id: 'go_existing',
      kind: 'navigate',
      label: 'Go to existing About',
      target: { pageId: home.id, sectionId: about.id },
    });
  });

  it('offers Visit Us adjustments with exact targets for Hours and Contact', () => {
    const document = initializeStarter('one_page');
    const home = document.pages[0]!;
    const visitUs = home.sections.find(section => section.sectionType === 'visit_us')!;
    const context = deriveSiteLibraryContext(createDemoOnboardingState(), document);

    for (const type of ['hours', 'contact'] as const) {
      const warning = getAddSectionWarnings(
        document,
        home.id,
        type,
        context,
        home.sections.length + 1,
      ).find(candidate => candidate.id === `${type}_inside_visit_us`);

      expect(warning?.resolutions.find(resolution => resolution.id === 'move_out'))
        .toMatchObject({
          kind: 'adjust',
          target: { pageId: home.id, sectionId: visitUs.id },
        });
    }
  });

  it('warns about Featured Services only at an insertion adjacent to Booking', () => {
    const document = initializeStarter('quick_book');
    const home = document.pages[0]!;
    const context = deriveSiteLibraryContext(createDemoOnboardingState(), document);

    const away = getAddSectionWarnings(
      document,
      home.id,
      'featured_services',
      context,
      1,
    );
    const beside = getAddSectionWarnings(
      document,
      home.id,
      'featured_services',
      context,
      4,
    );

    expect(away.map(warning => warning.id)).not.toContain('featured_beside_full_menu');
    expect(beside.map(warning => warning.id)).toContain('featured_beside_full_menu');
    expect(beside.find(warning => warning.id === 'featured_beside_full_menu')
      ?.resolutions.map(resolution => resolution.label))
      .toEqual(['Keep both (separate them later)', 'Move Featured Services', 'Cancel']);
  });

  it('keeps Team, CTA-density, and policy-summary choices specific and actionable', () => {
    const document = initializeStarter('one_page');
    const home = document.pages[0]!;
    const context = deriveSiteLibraryContext(createDemoOnboardingState(), document);

    const team = getAddSectionWarnings(
      document,
      home.id,
      'team',
      { ...context, businessStructure: 'solo' },
      home.sections.length + 1,
    ).find(warning => warning.id === 'team_on_solo_business');

    expect(team?.resolutions.map(resolution => resolution.label))
      .toEqual(['Add Team anyway', 'Change business setup', 'Cancel']);

    const cta = getAddSectionWarnings(
      document,
      home.id,
      'final_cta',
      context,
      home.sections.length + 1,
    ).find(warning => warning.id === 'cta_density');

    expect(cta?.message).toContain('3 booking actions');
    expect(cta?.resolutions.map(resolution => resolution.label))
      .toEqual(['Add it anyway', 'Cancel']);

    const about = home.sections.find(section => section.sectionType === 'about')!;
    const withPolicyAbout = updateLibrarySectionSettings(document, about.id, {
      ...('settings' in about ? about.settings : {}),
      preset: 'about_before_you_book',
      version: 1,
    });
    const advisory = getDocumentOverlapAdvisories(withPolicyAbout, context)
      .find(warning => warning.id === 'about_policy_summary_duplicate');

    expect(advisory?.resolutions).toEqual([
      { id: 'keep', kind: 'cancel', label: 'Keep the compact summary' },
      {
        id: 'switch_preset',
        kind: 'adjust',
        label: 'Switch About to a design without policies',
        target: { pageId: home.id, sectionId: about.id },
      },
    ]);
  });

  it('applies a Visit Us adjustment and add as one undoable history command', () => {
    const document = initializeStarter('one_page');
    const home = document.pages[0]!;
    const visitUs = home.sections.find(section => section.sectionType === 'visit_us')!;
    if (!isLibrarySection(visitUs) || visitUs.sectionType !== 'visit_us') {
      throw new Error('One-page starter did not contain Visit Us.');
    }

    const next = applyHistoryCommand(
      createHistoryState(document),
      {
        type: 'add_library_section_with_adjustment',
        adjustment: {
          sectionId: visitUs.id,
          settings: { ...visitUs.settings, hoursSummary: 'hide' },
        },
        input: {
          pageId: home.id,
          position: home.sections.length + 1,
          sectionType: 'hours',
        },
      },
      { idFactory: kind => `overlap-${kind}` },
    );

    expect(next.past).toHaveLength(1);

    const adjustedVisit = next.present.pages[0]?.sections.find(
      section => section.id === visitUs.id,
    );

    expect(isLibrarySection(adjustedVisit!)
      && adjustedVisit.sectionType === 'visit_us'
      && adjustedVisit.settings.hoursSummary).toBe('hide');
    expect(next.present.pages[0]?.sections.some(
      section => section.sectionType === 'hours',
    )).toBe(true);
    expect(undoHistory(next).present).toEqual(document);
  });
});
