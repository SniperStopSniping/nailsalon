import { useCallback, useEffect, useRef, useState } from 'react';

import {
  BuilderOperationError,
  SITE_BUILDER_STORAGE_KEY,
  applyHistoryCommand,
  canRedoHistory,
  canUndoHistory,
  collectReachableCustomDesignAssetIds,
  createHistoryState,
  exportSiteBuilderBackup,
  exportSiteBuilderDocument,
  initializeStarter,
  parseSiteBuilderDocument,
  redoHistory,
  undoHistory,
  type BuilderCommand,
  type HistoryState,
  type OriginStarter,
  type SiteBuilderDocument,
  type V1StarterRecipeContext,
  reconcileV1StarterDocument,
} from '../model';
import {
  applyOnboardingSitePresentation,
  type OnboardingSitePresentation,
} from '../onboarding/model/site-document-presentation';

type CommandResult =
  | { success: true; document: SiteBuilderDocument; changed: boolean }
  | { success: false; message: string; code?: string };

type CreateStarterResult =
  | { success: true; document: SiteBuilderDocument }
  | { success: false; message: string; code?: string };

type ImportResult =
  | { success: true; document: SiteBuilderDocument }
  | { success: false; issues: string[] };

type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

type PreparedCommandResult =
  | {
      success: true;
      changed: boolean;
      document: SiteBuilderDocument;
      cancel: () => void;
      publish: () => boolean;
    }
  | { success: false; message: string; code?: string };

type PreparedHistoryTransition = {
  baseline: HistoryState;
  next: HistoryState;
  token: symbol;
};

const getInitialHistory = (): { history: HistoryState | null; loadIssues: string[] } => {
  try {
    const saved = window.localStorage.getItem(SITE_BUILDER_STORAGE_KEY);
    if (!saved) {
      return { history: null, loadIssues: [] };
    }
    const parsed = parseSiteBuilderDocument(saved);
    if (!parsed.success) {
      return { history: null, loadIssues: parsed.issues };
    }
    return { history: createHistoryState(parsed.document), loadIssues: [] };
  } catch {
    return {
      history: null,
      loadIssues: ['The saved Lab document could not be read. Reset the Lab or import a valid backup.'],
    };
  }
};

