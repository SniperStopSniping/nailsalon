import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { createDeterministicIdFactory } from '../../model/ids';
import { SECTION_LIBRARY_REGISTRY } from '../../model/section-library/registry';
import type {
  FinalCtaSettings,
  FooterSettings,
  GallerySectionSettings,
  SectionNavigationSettings,
} from '../../model/section-library/settings';
import { createLibrarySectionInstance, initializeStarter } from '../../model/starters';
import type { SiteBuilderDocument } from '../../model/types';
import { DEMO_SITE_CONTENT, createDemoOnboardingState } from '../../onboarding/model/demo-content';
import { deriveSiteLibraryContext } from '../../onboarding/model/site-library-context';
import type { OnboardingLabState } from '../../onboarding/model/types';
import { FinalCtaEditor } from './final-cta';
import { FooterEditor } from './footer';
import { GallerySectionEditor } from './gallery';
import { SectionNavigationEditor } from './section-navigation';
import type { LibrarySectionEditorProps } from './types';

const buildDocument = (starter: 'one_page' | 'multi_page' = 'one_page'): SiteBuilderDocument => {
  const document = initializeStarter(starter, {
    idFactory: createDeterministicIdFactory(starter),
  });
  return { ...document, siteContent: DEMO_SITE_CONTENT };
};

/** Every editor prop except the two the individual test drives. */
const sharedProps = (
  document: SiteBuilderDocument,
  state: OnboardingLabState = createDemoOnboardingState(),
): Omit<LibrarySectionEditorProps, 'onChange' | 'settings'> => ({
  context: deriveSiteLibraryContext(state, document),
  document,
  onSiteContent: () => true,
  profile: state.profile,
});

const withoutGalleryPhotos = (): OnboardingLabState => {
  const state = createDemoOnboardingState();
  return { ...state, gallery: { ...state.gallery, images: [] } };
};

const findSectionId = (document: SiteBuilderDocument, label: string): string => {
  const section = document.pages
    .flatMap(page => page.sections)
    .find(candidate => candidate.label === label);
  if (!section) throw new Error(`No section labelled ${label} in the test document.`);
  return section.id;
};

/** Two pages that each own a menu — the case where the owning page is unknowable. */
const buildTwoMenuDocument = (): SiteBuilderDocument => {
  const idFactory = createDeterministicIdFactory('two-menus');
  const document = buildDocument('multi_page');
  return {
    ...document,
    pages: document.pages.map((page, index) => (index < 2
      ? {
          ...page,
          sections: [
            createLibrarySectionInstance('section_navigation', idFactory, { order: 0 }),
            ...page.sections.map(section => ({ ...section, order: section.order + 1 })),
          ],
        }
      : page)),
  };
};

