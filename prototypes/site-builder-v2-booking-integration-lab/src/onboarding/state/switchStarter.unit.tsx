import { act, renderHook, waitFor } from '@testing-library/react';

import { createDefaultCustomDesignSettings } from '../../custom-design/model/settings';
import type { CustomDesignImageItem } from '../../custom-design/model/types';
import {
  type CustomDesignSectionInstance,
  parseSiteBuilderDocument,
  SITE_BUILDER_STORAGE_KEY,
  type SiteBuilderDocument,
} from '../../model';
import { useLabDocument } from '../../ui/useLabDocument';
import { getCanvaPlacementTarget } from '../extras/useCanvaIntegration';
import { createDefaultOnboardingState } from '../model/defaults';
import type { OnboardingLabState, StarterId } from '../model/types';
import { switchOnboardingStarter } from './switchStarter';

const canvaImage: CustomDesignImageItem = {
  altText: 'Uploaded Canva page',
  aspectRatio: 0.75,
  assetId: 'asset-onboarding-canva',
  decorative: false,
  fileName: 'isla-canva.png',
  fileSize: 4_096,
  height: 1_600,
  id: 'image-onboarding-canva',
  interactiveAreas: [],
  mimeType: 'image/png',
  width: 1_200,
};

const getCustomDesigns = (
  document: SiteBuilderDocument,
): CustomDesignSectionInstance[] => document.pages.flatMap(page =>
  page.sections.filter(
    (section): section is CustomDesignSectionInstance =>
      section.sectionType === 'custom_design',
  ));

const expectStarterShape = (
  document: SiteBuilderDocument,
  starter: StarterId,
) => {
  // Custom Design is an owner-added integration section. The remaining
  // topology must exactly match the locked V1 release recipe after every
  // starter switch.
  const expected = {
    multi_page: {
      names: ['Home', 'Services & Booking', 'Gallery', 'About', 'Contact'],
      sections: [
        ['hero', 'reviews'],
        ['booking', 'policies'],
        ['gallery'],
        ['about'],
        ['visit_us'],
      ],
    },
    one_page: {
      names: ['Home'],
      sections: [[
        'hero',
        'gallery',
        'about',
        'booking',
        'reviews',
        'policies',
        'visit_us',
      ]],
    },
    quick_book: {
      names: ['Home'],
      sections: [[
        'hero',
        'booking',
        'gallery',
        'visit_us',
      ]],
    },
  }[starter];

  expect(document.originStarter).toBe(starter);
  expect(document.pages.map(page => page.name)).toEqual(expected.names);
  expect(document.pages.map(page => page.sections
    .filter(section => section.sectionType !== 'custom_design')
    .map(section => section.sectionType)))
    .toEqual(expected.sections);
};

const createState = (): OnboardingLabState => {
  const state = createDefaultOnboardingState();
  state.profile.businessName = 'Isla Nail Studio';
  state.profile.ownerName = 'Daniela';
  state.profile.about.shortBio = 'A carefully preserved profile.';
  state.recipe.starter = 'quick_book';
  return state;
};

const addConfirmedCanva = (
  lab: ReturnType<typeof useLabDocument>,
  state: OnboardingLabState,
) => {
  const document = lab.getHistorySnapshot()?.present;

  expect(document).toBeDefined();

  const target = document
    ? getCanvaPlacementTarget(document, 'before_booking')
    : null;

  expect(target).not.toBeNull();

  if (!target || !document) {
    throw new Error('Missing Booking target.');
  }

  const existingIds = new Set(
    document.pages.flatMap(page => page.sections.map(section => section.id)),
  );
  const added = lab.runCommand({
    input: {
      pageId: target.pageId,
      position: target.position,
      sectionType: 'custom_design',
    },
    type: 'add_section',
  });

  expect(added.success).toBe(true);

  if (!added.success) {
    throw new Error(added.message);
  }
  const section = getCustomDesigns(added.document).find(
    candidate => !existingIds.has(candidate.id),
  );

  expect(section).toBeDefined();

  if (!section) {
    throw new Error('Custom Design was not created.');
  }

  const updated = lab.runCommand({
    sectionId: section.id,
    settings: {
      ...createDefaultCustomDesignSettings(),
      displayMode: 'poster',
      images: [canvaImage],
    },
    type: 'update_custom_design_settings',
  });

  expect(updated.success).toBe(true);

  state.canva.customDesignSectionId = section.id;
  state.canva.displayMode = 'poster';
  state.canva.images = [{
    fileName: canvaImage.fileName,
    id: canvaImage.id,
    mimeType: canvaImage.mimeType,
    source: 'indexed_db',
    storageId: canvaImage.assetId,
  }];
  state.canva.placement = 'before_booking';
  state.canva.status = 'ready';
  state.recipe.canvaEnabled = true;
};

