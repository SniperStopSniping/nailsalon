import { useCallback, useRef } from 'react';

import type { CustomDesignAssetTransactionCoordinator } from '../../custom-design/integration/AssetTransactionCoordinator';
import {
  useCustomDesignAssetCoordinator,
  useCustomDesignAssetStorageError,
} from '../../custom-design/integration/CustomDesignAssetProvider';
import {
  createCustomDesignIdFactory,
  reconcileCtaPlacementForImages,
  type CustomDesignDisplayMode,
  type CustomDesignImageItem,
  type CustomDesignSettings,
} from '../../custom-design/model';
import type {
  BuilderCommand,
  CustomDesignSectionInstance,
  HistoryState,
  PageDocument,
  SiteBuilderDocument,
} from '../../model';
import { useLabDocument } from '../../ui/useLabDocument';

export type CanvaPlacement = 'after_booking' | 'before_booking';

export const CANVA_UPLOADS_UNAVAILABLE_MESSAGE =
  'Uploads aren’t available in this browser right now. Try again or use another browser.';

export type CanvaLabDocumentController = Pick<
  ReturnType<typeof useLabDocument>,
  | 'createHistoryCheckpoint'
  | 'document'
  | 'getHistorySnapshot'
  | 'prepareCommand'
  | 'restoreHistoryCheckpoint'
  | 'runCommand'
>;

type CanvaUploadCoordinator = Pick<
  CustomDesignAssetTransactionCoordinator,
  'uploadImages'
>;

export type CanvaAssetCoordinator = Pick<
  CustomDesignAssetTransactionCoordinator,
  | 'coordinateDocumentMutation'
  | 'deleteAssetsIfUnreferenced'
  | 'replaceImage'
  | 'uploadImages'
>;

export type CanvaPlacementTarget = {
  bookingSectionId: string;
  pageId: string;
  position: number;
};

export type AddCanvaDesignInput = {
  confirmed: boolean;
  displayMode: CustomDesignDisplayMode;
  files: readonly File[];
  placement: CanvaPlacement;
  sectionId?: string | null;
};

export type CanvaIntegrationFailure = {
  code?: string;
  fileName?: string;
  index?: number;
  message: string;
};

export type CanvaIntegrationResult = {
  addedCount: number;
  addedImages: Array<Pick<
    CustomDesignImageItem,
    'assetId' | 'fileName' | 'id' | 'mimeType'
  >>;
  failures: CanvaIntegrationFailure[];
  sectionId: string | null;
  status:
    | 'committed'
    | 'failed'
    | 'noop'
    | 'partial'
    | 'rejected'
    | 'unavailable';
};

export type CanvaManagerResult = {
  cleanupWarnings?: CanvaIntegrationFailure[];
  failure?: CanvaIntegrationFailure;
  section: CustomDesignSectionInstance | null;
  success: boolean;
};

export type SaveCanvaSettingsInput = {
  displayMode: CustomDesignDisplayMode;
  placement: CanvaPlacement;
  sectionId: string;
};

type IntegrateCanvaDesignOptions = {
  coordinator: CanvaUploadCoordinator | null;
  createAssetId: () => string;
  createImageItemId: () => string;
  input: AddCanvaDesignInput;
  lab: CanvaLabDocumentController;
  onSectionIdChange?: (sectionId: string | null) => void;
  storageError?: Error | null;
};

type LocatedCustomDesign = {
  pageId: string | null;
  section: CustomDesignSectionInstance;
};

const failed = (
  status: 'failed' | 'rejected' | 'unavailable',
  message: string,
  sectionId: string | null = null,
): CanvaIntegrationResult => ({
  addedCount: 0,
  addedImages: [],
  failures: [{ message }],
  sectionId,
  status,
});

const orderedSections = (page: PageDocument) =>
  [...page.sections].sort((left, right) => left.order - right.order);

