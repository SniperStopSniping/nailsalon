import { describe, expect, it, vi } from 'vitest';

import type {
  PreparedCustomDesignDocumentTransition,
  ReplaceCustomDesignImageInput,
  UploadCustomDesignImagesInput,
} from '../../custom-design/integration/AssetTransactionCoordinator';
import type { CustomDesignImageItem } from '../../custom-design/model';
import {
  applyHistoryCommand,
  collectReachableCustomDesignAssetIds,
  createDeterministicIdFactory,
  createHistoryState,
  exportSiteBuilderDocument,
  initializeStarter,
  parseSiteBuilderDocument,
  type BuilderCommand,
  type HistoryState,
} from '../../model';
import {
  getCanvaPlacementTarget,
  integrateCanvaDesign,
  locateCanonicalBookingPage,
  locateOnboardingCustomDesign,
  removeCanvaDesign,
  removeCanvaImage,
  reorderCanvaImages,
  replaceCanvaImage,
  saveCanvaSettings,
  type CanvaAssetCoordinator,
  type CanvaLabDocumentController,
} from './useCanvaIntegration';

const png = () => new File(['canva'], 'canva-page.png', { type: 'image/png' });

const imageItem = (assetId: string, id: string): CustomDesignImageItem => ({
  altText: '',
  aspectRatio: 0.75,
  assetId,
  decorative: false,
  fileName: 'canva-page.png',
  fileSize: 5,
  height: 1_600,
  id,
  interactiveAreas: [],
  mimeType: 'image/png',
  width: 1_200,
});

const createLab = (starter: 'multi_page' | 'quick_book' = 'quick_book') => {
  const ids = createDeterministicIdFactory(`canva-${starter}`);
  let history = createHistoryState(initializeStarter(starter, { idFactory: ids }));
  let prepared: { baseline: HistoryState; next: HistoryState } | null = null;
  const commands: BuilderCommand[] = [];
  const restoreHistoryCheckpoint = vi.fn((checkpoint: HistoryState) => {
    if (prepared) return false;
    history = checkpoint;
    return true;
  });
  const runCommand = vi.fn((command: BuilderCommand) => {
    commands.push(command);
    try {
      const next = applyHistoryCommand(history, command, { idFactory: ids });
      history = next;
      return {
        changed: true,
        document: history.present,
        success: true as const,
      };
    } catch (error) {
      return {
        message: error instanceof Error ? error.message : 'Command failed.',
        success: false as const,
      };
    }
  });
  const prepareCommand = vi.fn((command: BuilderCommand) => {
    commands.push(command);
    const baseline = history;
    try {
      const next = applyHistoryCommand(baseline, command, { idFactory: ids });
      prepared = { baseline, next };
      const transition: PreparedCustomDesignDocumentTransition & {
        document: typeof next.present;
      } = {
        cancel: () => {
          prepared = null;
        },
        changed: next !== baseline,
        document: next.present,
        publish: () => {
          if (!prepared || history !== prepared.baseline) return false;
          history = prepared.next;
          prepared = null;
          return true;
        },
      };
      return { ...transition, success: true as const };
    } catch (error) {
      return {
        message: error instanceof Error ? error.message : 'Prepare failed.',
        success: false as const,
      };
    }
  });
  const lab = {
    createHistoryCheckpoint: () => history,
    get document() {
      return history.present;
    },
    getHistorySnapshot: () => history,
    prepareCommand,
    restoreHistoryCheckpoint,
    runCommand,
  } as unknown as CanvaLabDocumentController;

  return {
    commands,
    get document() {
      return history.present;
    },
    lab,
    prepareCommand,
    restoreHistoryCheckpoint,
    runCommand,
  };
};

const committingCoordinator = () => ({
  uploadImages: vi.fn(async (input: UploadCustomDesignImagesInput) => {
    const added = imageItem(input.createAssetId(input.files[0]!, 0), input.createImageItemId(input.files[0]!, 0));
    const transition = await input.prepareDocumentTransition([
      ...input.currentImages,
      added,
    ]);
    const published = transition.changed && await transition.publish();
    return {
      added: published ? [added] : [],
      cleanupErrors: [],
      documentChanged: Boolean(published),
      failures: [],
      status: published ? 'committed' as const : 'failed' as const,
    };
  }),
});