const runStarterSwitch = (
  lab: ReturnType<typeof useLabDocument>,
  state: OnboardingLabState,
  starter: StarterId,
): ReturnType<typeof switchOnboardingStarter> => {
  let result: ReturnType<typeof switchOnboardingStarter> | undefined;
  act(() => {
    result = switchOnboardingStarter(lab, state, starter);
  });
  if (!result) {
    throw new Error('The starter switch did not return a result.');
  }
  return result;
};

describe('switchOnboardingStarter', () => {
  beforeEach(() => {
    window.localStorage.removeItem(SITE_BUILDER_STORAGE_KEY);
  });

  it('switches across every starter without duplicating or losing confirmed Canva assets', () => {
    const hook = renderHook(() => useLabDocument());
    const state = createState();
    const profileSnapshot = structuredClone(state.profile);

    act(() => {
      const created = hook.result.current.createStarterOnce('quick_book', {
        siteName: state.profile.businessName,
      });

      expect(created.success).toBe(true);

      if (created.success) {
        state.recipe.starterDocumentSiteId = created.document.siteId;
      }
      addConfirmedCanva(hook.result.current, state);
    });

    const canvaImagesSnapshot = structuredClone(state.canva.images);
    const seenSectionIds = new Set([state.canva.customDesignSectionId]);
    const targets: StarterId[] = [
      'one_page',
      'quick_book',
      'multi_page',
      'one_page',
      'quick_book',
    ];
    for (const target of targets) {
      const switched = runStarterSwitch(hook.result.current, state, target);

      expect(switched).toMatchObject({ changed: true, success: true });

      if (!switched.success) {
        throw new Error(switched.message);
      }

      state.recipe.starter = target;
      state.recipe.starterDocumentSiteId = switched.document.siteId;
      state.canva.customDesignSectionId = switched.customDesignSectionId;
      expectStarterShape(switched.document, target);

      expect(switched.document.siteName).toBe('Isla Nail Studio');
      expect(getCustomDesigns(switched.document)).toEqual([
        expect.objectContaining({
          id: switched.customDesignSectionId,
          settings: expect.objectContaining({
            displayMode: 'poster',
            images: [expect.objectContaining({
              assetId: canvaImage.assetId,
              id: canvaImage.id,
            })],
          }),
        }),
      ]);
      expect(state.profile).toEqual(profileSnapshot);
      expect(state.canva.images).toEqual(canvaImagesSnapshot);
      expect(seenSectionIds.has(switched.customDesignSectionId)).toBe(false);

      seenSectionIds.add(switched.customDesignSectionId);
    }

    const sectionIdBeforeRepeat = state.canva.customDesignSectionId;
    const repeated = runStarterSwitch(
      hook.result.current,
      state,
      'quick_book',
    );

    expect(repeated).toMatchObject({
      changed: false,
      customDesignSectionId: sectionIdBeforeRepeat,
      success: true,
    });

    if (!repeated.success) {
      throw new Error(repeated.message);
    }

    expect(getCustomDesigns(repeated.document)).toHaveLength(1);
  });

  it('reloads the final switched starter with exactly one reference to each saved asset', async () => {
    const hook = renderHook(() => useLabDocument());
    const state = createState();

    act(() => {
      const created = hook.result.current.createStarterOnce('quick_book', {
        siteName: state.profile.businessName,
      });

      expect(created.success).toBe(true);

      addConfirmedCanva(hook.result.current, state);
    });

    const switched = runStarterSwitch(
      hook.result.current,
      state,
      'multi_page',
    );

    expect(switched.success).toBe(true);

    await waitFor(() => {
      const saved = window.localStorage.getItem(SITE_BUILDER_STORAGE_KEY);

      expect(saved).not.toBeNull();

      const parsed = parseSiteBuilderDocument(saved ?? '');

      expect(parsed.success).toBe(true);

      if (!parsed.success) {
        return;
      }
      expectStarterShape(parsed.document, 'multi_page');

      expect(getCustomDesigns(parsed.document)).toHaveLength(1);
      expect(getCustomDesigns(parsed.document)[0]?.settings.images.map(
        image => image.assetId,
      )).toEqual([canvaImage.assetId]);
    });

    hook.unmount();
    const reloaded = renderHook(() => useLabDocument());

    expect(reloaded.result.current.document).not.toBeNull();

    if (!reloaded.result.current.document) {
      return;
    }
    expectStarterShape(reloaded.result.current.document, 'multi_page');

    expect(getCustomDesigns(reloaded.result.current.document)).toHaveLength(1);
    expect(reloaded.result.current.getReachableAssetIds())
      .toEqual(new Set([canvaImage.assetId]));
  });

  it('publishes a starter replacement as one undoable document transition', () => {
    const hook = renderHook(() => useLabDocument());
    const state = createState();

    act(() => {
      expect(hook.result.current.createStarterOnce('quick_book', {
        siteName: state.profile.businessName,
      }).success).toBe(true);

      addConfirmedCanva(hook.result.current, state);
    });
    const before = hook.result.current.getHistorySnapshot();

    expect(before).not.toBeNull();

    const switched = runStarterSwitch(hook.result.current, state, 'one_page');

    expect(switched.success).toBe(true);

    const after = hook.result.current.getHistorySnapshot();

    expect(after?.past).toHaveLength((before?.past.length ?? 0) + 1);
    expect(after?.past.at(-1)).toEqual(before?.present);

    act(() => {
      expect(hook.result.current.undo()).toBe(true);
    });

    expect(hook.result.current.document?.originStarter).toBe('quick_book');
    expect(getCustomDesigns(hook.result.current.document as SiteBuilderDocument))
      .toEqual([expect.objectContaining({ id: state.canva.customDesignSectionId })]);

    act(() => {
      expect(hook.result.current.redo()).toBe(true);
    });

    expect(hook.result.current.document?.originStarter).toBe('one_page');
  });

  it('leaves the current document untouched when its tracked Canva section is missing', () => {
    const hook = renderHook(() => useLabDocument());
    const state = createState();

    act(() => {
      expect(hook.result.current.createStarterOnce('quick_book', {
        siteName: state.profile.businessName,
      }).success).toBe(true);
    });
    const before = hook.result.current.document;
    state.recipe.canvaEnabled = true;
    state.canva.customDesignSectionId = 'missing-onboarding-section';
    state.canva.images = [{
      fileName: canvaImage.fileName,
      id: canvaImage.id,
      mimeType: canvaImage.mimeType,
      source: 'indexed_db',
      storageId: canvaImage.assetId,
    }];

    const result = runStarterSwitch(
      hook.result.current,
      state,
      'one_page',
    );

    expect(result).toMatchObject({
      message: expect.stringContaining('could not be found'),
      success: false,
    });
    expect(hook.result.current.document).toBe(before);
  });

  it('does not replace a starter after the Builder handoff', () => {
    const hook = renderHook(() => useLabDocument());
    const state = createState();
    act(() => {
      expect(hook.result.current.createStarterOnce('quick_book', {
        siteName: state.profile.businessName,
      }).success).toBe(true);
    });
    const before = hook.result.current.document;
    state.progress.sessionStatus = 'builder';

    const result = runStarterSwitch(
      hook.result.current,
      state,
      'one_page',
    );

    expect(result).toEqual({
      message: 'Starting points can only be changed before opening the Builder.',
      success: false,
    });
    expect(hook.result.current.document).toBe(before);
  });

  it('replaces a post-handoff starter only after an explicit caller confirmation', () => {
    const hook = renderHook(() => useLabDocument());
    const state = createState();
    act(() => {
      expect(hook.result.current.createStarterOnce('quick_book', {
        siteName: state.profile.businessName,
      }).success).toBe(true);
    });
    state.progress.sessionStatus = 'builder';

    let result: ReturnType<typeof switchOnboardingStarter> | undefined;
    act(() => {
      result = switchOnboardingStarter(
        hook.result.current,
        state,
        'one_page',
        { allowBuilderReset: true },
      );
    });

    expect(result).toMatchObject({ changed: true, success: true });

    if (!result?.success) {
      throw new Error(result?.message);
    }
    expectStarterShape(result.document, 'one_page');

    expect(result.document.siteName).toBe(state.profile.businessName);
  });
});