export const locateCanonicalBookingPage = (
  document: SiteBuilderDocument,
): { bookingSectionId: string; page: PageDocument } | null => {
  const locations = document.pages.flatMap((page) =>
    page.sections.flatMap((section) =>
      section.sectionType === 'booking'
        ? [{ bookingSectionId: section.id, page }]
        : []),
  );

  return locations.length === 1 ? locations[0] ?? null : null;
};

/**
 * Returns the universal Builder's 1-based insertion/move target. When moving an
 * existing section, it is removed before measuring so "before Booking" remains
 * correct even when that section currently precedes Booking on the same page.
 */
export const getCanvaPlacementTarget = (
  document: SiteBuilderDocument,
  placement: CanvaPlacement,
  movingSectionId?: string | null,
): CanvaPlacementTarget | null => {
  const location = locateCanonicalBookingPage(document);
  if (!location) return null;

  const sections = orderedSections(location.page).filter(
    (section) => section.id !== movingSectionId,
  );
  const bookingIndex = sections.findIndex(
    (section) => section.id === location.bookingSectionId,
  );
  if (bookingIndex < 0) return null;

  return {
    bookingSectionId: location.bookingSectionId,
    pageId: location.page.id,
    position: bookingIndex + (placement === 'before_booking' ? 1 : 2),
  };
};

export const locateOnboardingCustomDesign = (
  document: SiteBuilderDocument,
  sectionId: string,
): LocatedCustomDesign | null => {
  for (const page of document.pages) {
    const section = page.sections.find(
      (candidate): candidate is CustomDesignSectionInstance =>
        candidate.id === sectionId && candidate.sectionType === 'custom_design',
    );
    if (section) return { pageId: page.id, section };
  }

  const section = document.unusedSections.find(
    (candidate): candidate is CustomDesignSectionInstance =>
      candidate.id === sectionId && candidate.sectionType === 'custom_design',
  );
  return section ? { pageId: null, section } : null;
};

const locateCustomDesign = locateOnboardingCustomDesign;

const runDocumentCommand = (
  lab: CanvaLabDocumentController,
  command: BuilderCommand,
): SiteBuilderDocument => {
  const result = lab.runCommand(command);
  if (!result.success) throw new Error(result.message);
  return result.document;
};

const prepareImageTransition = (
  lab: CanvaLabDocumentController,
  sectionId: string,
  expectedImagesJson: string,
  displayMode: CustomDesignDisplayMode,
  images: readonly CustomDesignImageItem[],
) => {
  const history = lab.getHistorySnapshot();
  const current = history
    ? locateCustomDesign(history.present, sectionId)
    : null;
  if (!current || current.pageId === null) {
    throw new Error('This Canva design is no longer available.');
  }
  if (JSON.stringify(current.section.settings.images) !== expectedImagesJson) {
    throw new Error(
      'This Canva image list changed while the files were processing. Try again.',
    );
  }

  const cta = reconcileCtaPlacementForImages(
    current.section.settings.cta,
    images,
  ).cta;
  const prepared = lab.prepareCommand({
    sectionId,
    settings: {
      ...current.section.settings,
      cta,
      displayMode,
      images: [...images],
    },
    type: 'update_custom_design_settings',
  });
  if (!prepared.success) throw new Error(prepared.message);

  return {
    cancel: prepared.cancel,
    changed: prepared.changed,
    publish: prepared.publish,
  };
};

const rollbackFailedIntegration = (
  lab: CanvaLabDocumentController,
  checkpoint: HistoryState,
  createdSectionId: string | null,
): void => {
  if (lab.restoreHistoryCheckpoint(checkpoint) || !createdSectionId) return;

  const history = lab.getHistorySnapshot();
  const created = history
    ? locateCustomDesign(history.present, createdSectionId)
    : null;
  if (
    created?.pageId !== null
    && created?.section.settings.images.length === 0
  ) {
    lab.runCommand({ sectionId: createdSectionId, type: 'remove_section' });
  }
};

