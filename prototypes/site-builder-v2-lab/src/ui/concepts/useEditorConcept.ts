import { useCallback, useEffect, useState } from 'react';

import {
  DEFAULT_EDITOR_CONCEPT_ID,
  EDITOR_CONCEPT_STORAGE_KEY,
  getEditorConcept,
  isEditorConceptId,
  type EditorConcept,
  type EditorConceptId,
} from './types';

type UseEditorConceptResult = {
  activeConcept: EditorConcept;
  activeConceptId: EditorConceptId;
  conceptClassName: string;
  selectConcept: (id: EditorConceptId) => void;
};

const readPersistedConcept = (): EditorConceptId => {
  if (typeof window === 'undefined') {
    return DEFAULT_EDITOR_CONCEPT_ID;
  }

  try {
    const persisted = window.localStorage.getItem(EDITOR_CONCEPT_STORAGE_KEY);
    return isEditorConceptId(persisted) ? persisted : DEFAULT_EDITOR_CONCEPT_ID;
  } catch {
    return DEFAULT_EDITOR_CONCEPT_ID;
  }
};

export function useEditorConcept(): UseEditorConceptResult {
  const [activeConceptId, setActiveConceptId] = useState<EditorConceptId>(readPersistedConcept);
  const activeConcept = getEditorConcept(activeConceptId);

  useEffect(() => {
    try {
      window.localStorage.setItem(EDITOR_CONCEPT_STORAGE_KEY, activeConceptId);
    } catch {
      // Concept persistence is optional; the editor remains usable without storage.
    }
  }, [activeConceptId]);

  const selectConcept = useCallback((id: EditorConceptId) => {
    setActiveConceptId(id);
  }, []);

  return {
    activeConcept,
    activeConceptId,
    conceptClassName: activeConcept.className,
    selectConcept,
  };
}
