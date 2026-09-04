import { useContext, useMemo } from 'react';

import { FeedbackContext } from './FeedbackProvider';
import type { FeedbackController } from './types';

const NOOP_FEEDBACK: FeedbackController = {
  clear: () => {},
  clearQueuedVisuals: () => {},
  configure: () => {},
  resetSession: () => {},
  send: () => false,
  setVisualSuppressed: () => {},
};

export const useFeedback = (): FeedbackController => {
  const controller = useContext(FeedbackContext);
  return useMemo(() => controller ?? NOOP_FEEDBACK, [controller]);
};