const ensureCustomDesignSection = (
  lab: CanvaLabDocumentController,
  document: SiteBuilderDocument,
  placement: CanvaPlacement,
  requestedSectionId?: string | null,
): { created: boolean; document: SiteBuilderDocument; sectionId: string } => {
  const requested = requestedSectionId
    ? locateCustomDesign(document, requestedSectionId)
    : null;
  const target = getCanvaPlacementTarget(
    document,
    placement,
    requested?.pageId ? requested.section.id : null,
  );
  if (!target) {
    throw new Error('Your site needs a booking area before this design can be placed.');
  }

  if (requested) {
    let next = document;
    if (requested.pageId === null) {
      next = runDocumentCommand(lab, {
        pageId: target.pageId,
        position: target.position,
        sectionId: requested.section.id,
        type: 'restore_section',
      });
    } else if (requested.pageId === target.pageId) {
      next = runDocumentCommand(lab, {
        position: target.position,
        sectionId: requested.section.id,
        type: 'move_section',
      });
    } else {
      next = runDocumentCommand(lab, {
        pageId: target.pageId,
        position: target.position,
        sectionId: requested.section.id,
        type: 'move_section_to_page',
      });
    }

    const moved = locateCustomDesign(next, requested.section.id);
    if (!moved || moved.pageId === null) {
      throw new Error('The Canva design could not be placed.');
    }
    if (!moved.section.visible) {
      next = runDocumentCommand(lab, {
        sectionId: moved.section.id,
        type: 'set_section_visible',
        visible: true,
      });
    }
    return { created: false, document: next, sectionId: requested.section.id };
  }

  const beforeIds = new Set(
    document.pages.flatMap((page) => page.sections.map((section) => section.id)),
  );
  const next = runDocumentCommand(lab, {
    input: {
      pageId: target.pageId,
      position: target.position,
      sectionType: 'custom_design',
    },
    type: 'add_section',
  });
  const created = next.pages
    .find((page) => page.id === target.pageId)
    ?.sections.find(
      (section): section is CustomDesignSectionInstance =>
        section.sectionType === 'custom_design' && !beforeIds.has(section.id),
    );
  if (!created) throw new Error('The Canva design was not created.');

  return { created: true, document: next, sectionId: created.id };
};

export const integrateCanvaDesign = async ({
  coordinator,
  createAssetId,
  createImageItemId,
  input,
  lab,
  onSectionIdChange,
}: IntegrateCanvaDesignOptions): Promise<CanvaIntegrationResult> => {
  if (!input.confirmed || input.files.length === 0) {
    return {
      addedCount: 0,
      addedImages: [],
      failures: [],
      sectionId: input.sectionId ?? null,
      status: 'noop',
    };
  }
  if (!coordinator) {
    return failed(
      'unavailable',
      CANVA_UPLOADS_UNAVAILABLE_MESSAGE,
      input.sectionId ?? null,
    );
  }

  const checkpoint = lab.createHistoryCheckpoint();
  if (!checkpoint) {
    return failed('failed', 'Choose a starting point before adding Canva.');
  }

  let createdSectionId: string | null = null;
  let sectionId = input.sectionId ?? null;
  try {
    const ensured = ensureCustomDesignSection(
      lab,
      checkpoint.present,
      input.placement,
      input.sectionId,
    );
    sectionId = ensured.sectionId;
    createdSectionId = ensured.created ? ensured.sectionId : null;
    const current = locateCustomDesign(ensured.document, ensured.sectionId);
    if (!current || current.pageId === null) {
      throw new Error('The Canva design is no longer available.');
    }
    const expectedImagesJson = JSON.stringify(current.section.settings.images);

    const upload = await coordinator.uploadImages({
      createAssetId,
      createImageItemId,
      currentImages: current.section.settings.images,
      files: input.files,
      prepareDocumentTransition: (images) => prepareImageTransition(
        lab,
        ensured.sectionId,
        expectedImagesJson,
        input.displayMode,
        images,
      ),
    });

    const committed = upload.documentChanged && upload.added.length > 0;
    if (!committed) {
      rollbackFailedIntegration(lab, checkpoint, createdSectionId);
      if (createdSectionId) onSectionIdChange?.(null);
      return {
        addedCount: 0,
        addedImages: [],
        failures: upload.failures.map(({ code, fileName, index, message }) => ({
          code,
          fileName,
          index,
          message,
        })),
        sectionId: createdSectionId ? null : sectionId,
        status: upload.status === 'rejected' ? 'rejected' : 'failed',
      };
    }

    onSectionIdChange?.(ensured.sectionId);
    return {
      addedCount: upload.added.length,
      addedImages: upload.added.map((image) => ({
        assetId: image.assetId,
        fileName: image.fileName,
        id: image.id,
        mimeType: image.mimeType,
      })),
      failures: upload.failures.map(({ code, fileName, index, message }) => ({
        code,
        fileName,
        index,
        message,
      })),
      sectionId: ensured.sectionId,
      status: upload.status === 'partial' ? 'partial' : 'committed',
    };
  } catch (error) {
    rollbackFailedIntegration(lab, checkpoint, createdSectionId);
    if (createdSectionId) onSectionIdChange?.(null);
    return failed(
      'failed',
      error instanceof Error
        ? error.message
        : 'The Canva design could not be added safely.',
      createdSectionId ? null : sectionId,
    );
  }
};

