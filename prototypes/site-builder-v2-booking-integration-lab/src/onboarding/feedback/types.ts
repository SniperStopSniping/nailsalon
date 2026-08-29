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
  targetId?: string;
};

export type FeedbackController = {
  clear: () => void;
  configure: (options: { reducedMotion: boolean }) => void;
  resetSession: () => void;
  send: (request: FeedbackRequest) => boolean;
};