describe('Canva placement', () => {
  it('locates canonical Booking and computes 1-based before/after positions', () => {
    const quick = initializeStarter('quick_book', {
      idFactory: createDeterministicIdFactory('placement-quick'),
    });
    const location = locateCanonicalBookingPage(quick);
    expect(location?.page.name).toBe('Home');
    expect(getCanvaPlacementTarget(quick, 'before_booking')).toMatchObject({
      pageId: location?.page.id,
      position: 3,
    });
    expect(getCanvaPlacementTarget(quick, 'after_booking')).toMatchObject({
      pageId: location?.page.id,
      position: 4,
    });

    const multi = initializeStarter('multi_page', {
      idFactory: createDeterministicIdFactory('placement-multi'),
    });
    const multiLocation = locateCanonicalBookingPage(multi);
    expect(multiLocation?.page.name).toBe('Services / Book');
    expect(getCanvaPlacementTarget(multi, 'before_booking')?.position).toBe(2);
    expect(getCanvaPlacementTarget(multi, 'after_booking')?.position).toBe(3);
  });
});

describe('integrateCanvaDesign', () => {
  it('does nothing for an unconfirmed or empty selection', async () => {
    const state = createLab();
    const coordinator = committingCoordinator();

    const unconfirmed = await integrateCanvaDesign({
      coordinator,
      createAssetId: () => 'asset_unconfirmed',
      createImageItemId: () => 'image_unconfirmed',
      input: {
        confirmed: false,
        displayMode: 'poster',
        files: [png()],
        placement: 'after_booking',
      },
      lab: state.lab,
    });
    const empty = await integrateCanvaDesign({
      coordinator,
      createAssetId: () => 'asset_empty',
      createImageItemId: () => 'image_empty',
      input: {
        confirmed: true,
        displayMode: 'poster',
        files: [],
        placement: 'after_booking',
      },
      lab: state.lab,
    });

    expect(unconfirmed.status).toBe('noop');
    expect(empty.status).toBe('noop');
    expect(state.runCommand).not.toHaveBeenCalled();
    expect(coordinator.uploadImages).not.toHaveBeenCalled();
  });

  it('restores the checkpoint after a complete upload failure', async () => {
    const state = createLab();
    const initial = state.document;
    const coordinator = {
      uploadImages: vi.fn(async () => ({
        added: [],
        cleanupErrors: [],
        documentChanged: false,
        failures: [{
          code: 'storage_failed' as const,
          fileName: 'canva-page.png',
          index: 0,
          message: 'IndexedDB failed.',
        }],
        status: 'failed' as const,
      })),
    };

    const result = await integrateCanvaDesign({
      coordinator,
      createAssetId: () => 'asset_failure',
      createImageItemId: () => 'image_failure',
      input: {
        confirmed: true,
        displayMode: 'contained',
        files: [png()],
        placement: 'before_booking',
      },
      lab: state.lab,
    });

    expect(result).toMatchObject({ sectionId: null, status: 'failed' });
    expect(state.restoreHistoryCheckpoint).toHaveBeenCalledOnce();
    expect(state.document).toEqual(initial);
    expect(state.document.pages.flatMap((page) => page.sections)).not.toContainEqual(
      expect.objectContaining({ sectionType: 'custom_design' }),
    );
  });

  it('uses add_section, coordinator upload, and a prepared settings transition', async () => {
    const state = createLab('multi_page');
    const coordinator = committingCoordinator();
    const onSectionIdChange = vi.fn();

    const result = await integrateCanvaDesign({
      coordinator,
      createAssetId: () => 'custom_design_asset_canva',
      createImageItemId: () => 'custom_design_image_canva',
      input: {
        confirmed: true,
        displayMode: 'full_width',
        files: [png()],
        placement: 'before_booking',
      },
      lab: state.lab,
      onSectionIdChange,
    });

    expect(result).toMatchObject({
      addedCount: 1,
      addedImages: [{
        assetId: 'custom_design_asset_canva',
        fileName: 'canva-page.png',
        id: 'custom_design_image_canva',
        mimeType: 'image/png',
      }],
      status: 'committed',
    });
    expect(result.sectionId).toMatch(/^section_/u);
    expect(state.commands.map((command) => command.type)).toEqual([
      'add_section',
      'update_custom_design_settings',
    ]);
    expect(coordinator.uploadImages).toHaveBeenCalledOnce();
    expect(state.prepareCommand).toHaveBeenCalledWith(expect.objectContaining({
      sectionId: result.sectionId,
      type: 'update_custom_design_settings',
    }));
    expect(onSectionIdChange).toHaveBeenCalledWith(result.sectionId);

    const bookingPage = locateCanonicalBookingPage(state.document)?.page;
    expect(bookingPage?.sections.map((section) => section.sectionType)).toEqual([
      'section_03',
      'custom_design',
      'booking',
    ]);
    const customDesign = bookingPage?.sections.find(
      (section) => section.sectionType === 'custom_design',
    );
    expect(customDesign?.sectionType).toBe('custom_design');
    if (customDesign?.sectionType !== 'custom_design') return;
    expect(customDesign.settings.displayMode).toBe('full_width');
    expect(customDesign.settings.images).toHaveLength(1);
    expect(JSON.stringify(state.document)).not.toMatch(/blob:|data:image|base64/u);
  });

  it('preserves typed partial failures including capacity filenames', async () => {
    const state = createLab();
    const coordinator = {
      uploadImages: vi.fn(async (input: UploadCustomDesignImagesInput) => {
        const added = imageItem('asset-added', 'image-added');
        const transition = await input.prepareDocumentTransition([added]);
        await transition.publish();
        return {
          added: [added],
          cleanupErrors: [],
          documentChanged: true,
          failures: [{
            code: 'too_many_images' as const,
            fileName: 'page-11.png',
            index: 1,
            message: 'This section can contain up to 10 images.',
          }],
          status: 'partial' as const,
        };
      }),
    };

    const result = await integrateCanvaDesign({
      coordinator,
      createAssetId: () => 'asset-added',
      createImageItemId: () => 'image-added',
      input: {
        confirmed: true,
        displayMode: 'contained',
        files: [png(), new File(['extra'], 'page-11.png', { type: 'image/png' })],
        placement: 'after_booking',
      },
      lab: state.lab,
    });

    expect(result.status).toBe('partial');
    expect(result.failures).toEqual([{
      code: 'too_many_images',
      fileName: 'page-11.png',
      index: 1,
      message: 'This section can contain up to 10 images.',
    }]);
  });

  it('supports settings-only save, reorder, and transactional removal on the same document', async () => {
    const state = createLab();
    let nextId = 0;
    const uploadCoordinator = committingCoordinator();
    const first = await integrateCanvaDesign({
      coordinator: uploadCoordinator,
      createAssetId: () => `asset-${++nextId}`,
      createImageItemId: () => `image-${nextId}`,
      input: {
        confirmed: true,
        displayMode: 'contained',
        files: [png()],
        placement: 'after_booking',
      },
      lab: state.lab,
    });
    const second = await integrateCanvaDesign({
      coordinator: uploadCoordinator,
      createAssetId: () => `asset-${++nextId}`,
      createImageItemId: () => `image-${nextId}`,
      input: {
        confirmed: true,
        displayMode: 'contained',
        files: [new File(['two'], 'second.png', { type: 'image/png' })],
        placement: 'after_booking',
        sectionId: first.sectionId,
      },
      lab: state.lab,
    });
    expect(second.sectionId).toBe(first.sectionId);
    const sectionId = second.sectionId!;
    const settings = saveCanvaSettings(state.lab, {
      displayMode: 'poster',
      placement: 'before_booking',
      sectionId,
    });
    expect(settings.success).toBe(true);
    expect(settings.section?.settings.displayMode).toBe('poster');

    const ids = settings.section!.settings.images.map(image => image.id).reverse();
    const reordered = reorderCanvaImages(state.lab, sectionId, ids);
    expect(reordered.section?.settings.images.map(image => image.id)).toEqual(ids);

    const deleteAssetsIfUnreferenced = vi.fn<() => Promise<Error[]>>(async () => []);
    deleteAssetsIfUnreferenced.mockResolvedValueOnce([
      new Error('Browser cleanup failed.'),
    ]);
    const coordinator = {
      coordinateDocumentMutation: vi.fn(async <T,>(mutation: () => T | Promise<T>) => mutation()),
      deleteAssetsIfUnreferenced,
      replaceImage: vi.fn(),
      uploadImages: vi.fn(),
    };
    const removedImage = reordered.section!.settings.images[0]!;
    const removed = await removeCanvaImage(
      coordinator as unknown as CanvaAssetCoordinator,
      state.lab,
      sectionId,
      removedImage.id,
    );
    expect(removed.success).toBe(true);
    expect(removed.section?.settings.images).toHaveLength(1);
    expect(removed.cleanupWarnings).toEqual([expect.objectContaining({
      fileName: removedImage.fileName,
      message: expect.stringContaining('still needs cleanup'),
    })]);
    expect(coordinator.deleteAssetsIfUnreferenced)
      .toHaveBeenCalledWith([removedImage.assetId]);

    const remaining = removed.section!.settings.images[0]!;
    coordinator.replaceImage.mockImplementation(async (
      input: ReplaceCustomDesignImageInput,
    ) => {
      const replacement = { ...remaining, assetId: 'asset-replacement', fileName: input.file.name };
      const transition = await input.prepareDocumentTransition([replacement]);
      await transition.publish();
      return {
        cleanupErrors: [],
        image: replacement,
        reviewRequired: false,
        success: true as const,
      };
    });
    const replacementFile = new File(['replacement'], 'replacement.webp', {
      type: 'image/webp',
    });
    deleteAssetsIfUnreferenced.mockResolvedValueOnce([
      new Error('Browser cleanup failed.'),
    ]);
    const replaced = await replaceCanvaImage(
      coordinator as unknown as CanvaAssetCoordinator,
      () => 'asset-replacement',
      state.lab,
      sectionId,
      remaining.id,
      replacementFile,
    );
    expect(replaced.success).toBe(true);
    expect(replaced.section?.settings.images[0]?.fileName).toBe('replacement.webp');
    expect(replaced.cleanupWarnings).toEqual([expect.objectContaining({
      fileName: remaining.fileName,
      message: expect.stringContaining('still needs cleanup'),
    })]);
    expect(coordinator.deleteAssetsIfUnreferenced)
      .toHaveBeenLastCalledWith([remaining.assetId]);
  });

  it('removes the intact Canva section and restores its exact pages and assets after reload', async () => {
    const state = createLab();
    let nextId = 0;
    const uploadCoordinator = committingCoordinator();
    const first = await integrateCanvaDesign({
      coordinator: uploadCoordinator,
      createAssetId: () => `asset-${++nextId}`,
      createImageItemId: () => `image-${nextId}`,
      input: {
        confirmed: true,
        displayMode: 'poster',
        files: [png()],
        placement: 'before_booking',
      },
      lab: state.lab,
    });
    const second = await integrateCanvaDesign({
      coordinator: uploadCoordinator,
      createAssetId: () => `asset-${++nextId}`,
      createImageItemId: () => `image-${nextId}`,
      input: {
        confirmed: true,
        displayMode: 'poster',
        files: [new File(['two'], 'second.png', { type: 'image/png' })],
        placement: 'before_booking',
        sectionId: first.sectionId,
      },
      lab: state.lab,
    });
    const sectionId = second.sectionId!;
    const locatedBeforeRemoval = locateOnboardingCustomDesign(state.document, sectionId);
    if (!locatedBeforeRemoval?.pageId) {
      throw new Error('The active Canva section fixture is unavailable.');
    }
    const exactSettings = structuredClone(locatedBeforeRemoval.section.settings);
    const exactAssetIds = exactSettings.images.map(image => image.assetId);
    const deleteAssetsIfUnreferenced = vi.fn(async () => []);
    const coordinator = {
      coordinateDocumentMutation: vi.fn(async <T,>(mutation: () => T | Promise<T>) => mutation()),
      deleteAssetsIfUnreferenced,
      replaceImage: vi.fn(),
      uploadImages: vi.fn(),
    };

    const result = await removeCanvaDesign(
      coordinator as unknown as CanvaAssetCoordinator,
      state.lab,
      sectionId,
    );

    expect(result).toEqual({ section: null, success: true });
    expect(state.commands.slice(-1)).toEqual([{
      sectionId,
      type: 'remove_section',
    }]);
    const tombstone = state.document.unusedSections.find(
      section => section.id === sectionId,
    );
    expect(tombstone?.sectionType).toBe('custom_design');
    if (tombstone?.sectionType !== 'custom_design') return;
    expect(tombstone.settings).toEqual(exactSettings);
    expect(deleteAssetsIfUnreferenced).toHaveBeenCalledWith(exactAssetIds);
    expect(collectReachableCustomDesignAssetIds(
      createHistoryState(state.document),
    )).toEqual(new Set(exactAssetIds));

    const reloaded = parseSiteBuilderDocument(exportSiteBuilderDocument(state.document));
    expect(reloaded.success).toBe(true);
    if (!reloaded.success) return;
    const restoredHistory = applyHistoryCommand(
      createHistoryState(reloaded.document),
      {
        pageId: locatedBeforeRemoval.pageId,
        position: 1,
        sectionId,
        type: 'restore_section',
      },
    );
    const restored = locateOnboardingCustomDesign(restoredHistory.present, sectionId);
    expect(restored?.pageId).toBe(locatedBeforeRemoval.pageId);
    expect(restored?.section.settings).toEqual(exactSettings);
    expect(collectReachableCustomDesignAssetIds(restoredHistory))
      .toEqual(new Set(exactAssetIds));
  });
});