const managerFailure = (
  message: string,
  fileName?: string,
): CanvaManagerResult => ({
  failure: { ...(fileName ? { fileName } : {}), message },
  section: null,
  success: false,
});

const updateCanvaSettings = (
  lab: CanvaLabDocumentController,
  sectionId: string,
  update: (settings: CustomDesignSettings) => CustomDesignSettings,
): CanvaManagerResult => {
  const history = lab.getHistorySnapshot();
  const current = history ? locateCustomDesign(history.present, sectionId) : null;
  if (!current || current.pageId === null) {
    return managerFailure('This Canva design is no longer available.');
  }
  const nextSettings = update(current.section.settings);
  const result = lab.runCommand({
    sectionId,
    settings: nextSettings,
    type: 'update_custom_design_settings',
  });
  if (!result.success) return managerFailure(result.message);
  const next = locateCustomDesign(result.document, sectionId);
  return {
    section: next?.section ?? null,
    success: Boolean(next && next.pageId !== null),
  };
};

export const saveCanvaSettings = (
  lab: CanvaLabDocumentController,
  input: SaveCanvaSettingsInput,
): CanvaManagerResult => {
  const checkpoint = lab.createHistoryCheckpoint();
  if (!checkpoint) return managerFailure('Choose a starting point before editing Canva.');
  try {
    const ensured = ensureCustomDesignSection(
      lab,
      checkpoint.present,
      input.placement,
      input.sectionId,
    );
    const result = updateCanvaSettings(
      lab,
      ensured.sectionId,
      settings => ({ ...settings, displayMode: input.displayMode }),
    );
    if (!result.success) {
      lab.restoreHistoryCheckpoint(checkpoint);
      return result;
    }
    return result;
  } catch (error) {
    lab.restoreHistoryCheckpoint(checkpoint);
    return managerFailure(error instanceof Error
      ? error.message
      : 'The Canva settings could not be saved.');
  }
};

export const reorderCanvaImages = (
  lab: CanvaLabDocumentController,
  sectionId: string,
  orderedImageItemIds: readonly string[],
): CanvaManagerResult => updateCanvaSettings(lab, sectionId, (settings) => {
  const imagesById = new Map(settings.images.map(image => [image.id, image]));
  const images = orderedImageItemIds.flatMap((id) => {
    const image = imagesById.get(id);
    return image ? [image] : [];
  });
  if (images.length !== settings.images.length) return settings;
  return { ...settings, images };
});

