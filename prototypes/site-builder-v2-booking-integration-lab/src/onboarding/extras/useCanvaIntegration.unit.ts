import { describe, expect, it, vi } from 'vitest';

import type {
  PreparedCustomDesignDocumentTransition,
  UploadCustomDesignImagesInput,
} from '../../custom-design/integration/AssetTransactionCoordinator';
import type { CustomDesignImageItem } from '../../custom-design/model';
import {
  applyHistoryCommand,
  createDeterministicIdFactory,
  createHistoryState,
  initializeStarter,
  type BuilderCommand,
  type HistoryState,
} from '../../model';
import {
  getCanvaPlacementTarget,
  integrateCanvaDesign,
  locateCanonicalBookingPage,
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
});
