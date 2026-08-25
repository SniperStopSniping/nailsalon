export type EditorConceptId =
  | 'canvas_first'
  | 'dark_studio'
  | 'mobile_first'
  | 'split_workspace'
  | 'inline_editor';

export type EditorConcept = {
  character: string;
  className: string;
  description: string;
  id: EditorConceptId;
  label: string;
  mobilePattern: string;
  name: string;
  number: 1 | 2 | 3 | 4 | 5;
  palette: string;
  shellPattern: string;
  starterPreview: 'wireframe' | 'miniature';
};

export const EDITOR_CONCEPT_STORAGE_KEY = 'luster.site-builder-v2-lab.ui-concept.schema-1';
export const DEFAULT_EDITOR_CONCEPT_ID: EditorConceptId = 'canvas_first';

export const EDITOR_CONCEPTS = [
  {
    character: 'Quiet, premium, and canvas-led.',
    className: 'editor-concept--canvas-first',
    description: 'A warm, spacious editor with a collapsible page rail and contextual controls that stay out of the website canvas.',
    id: 'canvas_first',
    label: 'Concept 1 — Canvas First',
    mobilePattern: 'Full-width canvas with contextual bottom sheets',
    name: 'Canvas First',
    number: 1,
    palette: 'Ivory · Espresso · Berry',
    shellPattern: 'Narrow page rail · Large canvas · Contextual inspector',
    starterPreview: 'miniature',
  },
  {
    character: 'Focused, expressive, and tool-like.',
    className: 'editor-concept--dark-studio',
    description: 'A charcoal creative studio that presents the light website as an artboard with floating device and section controls.',
    id: 'dark_studio',
    label: 'Concept 2 — Dark Studio',
    mobilePattern: 'Light website canvas framed by compact dark controls',
    name: 'Dark Studio',
    number: 2,
    palette: 'Charcoal · White canvas · Violet berry',
    shellPattern: 'Dark tool rail · Floating viewport controls · Artboard',
    starterPreview: 'wireframe',
  },
  {
    character: 'Friendly, tactile, and phone-native.',
    className: 'editor-concept--mobile-first',
    description: 'A touch-first composition system built around a nearly full-width canvas, large actions, and sheets instead of permanent panels.',
    id: 'mobile_first',
    label: 'Concept 3 — Mobile First',
    mobilePattern: 'Page dropdown · Bottom action bar · Persistent Add section',
    name: 'Mobile First',
    number: 3,
    palette: 'Warm white · Blush · Deep berry',
    shellPattern: 'Centered canvas · Floating panels · Sheet-driven controls',
    starterPreview: 'miniature',
  },
  {
    character: 'Structured, legible, and reassuring.',
    className: 'editor-concept--split-workspace',
    description: 'A crisp workspace that keeps the page-and-section structure visible beside a synchronized live website canvas.',
    id: 'split_workspace',
    label: 'Concept 4 — Split Workspace',
    mobilePattern: 'Canvas first with the complete structure in a sheet',
    name: 'Split Workspace',
    number: 4,
    palette: 'Cool gray · White · Deep wine',
    shellPattern: 'Structure tree · Live canvas · Temporary settings drawer',
    starterPreview: 'wireframe',
  },
  {
    character: 'Direct, invisible, and consumer-friendly.',
    className: 'editor-concept--inline-editor',
    description: 'An ultra-minimal direct-editing experience where the website fills the viewport and editor chrome appears only when requested.',
    id: 'inline_editor',
    label: 'Concept 5 — Inline Editor',
    mobilePattern: 'Website viewport · Floating top bar · Inline selection actions',
    name: 'Inline Editor',
    number: 5,
    palette: 'Website colors · Warm neutral · Minimal berry',
    shellPattern: 'Full website · Floating header · Inline contextual tools',
    starterPreview: 'miniature',
  },
] as const satisfies readonly EditorConcept[];

const EDITOR_CONCEPT_IDS = new Set<EditorConceptId>(EDITOR_CONCEPTS.map((concept) => concept.id));

export const isEditorConceptId = (value: unknown): value is EditorConceptId =>
  typeof value === 'string' && EDITOR_CONCEPT_IDS.has(value as EditorConceptId);

export const getEditorConcept = (id: EditorConceptId): EditorConcept =>
  EDITOR_CONCEPTS.find((concept) => concept.id === id) ?? EDITOR_CONCEPTS[0];
