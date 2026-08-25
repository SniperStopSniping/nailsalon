import { useCallback, useEffect, useRef, useState } from 'react';

import {
  BuilderOperationError,
  SITE_BUILDER_STORAGE_KEY,
  applyHistoryCommand,
  canRedoHistory,
  canUndoHistory,
  createHistoryState,
  exportSiteBuilderDocument,
  initializeStarter,
  parseSiteBuilderDocument,
  redoHistory,
  undoHistory,
  type BuilderCommand,
  type HistoryState,
  type OriginStarter,
  type SiteBuilderDocument,
} from '../model';

type CommandResult =
  | { success: true; document: SiteBuilderDocument; changed: boolean }
  | { success: false; message: string; code?: string };

type ImportResult =
  | { success: true; document: SiteBuilderDocument }
  | { success: false; issues: string[] };

type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

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

  const replaceHistory = useCallback((next: HistoryState | null) => {
    historyRef.current = next;
    setHistory(next);
  }, []);

  const chooseStarter = useCallback((starter: OriginStarter) => {
    const next = createHistoryState(initializeStarter(starter, { siteName: 'Luster Studio' }));
    setLoadIssues([]);
    replaceHistory(next);
  }, [replaceHistory]);

  const runCommand = useCallback((command: BuilderCommand): CommandResult => {
    const current = historyRef.current;
    if (!current) {
      return { success: false, message: 'Choose a starting point first.' };
    }

    try {
      const next = applyHistoryCommand(current, command);
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

  const undo = useCallback(() => {
    const current = historyRef.current;
    if (!current) {
      return false;
    }
    const next = undoHistory(current);
    replaceHistory(next);
    return next !== current;
  }, [replaceHistory]);

  const redo = useCallback(() => {
    const current = historyRef.current;
    if (!current) {
      return false;
    }
    const next = redoHistory(current);
    replaceHistory(next);
    return next !== current;
  }, [replaceHistory]);

  const resetLab = useCallback(() => {
    try {
      window.localStorage.removeItem(SITE_BUILDER_STORAGE_KEY);
    } catch {
      // The in-memory Lab can still reset if browser storage is unavailable.
    }
    setLoadIssues([]);
    setSaveStatus('idle');
    replaceHistory(null);
  }, [replaceHistory]);

  const resetToStarter = useCallback(() => {
    const current = historyRef.current;
    if (!current) {
      return;
    }
    const next = createHistoryState(initializeStarter(current.present.originStarter, { siteName: current.present.siteName }));
    setLoadIssues([]);
    replaceHistory(next);
  }, [replaceHistory]);

  const importJson = useCallback((json: string): ImportResult => {
    const result = parseSiteBuilderDocument(json);
    if (!result.success) {
      return result;
    }
    setLoadIssues([]);
    replaceHistory(createHistoryState(result.document));
    return result;
  }, [replaceHistory]);

  const exportJson = useCallback(() => {
    const current = historyRef.current;
    return current ? exportSiteBuilderDocument(current.present) : null;
  }, []);

  const createHistoryCheckpoint = useCallback(() => historyRef.current, []);

  const restoreHistoryCheckpoint = useCallback((checkpoint: HistoryState) => {
    replaceHistory(checkpoint);
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
    canRedo: history ? canRedoHistory(history) : false,
    canUndo: history ? canUndoHistory(history) : false,
    chooseStarter,
    createHistoryCheckpoint,
    document: history?.present ?? null,
    exportJson,
    importJson,
    loadIssues,
    redo,
    resetLab,
    resetToStarter,
    restoreHistoryCheckpoint,
    runCommand,
    saveStatus,
    undo,
  };
}
