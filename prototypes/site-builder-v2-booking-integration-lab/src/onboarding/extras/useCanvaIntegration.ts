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

export type CanvaLabDocumentController = Pick<
  ReturnType<typeof useLabDocument>,
  | 'createHistoryCheckpoint'
  | 'document'
  | 'getHistorySnapshot'
  | 'prepareCommand'
  | 'restoreHistoryCheckpoint'
  | 'runCommand'
>;

type CanvaAssetCoordinator = Pick<
  CustomDesignAssetTransactionCoordinator,
  'uploadImages'
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
  fileName?: string;
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

type IntegrateCanvaDesignOptions = {
  coordinator: CanvaAssetCoordinator | null;
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

const CANVA_IMAGE_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
]);

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

const locateCustomDesign = (
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
    throw new Error('This Custom Design section is no longer available.');
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
    throw new Error('Your site needs a Booking section before this design can be placed.');
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
      throw new Error('The Custom Design section could not be placed.');
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
  if (!created) throw new Error('The Custom Design section was not created.');

  return { created: true, document: next, sectionId: created.id };
};

export const integrateCanvaDesign = async ({
  coordinator,
  createAssetId,
  createImageItemId,
  input,
  lab,
  onSectionIdChange,
  storageError,
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
  if (!input.files.some((file) => CANVA_IMAGE_MIME_TYPES.has(file.type))) {
    return failed(
      'rejected',
      'Choose at least one PNG, JPEG, or WebP image.',
      input.sectionId ?? null,
    );
  }
  if (!coordinator) {
    return failed(
      'unavailable',
      storageError?.message
        ?? 'Uploaded-design storage is not available in this browser.',
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
      throw new Error('The Custom Design section is no longer available.');
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
        failures: upload.failures.map(({ fileName, message }) => ({
          fileName,
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
      failures: upload.failures.map(({ fileName, message }) => ({
        fileName,
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

  return {
    addCanvaDesign,
    available: coordinator !== null,
    storageError,
  };
};
