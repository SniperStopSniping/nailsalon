import type {
  CustomDesignSectionInstance,
  HistoryState,
  SiteBuilderDocument,
} from '../../model';
import type { LabDocumentController } from '../../ui/useLabDocument';
import { getCanvaPlacementTarget } from '../extras/useCanvaIntegration';
import type { OnboardingLabState, StarterId } from '../model/types';

type StarterSwitchLabController = Pick<
  LabDocumentController,
  | 'chooseStarter'
  | 'createHistoryCheckpoint'
  | 'getHistorySnapshot'
  | 'resetLab'
  | 'restoreHistoryCheckpoint'
  | 'runCommand'
  | 'syncSiteName'
>;

export type StarterSwitchResult =
  | {
      changed: boolean;
      customDesignSectionId: string | null;
      document: SiteBuilderDocument;
      success: true;
    }
  | {
      message: string;
      success: false;
    };

type PreservedCustomDesign = Pick<
  CustomDesignSectionInstance,
  'settings' | 'visible'
>;

const locateCustomDesign = (
  document: SiteBuilderDocument,
  sectionId: string,
): CustomDesignSectionInstance | null => {
  for (const page of document.pages) {
    const section = page.sections.find(
      (candidate): candidate is CustomDesignSectionInstance =>
        candidate.id === sectionId && candidate.sectionType === 'custom_design',
    );
    if (section) return section;
  }
  return null;
};

const getPreservedCustomDesign = (
  state: OnboardingLabState,
  document: SiteBuilderDocument,
): PreservedCustomDesign | null | undefined => {
  const sectionId = state.canva.customDesignSectionId;
  const hasConfirmedCanva = state.recipe.canvaEnabled
    && state.canva.images.length > 0;
  if (!hasConfirmedCanva) return null;
  if (!sectionId) return undefined;

  const section = locateCustomDesign(document, sectionId);
  if (!section) return undefined;
  const trackedAssetIds = state.canva.images.flatMap((image) =>
    image.storageId ? [image.storageId] : []);
  const sectionAssetIds = new Set(
    section.settings.images.map((image) => image.assetId),
  );
  if (
    trackedAssetIds.length !== state.canva.images.length
    || trackedAssetIds.some((assetId) => !sectionAssetIds.has(assetId))
  ) {
    return undefined;
  }
  return {
    settings: structuredClone(section.settings),
    visible: section.visible,
  };
};

const rollback = (
  lab: StarterSwitchLabController,
  checkpoint: HistoryState,
  message: string,
): StarterSwitchResult => {
  if (!lab.restoreHistoryCheckpoint(checkpoint)) {
    return {
      message: `${message} Your previous starting site could not be restored automatically.`,
      success: false,
    };
  }
  return { message, success: false };
};

const addPreservedCustomDesign = (
  lab: StarterSwitchLabController,
  document: SiteBuilderDocument,
  preserved: PreservedCustomDesign,
  state: OnboardingLabState,
): StarterSwitchResult => {
  const target = getCanvaPlacementTarget(document, state.canva.placement);
  if (!target) {
    return {
      message: 'The new starting point needs a Booking section before your Canva design can be restored.',
      success: false,
    };
  }

  const existingIds = new Set(
    document.pages.flatMap((page) => page.sections.map((section) => section.id)),
  );
  const added = lab.runCommand({
    input: {
      pageId: target.pageId,
      position: target.position,
      sectionType: 'custom_design',
    },
    type: 'add_section',
  });
  if (!added.success) return added;

  const created = added.document.pages
    .flatMap((page) => page.sections)
    .find(
      (section): section is CustomDesignSectionInstance =>
        section.sectionType === 'custom_design' && !existingIds.has(section.id),
    );
  if (!created) {
    return {
      message: 'The saved Canva design could not be recreated in the new starting point.',
      success: false,
    };
  }

  const updated = lab.runCommand({
    sectionId: created.id,
    settings: preserved.settings,
    type: 'update_custom_design_settings',
  });
  if (!updated.success) return updated;

  let finalDocument = updated.document;
  if (!preserved.visible) {
    const hidden = lab.runCommand({
      sectionId: created.id,
      type: 'set_section_visible',
      visible: false,
    });
    if (!hidden.success) return hidden;
    finalDocument = hidden.document;
  }

  return {
    changed: true,
    customDesignSectionId: created.id,
    document: finalDocument,
    success: true,
  };
};

/**
 * Rebuilds only the universal starter document while keeping the browser-local
 * onboarding profile and its confirmed, onboarding-owned Custom Design assets.
 */
export const switchOnboardingStarter = (
  lab: StarterSwitchLabController,
  state: OnboardingLabState,
  starter: StarterId,
  options: { allowBuilderReset?: boolean } = {},
): StarterSwitchResult => {
  if (state.progress.sessionStatus === 'builder' && !options.allowBuilderReset) {
    return {
      message: 'Starting points can only be changed before opening the Builder.',
      success: false,
    };
  }
  const checkpoint = lab.createHistoryCheckpoint();
  if (!checkpoint) {
    return {
      message: 'Choose a starting point before changing it.',
      success: false,
    };
  }
  if (checkpoint.present.originStarter === starter) {
    return {
      changed: false,
      customDesignSectionId: state.canva.customDesignSectionId,
      document: checkpoint.present,
      success: true,
    };
  }

  const preservedCustomDesign = getPreservedCustomDesign(
    state,
    checkpoint.present,
  );
  if (preservedCustomDesign === undefined) {
    return {
      message: 'The saved Canva design could not be found, so the starting point was not changed.',
      success: false,
    };
  }

  if (!lab.resetLab()) {
    return {
      message: 'Finish the current image change before changing your starting point.',
      success: false,
    };
  }
  if (!lab.chooseStarter(starter)) {
    return rollback(
      lab,
      checkpoint,
      'The new starting point could not be created.',
    );
  }
  if (!lab.syncSiteName(state.profile.businessName)) {
    return rollback(
      lab,
      checkpoint,
      'The business name could not be applied to the new starting point.',
    );
  }

  const nextDocument = lab.getHistorySnapshot()?.present;
  if (!nextDocument) {
    return rollback(
      lab,
      checkpoint,
      'The new starting point could not be read.',
    );
  }
  if (!preservedCustomDesign) {
    return {
      changed: true,
      customDesignSectionId: null,
      document: nextDocument,
      success: true,
    };
  }

  const restoredCustomDesign = addPreservedCustomDesign(
    lab,
    nextDocument,
    preservedCustomDesign,
    state,
  );
  if (!restoredCustomDesign.success) {
    return rollback(lab, checkpoint, restoredCustomDesign.message);
  }
  return restoredCustomDesign;
};
