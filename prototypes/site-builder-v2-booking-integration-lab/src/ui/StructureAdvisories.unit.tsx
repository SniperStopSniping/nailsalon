/**
 * The overlap engine has two halves: warnings raised when an owner adds a
 * section, and standing advisories about content that already appears in
 * more than one place. This pins the second half end to end — the engine
 * produces a named advisory for a real document, and the structure panel
 * shows it.
 */

import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { getDocumentOverlapAdvisories } from '../model/section-overlap';
import { createLibrarySectionInstance, initializeStarter } from '../model/starters';
import type { SiteBuilderDocument } from '../model/types';
import { createDemoOnboardingState } from '../onboarding/model/demo-content';
import { deriveSiteLibraryContext } from '../onboarding/model/site-library-context';
import { FinalStructurePanel } from './FinalStructurePanel';

const panelProps = {
  onAddPage: vi.fn(),
  onEditPage: vi.fn(),
  onEnterReorder: vi.fn(),
  onMoveNavigationItem: vi.fn(),
  onMovePage: vi.fn(),
  onRemovePage: vi.fn(),
  onRenameNavigationItem: vi.fn(),
  onRestorePage: vi.fn(),
  onRestoreSection: vi.fn(),
  onSelectPage: vi.fn(),
  onSelectSection: vi.fn(),
  onToggleNavigation: vi.fn(),
  open: true,
  selectedSectionId: null,
};

/** A one-page site whose About repeats the policy summary Policies owns. */
const documentWithDuplicatePolicySummary = (): SiteBuilderDocument => {
  let counter = 0;
  const idFactory = (kind: string) => `advisory-${kind}-${counter++}`;
  const base = initializeStarter('one_page', { idFactory });
  const home = base.pages[0]!;
  return {
    ...base,
    pages: [{
      ...home,
      sections: home.sections.map(section => (section.sectionType === 'about'
        ? createLibrarySectionInstance('about', () => section.id, {
            order: section.order,
            presetId: 'about_before_you_book',
          })
        : section)),
    }],
  };
};

afterEach(() => {
  cleanup();
});

describe('standing overlap advisories', () => {
  it('names the duplicated policy summary and where it already appears', () => {
    const document = documentWithDuplicatePolicySummary();
    const context = deriveSiteLibraryContext(createDemoOnboardingState(), document);
    const advisories = getDocumentOverlapAdvisories(document, context);

    expect(advisories.map(advisory => advisory.id))
      .toContain('about_policy_summary_duplicate');
    const advisory = advisories.find(
      item => item.id === 'about_policy_summary_duplicate',
    )!;
    // Named content, not a generic caution.
    expect(advisory.message).toContain('Before you book');
    expect(advisory.message).toContain('Home');
    expect(advisory.resolutions.map(resolution => resolution.kind))
      .toEqual(['cancel', 'adjust']);
  });

  it('shows those advisories in the structure panel', () => {
    const document = documentWithDuplicatePolicySummary();
    const context = deriveSiteLibraryContext(createDemoOnboardingState(), document);
    const advisories = getDocumentOverlapAdvisories(document, context);

    render(
      <FinalStructurePanel
        {...panelProps}
        activePageId={document.pages[0]!.id}
        advisories={advisories}
        document={document}
      />,
    );

    const group = screen.getByRole('group', { name: 'Things worth a look' });
    expect(within(group).getByText('Policy details appear twice')).toBeInTheDocument();
    expect(within(group).getByText(/Before you book/)).toBeInTheDocument();
  });

  it('shows nothing when the document has no overlapping content', () => {
    let counter = 0;
    const document = initializeStarter('quick_book', {
      idFactory: kind => `clean-${kind}-${counter++}`,
    });
    const context = deriveSiteLibraryContext(createDemoOnboardingState(), document);
    const advisories = getDocumentOverlapAdvisories(document, context);
    expect(advisories).toEqual([]);

    render(
      <FinalStructurePanel
        {...panelProps}
        activePageId={document.pages[0]!.id}
        advisories={advisories}
        document={document}
      />,
    );
    expect(screen.queryByRole('group', { name: 'Things worth a look' }))
      .not.toBeInTheDocument();
  });
});