export function useLabDocument() {
  const initialRef = useRef<ReturnType<typeof getInitialHistory> | null>(null);
  if (initialRef.current === null) {
    initialRef.current = getInitialHistory();
  }

  const [history, setHistory] = useState<HistoryState | null>(initialRef.current.history);
  const historyRef = useRef<HistoryState | null>(initialRef.current.history);
  const [loadIssues, setLoadIssues] = useState<string[]>(initialRef.current.loadIssues);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>(initialRef.current.history ? 'saved' : 'idle');
  const [historyRevision, setHistoryRevision] = useState(0);
  const [transactionPending, setTransactionPending] = useState(false);
  const preparedTransitionRef = useRef<PreparedHistoryTransition | null>(null);

  const replaceHistory = useCallback((next: HistoryState | null) => {
    historyRef.current = next;
    setHistory(next);
    setHistoryRevision((current) => current + 1);
  }, []);

  const chooseStarter = useCallback((starter: OriginStarter): boolean => {
    if (preparedTransitionRef.current) return false;
    const next = createHistoryState(initializeStarter(starter, {
      siteName: 'Your nail studio',
    }));
    setLoadIssues([]);
    setSaveStatus('saving');
    replaceHistory(next);
    return true;
  }, [replaceHistory]);

  const createStarterOnce = useCallback((
    starter: OriginStarter,
    options: { siteName: string },
  ): CreateStarterResult => {
    if (preparedTransitionRef.current) {
      return {
        success: false,
        message: 'Finish the current image upload before choosing a starting point.',
        code: 'asset_transaction_pending',
      };
    }
    if (historyRef.current) {
      return {
        success: false,
        message: 'A starting site has already been created for this onboarding session.',
        code: 'starter_already_created',
      };
    }

    const document = initializeStarter(starter, {
      siteName: options.siteName.trim() || 'My nail studio',
    });
    setLoadIssues([]);
    setSaveStatus('saving');
    replaceHistory(createHistoryState(document));
    return { success: true, document };
  }, [replaceHistory]);

  const syncSiteName = useCallback((siteName: string): boolean => {
    if (preparedTransitionRef.current) return false;
    const current = historyRef.current;
    if (!current) return false;
    const normalizedSiteName = siteName.trim() || 'My nail studio';
    const rename = (document: SiteBuilderDocument): SiteBuilderDocument =>
      document.siteName === normalizedSiteName
        ? document
        : { ...document, siteName: normalizedSiteName };
    const present = rename(current.present);
    const past = current.past.map(rename);
    const future = current.future.map(rename);
    const changed = present !== current.present
      || past.some((document, index) => document !== current.past[index])
      || future.some((document, index) => document !== current.future[index]);
    if (!changed) return true;
    setSaveStatus('saving');
    replaceHistory({ future, past, present });
    return true;
  }, [replaceHistory]);

  const acceptOnboardingPresentation = useCallback((
    siteName: string,
    presentation: OnboardingSitePresentation,
    recipeContext?: V1StarterRecipeContext,
  ): SiteBuilderDocument | null => {
    if (preparedTransitionRef.current) return null;
    const current = historyRef.current;
    if (!current) return null;
    const normalizedSiteName = siteName.trim() || 'My nail studio';
    const accept = (document: SiteBuilderDocument): SiteBuilderDocument => {
      const presented = applyOnboardingSitePresentation(document, presentation);
      const reconciled = recipeContext
        ? reconcileV1StarterDocument(presented, recipeContext).document
        : presented;
      return reconciled.siteName === normalizedSiteName
        ? reconciled
        : { ...reconciled, siteName: normalizedSiteName };
    };
    const present = accept(current.present);
    const past = current.past.map(accept);
    const future = current.future.map(accept);
    const changed = present !== current.present
      || past.some((document, index) => document !== current.past[index])
      || future.some((document, index) => document !== current.future[index]);
    if (changed) {
      setSaveStatus('saving');
      replaceHistory({ future, past, present });
    }
    return present;
  }, [replaceHistory]);

  const runCommand = useCallback((command: BuilderCommand): CommandResult => {
    if (preparedTransitionRef.current) {
      return {
        success: false,
        message: 'Finish the current image upload before making another change.',
        code: 'asset_transaction_pending',
      };
    }
    const current = historyRef.current;
    if (!current) {
      return { success: false, message: 'Choose a starting point first.' };
    }

    try {
      const next = applyHistoryCommand(current, command);
      if (next !== current) setSaveStatus('saving');
      replaceHistory(next);
      return {
        success: true,
        document: next.present,
        changed: next !== current,
      };
    } catch (error) {
      if (error instanceof BuilderOperationError) {
        return { success: false, message: error.message, code: error.code };
      }
      return { success: false, message: 'That change could not be completed safely.' };
    }
  }, [replaceHistory]);

  const prepareCommand = useCallback((
    command: BuilderCommand,
  ): PreparedCommandResult => {
    if (preparedTransitionRef.current) {
      return {
        success: false,
        message: 'Another image change is still being saved.',
        code: 'asset_transaction_pending',
      };
    }
    const baseline = historyRef.current;
    if (!baseline) {
      return { success: false, message: 'Choose a starting point first.' };
    }

    try {
      const next = applyHistoryCommand(baseline, command);
      const token = Symbol('custom-design-document-transition');
      preparedTransitionRef.current = { baseline, next, token };
      setTransactionPending(true);

      const release = (): PreparedHistoryTransition | null => {
        const prepared = preparedTransitionRef.current;
        if (!prepared || prepared.token !== token) return null;
        preparedTransitionRef.current = null;
        setTransactionPending(false);
        return prepared;
      };

      return {
        success: true,
        changed: next !== baseline,
        document: next.present,
        cancel: () => {
          release();
        },
        publish: () => {
          const prepared = preparedTransitionRef.current;
          if (
            !prepared
            || prepared.token !== token
            || historyRef.current !== prepared.baseline
          ) {
            release();
            return false;
          }
          release();
          if (prepared.next !== prepared.baseline) setSaveStatus('saving');
          replaceHistory(prepared.next);
          return true;
        },
      };
    } catch (error) {
      if (error instanceof BuilderOperationError) {
        return { success: false, message: error.message, code: error.code };
      }
      return {
        success: false,
        message: 'That image change could not be prepared safely.',
      };
    }
  }, [replaceHistory]);

  const undo = useCallback(() => {
    if (preparedTransitionRef.current) return false;
    const current = historyRef.current;
    if (!current) {
      return false;
    }
    const next = undoHistory(current);
    if (next !== current) setSaveStatus('saving');
    replaceHistory(next);
    return next !== current;
  }, [replaceHistory]);

  const redo = useCallback(() => {
    if (preparedTransitionRef.current) return false;
    const current = historyRef.current;
    if (!current) {
      return false;
    }
    const next = redoHistory(current);
    if (next !== current) setSaveStatus('saving');
    replaceHistory(next);
    return next !== current;
  }, [replaceHistory]);

  const resetLab = useCallback(() => {
    if (preparedTransitionRef.current) return false;
    try {
      window.localStorage.removeItem(SITE_BUILDER_STORAGE_KEY);
    } catch {
      setLoadIssues(['The saved site could not be cleared from this browser.']);
      setSaveStatus('error');
      return false;
    }
    setLoadIssues([]);
    setSaveStatus('idle');
    replaceHistory(null);
    return true;
  }, [replaceHistory]);

  const resetToStarter = useCallback(() => {
    if (preparedTransitionRef.current) return false;
    const current = historyRef.current;
    if (!current) {
      return false;
    }
    const next = createHistoryState(initializeStarter(current.present.originStarter, { siteName: current.present.siteName }));
    setLoadIssues([]);
    setSaveStatus('saving');
    replaceHistory(next);
    return true;
  }, [replaceHistory]);

  const importJson = useCallback((json: string): ImportResult => {
    if (preparedTransitionRef.current) {
      return {
        success: false,
        issues: ['Finish the current image upload before importing a backup.'],
      };
    }
    const result = parseSiteBuilderDocument(json);
    if (!result.success) {
      return result;
    }
    setLoadIssues([]);
    setSaveStatus('saving');
    replaceHistory(createHistoryState(result.document));
    return result;
  }, [replaceHistory]);

  const exportJson = useCallback(() => {
    const current = historyRef.current;
    return current ? exportSiteBuilderBackup(current.present) : null;
  }, []);

  const getReachableAssetIds = useCallback((): ReadonlySet<string> => {
    const current = historyRef.current;
    return current
      ? collectReachableCustomDesignAssetIds(current)
      : new Set<string>();
  }, []);

  const getHistorySnapshot = useCallback((): HistoryState | null =>
    historyRef.current, []);

  const createHistoryCheckpoint = useCallback(() => historyRef.current, []);

  const restoreHistoryCheckpoint = useCallback((checkpoint: HistoryState) => {
    if (preparedTransitionRef.current) return false;
    setSaveStatus('saving');
    replaceHistory(checkpoint);
    return true;
  }, [replaceHistory]);

  useEffect(() => {
    const document = history?.present;
    if (!document) {
      return undefined;
    }

    setSaveStatus('saving');
    const timeout = window.setTimeout(() => {
      try {
        window.localStorage.setItem(
          SITE_BUILDER_STORAGE_KEY,
          exportSiteBuilderDocument(document),
        );
        setSaveStatus('saved');
      } catch {
        setSaveStatus('error');
      }
    }, 180);

    return () => window.clearTimeout(timeout);
  }, [history?.present]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey)) {
        return;
      }
      const target = event.target as HTMLElement | null;
      if (target?.matches('input, textarea, select, [contenteditable="true"]')) {
        return;
      }
      const key = event.key.toLowerCase();
      if (key === 'z' && event.shiftKey) {
        event.preventDefault();
        redo();
      } else if (key === 'z') {
        event.preventDefault();
        undo();
      } else if (key === 'y') {
        event.preventDefault();
        redo();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [redo, undo]);

  return {
    acceptOnboardingPresentation,
    canRedo: !transactionPending && history ? canRedoHistory(history) : false,
    canUndo: !transactionPending && history ? canUndoHistory(history) : false,
    chooseStarter,
    createStarterOnce,
    createHistoryCheckpoint,
    document: history?.present ?? null,
    exportJson,
    getHistorySnapshot,
    getReachableAssetIds,
    historyRevision,
    importJson,
    loadIssues,
    prepareCommand,
    redo,
    resetLab,
    resetToStarter,
    restoreHistoryCheckpoint,
    runCommand,
    saveStatus,
    syncSiteName,
    transactionPending,
    undo,
  };
}

export type LabDocumentController = ReturnType<typeof useLabDocument>;