describe('GallerySectionEditor', () => {
  const galleryDefaults = (): GallerySectionSettings =>
    SECTION_LIBRARY_REGISTRY.gallery.defaultSettings();

  it('renders the current selection mode and never its own design picker', () => {
    const document = buildDocument();
    render(
      <GallerySectionEditor
        {...sharedProps(document)}
        onChange={vi.fn()}
        settings={galleryDefaults()}
      />,
    );

    expect(screen.getByRole('button', { name: 'All my photos' }))
      .toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Pick specific photos' }))
      .toHaveAttribute('aria-pressed', 'false');
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    expect(screen.queryByText('Design')).not.toBeInTheDocument();
  });

  it('switching to picked selects the photos that are on the site today', async () => {
    const user = userEvent.setup();
    const document = buildDocument();
    const props = sharedProps(document);
    const onChange = vi.fn();
    render(
      <GallerySectionEditor {...props} onChange={onChange} settings={galleryDefaults()} />,
    );

    await user.click(screen.getByRole('button', { name: 'Pick specific photos' }));

    const expected: GallerySectionSettings = {
      preset: 'grid',
      selection: { imageIds: [...props.context.galleryImageIds], mode: 'picked' },
      version: 1,
    };
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(expected);
    expect(SECTION_LIBRARY_REGISTRY.gallery.normalize(expected)).toEqual(expected);
  });

  it('lists picked photos by position and appends a newly picked photo in selection order', async () => {
    const user = userEvent.setup();
    const document = buildDocument();
    const props = sharedProps(document);
    const [firstId, secondId] = props.context.galleryImageIds;
    if (!firstId || !secondId) throw new Error('Demo gallery is missing photos.');
    const onChange = vi.fn();
    render(
      <GallerySectionEditor
        {...props}
        onChange={onChange}
        settings={{
          preset: 'grid',
          selection: { imageIds: [secondId], mode: 'picked' },
          version: 1,
        }}
      />,
    );

    expect(screen.getByRole('checkbox', { name: 'Photo 1' })).not.toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Photo 2' })).toBeChecked();

    await user.click(screen.getByRole('checkbox', { name: 'Photo 1' }));

    const expected: GallerySectionSettings = {
      preset: 'grid',
      selection: { imageIds: [secondId, firstId], mode: 'picked' },
      version: 1,
    };
    expect(onChange).toHaveBeenCalledWith(expected);
    expect(SECTION_LIBRARY_REGISTRY.gallery.normalize(expected)).toEqual(expected);
  });

  it('shows an honest empty hint instead of a picker when there are no photos', () => {
    const document = buildDocument();
    render(
      <GallerySectionEditor
        {...sharedProps(document, withoutGalleryPhotos())}
        onChange={vi.fn()}
        settings={galleryDefaults()}
      />,
    );

    expect(screen.getByText(/No photos in your gallery yet/u)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Pick specific photos' }))
      .not.toBeInTheDocument();
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
  });
});

describe('SectionNavigationEditor', () => {
  const navigationDefaults = (): SectionNavigationSettings =>
    SECTION_LIBRARY_REGISTRY.section_navigation.defaultSettings();

  it('renders the sticky toggle and turns it off with the exact next settings', async () => {
    const user = userEvent.setup();
    const document = buildDocument();
    const onChange = vi.fn();
    render(
      <SectionNavigationEditor
        {...sharedProps(document)}
        onChange={onChange}
        settings={navigationDefaults()}
      />,
    );

    const toggle = screen.getByRole('checkbox', {
      name: /^Keep the menu visible while scrolling/u,
    });
    expect(toggle).toBeChecked();

    await user.click(toggle);

    const expected: SectionNavigationSettings = {
      labelOverrides: {},
      sticky: false,
      version: 1,
    };
    expect(onChange).toHaveBeenCalledWith(expected);
    expect(SECTION_LIBRARY_REGISTRY.section_navigation.normalize(expected)).toEqual(expected);
  });

  it('lists only the anchorable sections of the one page that owns the menu', () => {
    const document = buildDocument();
    render(
      <SectionNavigationEditor
        {...sharedProps(document)}
        onChange={vi.fn()}
        settings={navigationDefaults()}
      />,
    );

    expect(screen.getByLabelText('About')).toHaveValue('');
    expect(screen.getByLabelText('Gallery')).toBeInTheDocument();
    expect(screen.getByLabelText('Booking')).toBeInTheDocument();
    // Chrome the customer menu never links to.
    expect(screen.queryByLabelText('Welcome')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Footer')).not.toBeInTheDocument();
  });

  it('stores a rename under the target section id and clears it when blanked', () => {
    const document = buildDocument();
    const aboutId = findSectionId(document, 'About');
    const onChange = vi.fn();
    const { rerender } = render(
      <SectionNavigationEditor
        {...sharedProps(document)}
        onChange={onChange}
        settings={navigationDefaults()}
      />,
    );

    fireEvent.change(screen.getByLabelText('About'), { target: { value: 'Our studio' } });

    const renamed: SectionNavigationSettings = {
      labelOverrides: { [aboutId]: 'Our studio' },
      sticky: true,
      version: 1,
    };
    expect(onChange).toHaveBeenCalledWith(renamed);
    expect(SECTION_LIBRARY_REGISTRY.section_navigation.normalize(renamed)).toEqual(renamed);

    rerender(
      <SectionNavigationEditor
        {...sharedProps(document)}
        onChange={onChange}
        settings={renamed}
      />,
    );
    expect(screen.getByLabelText('About')).toHaveValue('Our studio');

    fireEvent.change(screen.getByLabelText('About'), { target: { value: '' } });
    expect(onChange).toHaveBeenLastCalledWith({
      labelOverrides: {},
      sticky: true,
      version: 1,
    });
  });

  it('drops the rename fields when the owning page cannot be resolved', () => {
    const document = buildTwoMenuDocument();
    render(
      <SectionNavigationEditor
        {...sharedProps(document)}
        onChange={vi.fn()}
        settings={navigationDefaults()}
      />,
    );

    expect(screen.getByText(/Rename fields appear here when your site has just one/u))
      .toBeInTheDocument();
    expect(screen.queryByLabelText('Gallery')).not.toBeInTheDocument();
    expect(screen.getByRole('checkbox', {
      name: /^Keep the menu visible while scrolling/u,
    })).toBeInTheDocument();
  });
});

describe('FinalCtaEditor', () => {
  const finalCtaDefaults = (): FinalCtaSettings =>
    SECTION_LIBRARY_REGISTRY.final_cta.defaultSettings();

  it('shows the live shared headline while the setting is shared', () => {
    const document = buildDocument();
    render(
      <FinalCtaEditor
        {...sharedProps(document)}
        onChange={vi.fn()}
        settings={finalCtaDefaults()}
      />,
    );

    expect(screen.getByRole('button', { name: 'Use the standard line' }))
      .toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('Currently: “Ready when you are”')).toBeInTheDocument();
    expect(screen.queryByText('Design')).not.toBeInTheDocument();
  });

  it('seeds an override with the shared line without rewriting the shared source', async () => {
    const user = userEvent.setup();
    const document = buildDocument();
    const onChange = vi.fn();
    render(
      <FinalCtaEditor
        {...sharedProps(document)}
        onChange={onChange}
        settings={finalCtaDefaults()}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Write my own' }));

    const expected: FinalCtaSettings = {
      headline: { source: 'override', value: 'Ready when you are' },
      preset: 'simple_banner',
      version: 1,
    };
    expect(onChange).toHaveBeenCalledWith(expected);
    expect(SECTION_LIBRARY_REGISTRY.final_cta.normalize(expected)).toEqual(expected);
  });
});

describe('FooterEditor', () => {
  const footerDefaults = (): FooterSettings =>
    SECTION_LIBRARY_REGISTRY.footer.defaultSettings();

  it('renders the attribution toggle from the current settings', () => {
    const document = buildDocument();
    render(
      <FooterEditor
        {...sharedProps(document)}
        onChange={vi.fn()}
        settings={{ preset: 'compact', showAttribution: false, version: 1 }}
      />,
    );

    expect(screen.getByRole('checkbox', { name: /^Show “Powered by Luster”/u }))
      .not.toBeChecked();
    expect(screen.queryByText('Design')).not.toBeInTheDocument();
  });

  it('turns the attribution off with the exact next settings', async () => {
    const user = userEvent.setup();
    const document = buildDocument();
    const onChange = vi.fn();
    render(
      <FooterEditor
        {...sharedProps(document)}
        onChange={onChange}
        settings={footerDefaults()}
      />,
    );

    await user.click(screen.getByRole('checkbox', { name: /^Show “Powered by Luster”/u }));

    const expected: FooterSettings = {
      preset: 'columns',
      showAttribution: false,
      version: 1,
    };
    expect(onChange).toHaveBeenCalledWith(expected);
    expect(SECTION_LIBRARY_REGISTRY.footer.normalize(expected)).toEqual(expected);
  });
});
