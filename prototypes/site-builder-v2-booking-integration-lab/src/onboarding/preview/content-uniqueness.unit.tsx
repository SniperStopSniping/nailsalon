import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import {
  assertCustomerContentUniqueness,
  HARD_SITE_UNIQUE_CONTENT_KEYS,
  inspectCustomerContentUniqueness,
} from '../../model/content-uniqueness';
import {
  buildWebsiteRecipeDocument,
  getRecipeRequiredToggles,
  WEBSITE_RECIPES,
} from '../../model/section-library/recipes';
import { createDemoOnboardingState, DEMO_SITE_CONTENT } from '../model/demo-content';
import { OnboardingSitePreview } from './OnboardingSitePreview';

vi.mock('../../custom-design/integration/CustomDesignAssetProvider', () => ({
  useCustomDesignAssetMap: () => new Map(),
}));

describe('customer content uniqueness markers', () => {
  it('detects duplicate hard content and one asset crossing media roles', () => {
    const { container } = render(
      <div data-preview-page-id="home">
        <span data-content-key="owner_profile_photo" data-media-id="asset-1" data-media-role="profile" />
        <span data-content-key="owner_profile_photo" data-media-id="asset-1" data-media-role="hero" />
      </div>,
    );

    expect(inspectCustomerContentUniqueness(container)).toEqual([
      {
        count: 2,
        key: 'owner_profile_photo',
        kind: 'site_content',
        pageId: null,
      },
      {
        count: 2,
        key: 'asset-1',
        kind: 'media_role',
        pageId: null,
      },
    ]);
  });

  it.each(WEBSITE_RECIPES.map(recipe => [recipe.id, recipe.name] as const))(
    '%s keeps every rendered page unique',
    (recipeId) => {
      const state = createDemoOnboardingState();
      const recipe = WEBSITE_RECIPES.find(candidate => candidate.id === recipeId)!;
      state.recipe = {
        ...state.recipe,
        ...getRecipeRequiredToggles(recipeId),
        palettePreset: recipe.recommendedPalette as typeof state.recipe.palettePreset,
        starter: recipe.originStarter,
        stylePreset: recipe.recommendedStyle as typeof state.recipe.stylePreset,
      };
      state.profile.logo = {
        altText: 'Distinct wordmark',
        fileName: 'wordmark.png',
        id: `logo-${recipeId}`,
        mimeType: 'image/png',
        previewUrl: '/assets/images/coderabbit-logo-dark.svg',
        source: 'fixture',
      };
      state.profile.profilePhoto = {
        altText: 'Distinct owner portrait',
        fileName: 'owner.jpeg',
        id: `profile-${recipeId}`,
        mimeType: 'image/jpeg',
        previewUrl: '/assets/images/tech-daniela.jpeg',
        source: 'fixture',
      };
      state.profile.about.visibility.profile_photo = true;
      const document = buildWebsiteRecipeDocument(recipeId, {
        siteContent: DEMO_SITE_CONTENT,
      });
      const ownersByKey = new Map<string, Set<string>>();
      const rolesByAsset = new Map<string, Set<string>>();

      for (const page of document.pages) {
        const view = render(
          <OnboardingSitePreview
            document={document}
            initialPageId={page.id}
            interactionMode="interactive"
            label={`${recipe.name} ${page.name}`}
            preserveDocumentPresentation
            state={state}
          />,
        );
        const customerSite = view.container.querySelector<HTMLElement>(
          '.onboarding-site-preview',
        );

        expect(customerSite).not.toBeNull();

        assertCustomerContentUniqueness(customerSite!);

        for (const marker of customerSite!.querySelectorAll<HTMLElement>(
          '[data-content-key][data-content-owner]',
        )) {
          const key = marker.dataset.contentKey;
          const owner = marker.dataset.contentOwner;
          if (!key || !owner) {
            continue;
          }
          const owners = ownersByKey.get(key) ?? new Set<string>();
          owners.add(owner);
          ownersByKey.set(key, owners);
        }
        for (const marker of customerSite!.querySelectorAll<HTMLElement>(
          '[data-media-id][data-media-role]',
        )) {
          const assetId = marker.dataset.mediaId;
          const role = marker.dataset.mediaRole;
          if (!assetId || !role) {
            continue;
          }
          const roles = rolesByAsset.get(assetId) ?? new Set<string>();
          roles.add(role);
          rolesByAsset.set(assetId, roles);
        }
        view.unmount();
      }

      const hardSiteKeys = new Set<string>(HARD_SITE_UNIQUE_CONTENT_KEYS);
      for (const [key, owners] of ownersByKey) {
        if (!hardSiteKeys.has(key)) {
          continue;
        }

        expect(owners.size, `${recipeId} gave ${key} to multiple owners`).toBe(1);
      }
      for (const [assetId, roles] of rolesByAsset) {
        expect(roles.size, `${recipeId} reused ${assetId} as ${[...roles].join(', ')}`)
          .toBe(1);
      }
    },
  );

  it('keeps the Profile photo in About and never rehomes it when About is hidden', () => {
    const state = createDemoOnboardingState();
    state.profile.profilePhoto = {
      altText: 'Distinct owner portrait',
      fileName: 'owner.jpeg',
      id: 'profile-about-owner',
      mimeType: 'image/jpeg',
      previewUrl: '/assets/images/tech-daniela.jpeg',
      source: 'fixture',
    };
    state.profile.about.visibility.profile_photo = true;
    const document = buildWebsiteRecipeDocument('the_collective', {
      siteContent: DEMO_SITE_CONTENT,
    });
    const about = document.pages.flatMap(page => page.sections)
      .find(section => section.sectionType === 'about')!;
    const aboutPage = document.pages.find(page => page.sections.some(
      section => section.sectionType === 'about',
    ))!;
    const homePage = document.pages.find(page => page.isHome)!;

    const visibleView = render(
      <OnboardingSitePreview
        document={document}
        initialPageId={aboutPage.id}
        interactionMode="interactive"
        label="About profile owner"
        preserveDocumentPresentation
        state={state}
      />,
    );

    const profile = visibleView.container.querySelector<HTMLElement>(
      '[data-content-key="owner_profile_photo"]',
    );

    expect(profile).not.toBeNull();
    expect(profile).toHaveAttribute('data-media-id', 'profile-about-owner');
    expect(profile).toHaveAttribute('data-media-role', 'profile');
    expect(profile?.closest('section[aria-label="About"]')).not.toBeNull();
    expect(visibleView.container.querySelectorAll(
      '[data-content-key="owner_profile_photo"]',
    )).toHaveLength(1);
    expect(visibleView.container.querySelector(
      '[data-library-type="hero"] [data-media-role="profile"]',
    )).toBeNull();

    visibleView.unmount();

    about.visible = false;

    const { container } = render(
      <OnboardingSitePreview
        document={document}
        initialPageId={homePage.id}
        interactionMode="interactive"
        label="Hidden About"
        preserveDocumentPresentation
        state={state}
      />,
    );

    expect(container.querySelector('[data-content-key="owner_profile_photo"]')).toBeNull();
    expect(container.querySelector('[data-media-id="profile-about-owner"]')).toBeNull();
    expect(container.querySelector('[data-library-type="hero"] [data-media-role="profile"]'))
      .toBeNull();
  });
});
