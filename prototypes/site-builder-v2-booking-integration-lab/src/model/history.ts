import { createIdFactory } from './ids';
import { applyBuilderCommand } from './operations';
import type {
  BuilderCommand,
  HistoryState,
  IdFactory,
  SiteBuilderDocument,
} from './types';

export const DEFAULT_HISTORY_LIMIT = 100;

export const getReachableHistoryDocuments = (
  state: HistoryState,
): readonly SiteBuilderDocument[] => [
  ...state.past,
  state.present,
  ...state.future,
];

export const collectCustomDesignAssetIds = (
  document: SiteBuilderDocument,
): Set<string> => {
  const assetIds = new Set<string>();
  const sections = [
    ...document.pages.flatMap(page => page.sections),
    ...document.unusedSections,
  ];
  for (const section of sections) {
    if (section.sectionType !== 'custom_design') {
      continue;
    }
    for (const image of section.settings.images) {
      assetIds.add(image.assetId);
    }
  }
  return assetIds;
};

export const collectReachableCustomDesignAssetIds = (
  state: HistoryState,
): Set<string> => {
  const assetIds = new Set<string>();
  for (const document of getReachableHistoryDocuments(state)) {
    for (const assetId of collectCustomDesignAssetIds(document)) {
      assetIds.add(assetId);
    }
  }
  return assetIds;
};

export const createHistoryState = (
  document: SiteBuilderDocument,
): HistoryState => ({
  past: [],
  present: document,
  future: [],
});

export const applyHistoryCommand = (
  state: HistoryState,
  command: BuilderCommand,
  options: { idFactory?: IdFactory; limit?: number } = {},
): HistoryState => {
  const next = applyBuilderCommand(
    state.present,
    command,
    options.idFactory ?? createIdFactory(),
  );
  if (next === state.present) {
    return state;
  }

  const limit = options.limit ?? DEFAULT_HISTORY_LIMIT;
  const past = [...state.past, state.present];
  return {
    past: limit > 0 ? past.slice(-limit) : [],
    present: next,
    future: [],
  };
};

export const canUndoHistory = (state: HistoryState): boolean =>
  state.past.length > 0;

export const canRedoHistory = (state: HistoryState): boolean =>
  state.future.length > 0;

export const undoHistory = (state: HistoryState): HistoryState => {
  const previous = state.past.at(-1);
  if (!previous) {
    return state;
  }
  return {
    past: state.past.slice(0, -1),
    present: previous,
    future: [state.present, ...state.future],
  };
};

export const redoHistory = (state: HistoryState): HistoryState => {
  const [next, ...remainingFuture] = state.future;
  if (!next) {
    return state;
  }
  return {
    past: [...state.past, state.present],
    present: next,
    future: remainingFuture,
  };
};
