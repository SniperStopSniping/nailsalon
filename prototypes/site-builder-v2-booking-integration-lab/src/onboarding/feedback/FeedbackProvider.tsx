import { Check, CircleAlert, Sparkles } from 'lucide-react';
import {
  createContext,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import { DIALOG_ACTIVITY_EVENT } from '../../ui/dialog-events';
import { LAB_FEEDBACK_CAPABILITY_PORT } from './lab-feedback-port';
import type {
  FeedbackController,
  FeedbackKind,
  FeedbackRequest,
} from './types';

type VisibleFeedback = {
  id: number;
  kind: FeedbackKind;
  message: string;
  targetId?: string;
};

const isMajorFeedback = (kind: FeedbackKind): boolean =>
  kind === 'milestone' || kind === 'stage_complete';

export const FeedbackContext = createContext<FeedbackController | null>(null);

const visualDuration = (kind: FeedbackKind): number => {
  if (kind === 'milestone') return 2_800;
  if (kind === 'stage_complete') return 2_300;
  return 1_750;
};

const FeedbackIcon = ({ kind }: { kind: FeedbackKind }) => {
  if (kind === 'warning') return <CircleAlert aria-hidden="true" size={20} />;
  if (kind === 'milestone' || kind === 'stage_complete') {
    return <Sparkles aria-hidden="true" size={20} />;
  }
  return <Check aria-hidden="true" size={20} />;
};

export function FeedbackProvider({
  children,
  reducedMotion = false,
  testMode = import.meta.env.MODE === 'test',
}: {
  children: ReactNode;
  reducedMotion?: boolean;
  testMode?: boolean;
}) {
  const [visible, setVisible] = useState<VisibleFeedback | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const [configuredReducedMotion, setConfiguredReducedMotion] = useState(false);
  const configuredReducedMotionRef = useRef(false);
  const dialogVisualSuppressedRef = useRef(false);
  const manualVisualSuppressedRef = useRef(false);
  const announcementFrameRef = useRef<number | null>(null);
  const oneTimeKeysRef = useRef(new Set<string>());
  const queuedMajorFeedbackRef = useRef<FeedbackRequest[]>([]);
  const lastAnnouncementRef = useRef({ at: 0, message: '' });
  const idRef = useRef(0);
  const visibleRef = useRef<VisibleFeedback | null>(null);
  const systemReducedMotion = typeof window !== 'undefined'
    && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const motionReduced = reducedMotion || configuredReducedMotion || systemReducedMotion;

  const clear = useCallback(() => {
    if (announcementFrameRef.current !== null) {
      window.cancelAnimationFrame(announcementFrameRef.current);
      announcementFrameRef.current = null;
    }
    queuedMajorFeedbackRef.current = [];
    visibleRef.current = null;
    setVisible(null);
    setAnnouncement('');
  }, []);

  const configure = useCallback((options: { reducedMotion: boolean }) => {
    configuredReducedMotionRef.current = options.reducedMotion;
    setConfiguredReducedMotion(options.reducedMotion);
  }, []);

  const setVisualSuppressed = useCallback((suppressed: boolean) => {
    manualVisualSuppressedRef.current = suppressed;
    if (!suppressed) return;
    queuedMajorFeedbackRef.current = [];
    visibleRef.current = null;
    setVisible(null);
  }, []);

  const resetSession = useCallback(() => {
    if (announcementFrameRef.current !== null) {
      window.cancelAnimationFrame(announcementFrameRef.current);
      announcementFrameRef.current = null;
    }
    oneTimeKeysRef.current.clear();
    queuedMajorFeedbackRef.current = [];
    lastAnnouncementRef.current = { at: 0, message: '' };
    visibleRef.current = null;
    configuredReducedMotionRef.current = false;
    setConfiguredReducedMotion(false);
    setVisible(null);
    setAnnouncement('');
  }, []);

  const present = useCallback((request: FeedbackRequest) => {
    const requestReducedMotion = reducedMotion
      || configuredReducedMotionRef.current
      || systemReducedMotion;
    LAB_FEEDBACK_CAPABILITY_PORT.haptic(request.kind, {
      reducedMotion: requestReducedMotion,
      testMode,
    });
    if (!request.message) return;

    if (request.announce !== false) {
      const now = Date.now();
      const isDuplicate = lastAnnouncementRef.current.message === request.message
        && now - lastAnnouncementRef.current.at < 900;
      if (!isDuplicate) {
        lastAnnouncementRef.current = { at: now, message: request.message };
        setAnnouncement('');
        if (announcementFrameRef.current !== null) {
          window.cancelAnimationFrame(announcementFrameRef.current);
        }
        announcementFrameRef.current = window.requestAnimationFrame(() => {
          announcementFrameRef.current = null;
          setAnnouncement(request.message ?? '');
        });
      }
    }
    if (manualVisualSuppressedRef.current || dialogVisualSuppressedRef.current) return;
    idRef.current += 1;
    const nextVisible = {
      id: idRef.current,
      kind: request.kind,
      message: request.message,
      ...(request.targetId ? { targetId: request.targetId } : {}),
    } satisfies VisibleFeedback;
    visibleRef.current = nextVisible;
    setVisible(nextVisible);
  }, [reducedMotion, systemReducedMotion, testMode]);

  useEffect(() => {
    const suppressDialogVisuals = () => {
      queuedMajorFeedbackRef.current = [];
      visibleRef.current = null;
      setVisible(null);
    };
    const handleDialogActivity = (event: Event) => {
      const active = Boolean((event as CustomEvent<{ active?: boolean }>).detail?.active);
      dialogVisualSuppressedRef.current = active;
      if (active) suppressDialogVisuals();
    };
    dialogVisualSuppressedRef.current = document.documentElement.classList.contains(
      'luster-dialog-open',
    );
    if (dialogVisualSuppressedRef.current) suppressDialogVisuals();
    window.addEventListener(DIALOG_ACTIVITY_EVENT, handleDialogActivity);
    return () => {
      window.removeEventListener(DIALOG_ACTIVITY_EVENT, handleDialogActivity);
      if (announcementFrameRef.current !== null) {
        window.cancelAnimationFrame(announcementFrameRef.current);
        announcementFrameRef.current = null;
      }
    };
  }, []);

  const clearQueuedVisuals = useCallback(() => {
    queuedMajorFeedbackRef.current = [];
  }, []);

  const send = useCallback((request: FeedbackRequest): boolean => {
    if (request.onceKey && oneTimeKeysRef.current.has(request.onceKey)) return false;
    if (request.onceKey) oneTimeKeysRef.current.add(request.onceKey);
    if (request.replaceVisual) {
      queuedMajorFeedbackRef.current = [];
      present(request);
      return true;
    }
    if (
      request.message
      && visibleRef.current
      && isMajorFeedback(visibleRef.current.kind)
      && isMajorFeedback(request.kind)
    ) {
      queuedMajorFeedbackRef.current = [
        ...queuedMajorFeedbackRef.current,
        request,
      ].slice(-3);
      return true;
    }
    present(request);
    return true;
  }, [present]);

  useEffect(() => {
    if (!visible) return undefined;
    const timeout = window.setTimeout(
      () => {
        if (visibleRef.current?.id !== visible.id) return;
        const next = queuedMajorFeedbackRef.current.shift();
        visibleRef.current = null;
        setVisible(null);
        if (next) present(next);
      },
      visualDuration(visible.kind),
    );
    return () => window.clearTimeout(timeout);
  }, [present, visible]);

  const controller = useMemo<FeedbackController>(() => ({
    clear,
    clearQueuedVisuals,
    configure,
    resetSession,
    send,
    setVisualSuppressed,
  }), [clear, clearQueuedVisuals, configure, resetSession, send, setVisualSuppressed]);

  return (
    <FeedbackContext.Provider value={controller}>
      {children}
      <div aria-atomic="true" aria-live="polite" className="visually-hidden" role="status">
        {announcement}
      </div>
      {visible ? (
        <div
          className={`onboarding-feedback is-${visible.kind}${motionReduced ? ' is-reduced-motion' : ''}`}
          data-feedback-target={visible.targetId}
          role="presentation"
        >
          <FeedbackIcon kind={visible.kind} />
          <span>{visible.message}</span>
          {visible.kind === 'milestone' || visible.kind === 'stage_complete' ? (
            <i aria-hidden="true" className="onboarding-feedback__sparkles" />
          ) : null}
        </div>
      ) : null}
    </FeedbackContext.Provider>
  );
}
