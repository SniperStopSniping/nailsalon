import type {
  CustomDesignSectionInstance,
  HistoryState,
  SiteBuilderDocument,
} from '../../model';
import {
  applyHistoryCommand,
  createHistoryState,
  DEFAULT_HISTORY_LIMIT,
  initializeStarter,
} from '../../model';
import type { LabDocumentController } from '../../ui/useLabDocument';
import { getCanvaPlacementTarget } from '../extras/useCanvaIntegration';
import type { OnboardingLabState, StarterId } from '../model/types';

type StarterSwitchLabController = Pick<
  LabDocumentController,
  'createHistoryCheckpoint' | 'restoreHistoryCheckpoint'
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
    if (section) {
      return section;
    }
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
  if (!hasConfirmedCanva) {
    return null;
  }
  if (!sectionId) {
    return undefined;
  }

  const section = locateCustomDesign(document, sectionId);
  if (!section) {
    return undefined;
  }
  const trackedAssetIds = state.canva.images.flatMap(image =>
    image.storageId ? [image.storageId] : []);
  const sectionAssetIds = new Set(
    section.settings.images.map(image => image.assetId),
  );
  if (
    trackedAssetIds.length !== state.canva.images.length
    || trackedAssetIds.some(assetId => !sectionAssetIds.has(assetId))
  ) {
    return undefined;
  }
  return {
    settings: structuredClone(section.settings),
    visible: section.visible,
  };
};

const addPreservedCustomDesign = (
  history: HistoryState,
  preserved: PreservedCustomDesign,
  state: OnboardingLabState,
): {
  customDesignSectionId: string;
  history: HistoryState;
  success: true;
} | {
  message: string;
  success: false;
} => {
  const document = history.present;
  const target = getCanvaPlacementTarget(document, state.canva.placement);
  if (!target) {
    return {
      message: 'The new starting point needs a booking area before your Canva design can be restored.',
      success: false,
    };
  }

  const existingIds = new Set(
    document.pages.flatMap(page => page.sections.map(section => section.id)),
  );
  const added = applyHistoryCommand(history, {
    input: {
      pageId: target.pageId,
      position: target.position,
      sectionType: 'custom_design',
    },
    type: 'add_section',
  });

  const created = added.present.pages
    .flatMap(page => page.sections)
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

  let updated = applyHistoryCommand(added, {
    sectionId: created.id,
    settings: preserved.settings,
    type: 'update_custom_design_settings',
  });
  if (!preserved.visible) {
    updated = applyHistoryCommand(updated, {
      sectionId: created.id,
      type: 'set_section_visible',
      visible: false,
    });
  }

  return {
    customDesignSectionId: created.id,
    history: updated,
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

  try {
    let stagedHistory = createHistoryState(initializeStarter(starter, {
      siteName: state.profile.businessName.trim() || 'My nail studio',
    }));
    let customDesignSectionId: string | null = null;
    if (preservedCustomDesign) {
      const restoredCustomDesign = addPreservedCustomDesign(
        stagedHistory,
        preservedCustomDesign,
        state,
      );
      if (!restoredCustomDesign.success) {
        return restoredCustomDesign;
      }
      stagedHistory = restoredCustomDesign.history;
      customDesignSectionId = restoredCustomDesign.customDesignSectionId;
    }

    const transition: HistoryState = {
      future: [],
      past: [...checkpoint.past, checkpoint.present].slice(-DEFAULT_HISTORY_LIMIT),
      present: stagedHistory.present,
    };
    if (!lab.restoreHistoryCheckpoint(transition)) {
      return {
        message: 'Finish the current image change before changing your starting point.',
        success: false,
      };
    }
    return {
      changed: true,
      customDesignSectionId,
      document: transition.present,
      success: true,
    };
  } catch {
    return {
      message: 'The new starting point could not be created.',
      success: false,
    };
  }
};
