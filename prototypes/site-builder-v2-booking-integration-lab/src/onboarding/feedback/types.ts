export type FeedbackKind =
  | 'press'
  | 'selection'
  | 'added'
  | 'removed'
  | 'completed'
  | 'stage_complete'
  | 'milestone'
  | 'warning';

export type FeedbackRequest = {
  announce?: boolean;
  kind: FeedbackKind;
  message?: string;
  onceKey?: string;
  preserveOnNavigation?: boolean;
  replaceVisual?: boolean;
  targetId?: string;
  visual?: boolean;
};

export type FeedbackController = {
  clear: () => void;
  clearQueuedVisuals: () => void;
  configure: (options: { reducedMotion: boolean }) => void;
  resetSession: () => void;
  send: (request: FeedbackRequest) => boolean;
  setVisualSuppressed: (suppressed: boolean) => void;
};