export const removeCanvaImage = async (
  coordinator: CanvaAssetCoordinator | null,
  lab: CanvaLabDocumentController,
  sectionId: string,
  imageItemId: string,
): Promise<CanvaManagerResult> => {
  if (!coordinator) return managerFailure(CANVA_UPLOADS_UNAVAILABLE_MESSAGE);
  const history = lab.getHistorySnapshot();
  const current = history ? locateCustomDesign(history.present, sectionId) : null;
  const removed = current?.section.settings.images.find(image => image.id === imageItemId);
  if (!current || current.pageId === null || !removed) {
    return managerFailure('This Canva page is no longer available.');
  }
  try {
    let mutation = managerFailure('The Canva page could not be removed.');
    await coordinator.coordinateDocumentMutation(() => {
      mutation = updateCanvaSettings(lab, sectionId, (settings) => {
        const images = settings.images.filter(image => image.id !== imageItemId);
        return {
          ...settings,
          cta: reconcileCtaPlacementForImages(settings.cta, images).cta,
          images,
        };
      });
    });
    if (!mutation.success) return mutation;
    const cleanupErrors = await coordinator.deleteAssetsIfUnreferenced([removed.assetId]);
    return {
      ...mutation,
      ...(cleanupErrors.length > 0 ? {
        cleanupWarnings: cleanupErrors.map(() => ({
          fileName: removed.fileName,
          message: 'The page was removed, but its earlier browser copy still needs cleanup.',
        })),
      } : {}),
    };
  } catch (error) {
    return managerFailure(error instanceof Error
      ? error.message
      : 'The Canva page could not be removed safely.');
  }
};

export const replaceCanvaImage = async (
  coordinator: CanvaAssetCoordinator | null,
  createAssetId: () => string,
  lab: CanvaLabDocumentController,
  sectionId: string,
  imageItemId: string,
  file: File,
): Promise<CanvaManagerResult> => {
  if (!coordinator) return managerFailure(CANVA_UPLOADS_UNAVAILABLE_MESSAGE, file.name);
  const history = lab.getHistorySnapshot();
  const current = history ? locateCustomDesign(history.present, sectionId) : null;
  if (!current || current.pageId === null) {
    return managerFailure('This Canva design is no longer available.', file.name);
  }
  const replacedImage = current.section.settings.images.find(
    image => image.id === imageItemId,
  );
  if (!replacedImage) return managerFailure('This Canva page is no longer available.', file.name);
  const expectedImagesJson = JSON.stringify(current.section.settings.images);
  try {
    const result = await coordinator.replaceImage({
      createAssetId,
      currentImages: current.section.settings.images,
      file,
      imageItemId,
      prepareDocumentTransition: images => prepareImageTransition(
        lab,
        sectionId,
        expectedImagesJson,
        current.section.settings.displayMode,
        images,
      ),
    });
    if (!result.success) {
      return {
        failure: {
          code: result.failure.code,
          fileName: result.failure.fileName,
          index: result.failure.index,
          message: result.failure.message,
        },
        section: current.section,
        success: false,
      };
    }
    const cleanupErrors = await coordinator.deleteAssetsIfUnreferenced([
      replacedImage.assetId,
    ]);
    const nextHistory = lab.getHistorySnapshot();
    const next = nextHistory ? locateCustomDesign(nextHistory.present, sectionId) : null;
    return {
      ...(cleanupErrors.length > 0 ? {
        cleanupWarnings: cleanupErrors.map(() => ({
          fileName: replacedImage.fileName,
          message: 'The replacement is saved, but the earlier browser copy still needs cleanup.',
        })),
      } : {}),
      section: next?.section ?? null,
      success: Boolean(next?.section),
    };
  } catch (error) {
    return managerFailure(error instanceof Error
      ? error.message
      : 'The Canva page could not be replaced safely.', file.name);
  }
};

export const removeCanvaDesign = async (
  coordinator: CanvaAssetCoordinator | null,
  lab: CanvaLabDocumentController,
  sectionId: string,
): Promise<CanvaManagerResult> => {
  if (!coordinator) return managerFailure(CANVA_UPLOADS_UNAVAILABLE_MESSAGE);
  const checkpoint = lab.createHistoryCheckpoint();
  const current = checkpoint ? locateCustomDesign(checkpoint.present, sectionId) : null;
  if (!current || current.pageId === null) {
    return managerFailure('This Canva design is no longer available.');
  }
  const assetIds = current.section.settings.images.map(image => image.assetId);
  try {
    await coordinator.coordinateDocumentMutation(() => {
      const removed = lab.runCommand({ sectionId, type: 'remove_section' });
      if (!removed.success) throw new Error(removed.message);
    });
    const cleanupErrors = await coordinator.deleteAssetsIfUnreferenced(assetIds);
    return {
      ...(cleanupErrors.length > 0 ? {
        cleanupWarnings: cleanupErrors.map((_, index) => ({
          fileName: current.section.settings.images[index]?.fileName ?? 'Canva page',
          message: 'The design was removed, but an earlier browser copy still needs cleanup.',
        })),
      } : {}),
      section: null,
      success: true,
    };
  } catch (error) {
    if (checkpoint) lab.restoreHistoryCheckpoint(checkpoint);
    return managerFailure(error instanceof Error
      ? error.message
      : 'The Canva design could not be removed safely.');
  }
};

export type UseCanvaIntegrationOptions = {
  lab: CanvaLabDocumentController;
  onSectionIdChange?: (sectionId: string | null) => void;
};

export const useCanvaIntegration = ({
  lab,
  onSectionIdChange,
}: UseCanvaIntegrationOptions) => {
  const coordinator = useCustomDesignAssetCoordinator();
  const storageError = useCustomDesignAssetStorageError();
  const idFactoryRef = useRef(createCustomDesignIdFactory());

  const addCanvaDesign = useCallback(
    (input: AddCanvaDesignInput) => integrateCanvaDesign({
      coordinator,
      createAssetId: () => idFactoryRef.current('asset'),
      createImageItemId: () => idFactoryRef.current('image'),
      input,
      lab,
      onSectionIdChange,
      storageError,
    }),
    [coordinator, lab, onSectionIdChange, storageError],
  );
  const removeDesign = useCallback(async (sectionId: string) => {
    const result = await removeCanvaDesign(coordinator, lab, sectionId);
    if (result.success) onSectionIdChange?.(null);
    return result;
  }, [coordinator, lab, onSectionIdChange]);
  const removeImage = useCallback(
    (sectionId: string, imageItemId: string) => removeCanvaImage(
      coordinator,
      lab,
      sectionId,
      imageItemId,
    ),
    [coordinator, lab],
  );
  const reorderImages = useCallback(
    (sectionId: string, orderedImageItemIds: readonly string[]) =>
      reorderCanvaImages(lab, sectionId, orderedImageItemIds),
    [lab],
  );
  const replaceImage = useCallback(
    (sectionId: string, imageItemId: string, file: File) => replaceCanvaImage(
      coordinator,
      () => idFactoryRef.current('asset'),
      lab,
      sectionId,
      imageItemId,
      file,
    ),
    [coordinator, lab],
  );
  const saveSettings = useCallback(
    (input: SaveCanvaSettingsInput) => saveCanvaSettings(lab, input),
    [lab],
  );

  return {
    addCanvaDesign,
    available: coordinator !== null,
    removeDesign,
    removeImage,
    reorderImages,
    replaceImage,
    saveSettings,
    storageError,
  };
};

export type CanvaIntegrationController = ReturnType<typeof useCanvaIntegration>;
