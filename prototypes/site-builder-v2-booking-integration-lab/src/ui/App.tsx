import {
  AlertTriangle,
  ArrowLeft,
  Check,
  ChevronDown,
  Eye,
  Laptop,
  Maximize2,
  Menu,
  Minimize2,
  MoreHorizontal,
  Move,
  Pencil,
  Plus,
  Redo2,
  Save,
  Smartphone,
  Tablet,
  Trash2,
  Undo2,
} from 'lucide-react';
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
} from 'react';

import {
  createEmptyBookingSession,
  createMenuFixture,
  normalizeBookingSelection,
  normalizeSessionForLayoutChange,
} from '../booking/helpers';
import { BookingSettingsPanel } from '../booking/SettingsPanel';
import type {
  BookingSectionPresentationSettings,
  BookingSessionState,
  BookingTokenPresetId,
  ImageFixture,
  MenuSize,
} from '../booking/types';
import {
  CustomDesignAssetProvider,
  useCustomDesignAssetCoordinator,
  useCustomDesignAssetMap,
  useCustomDesignAssetStorageError,
} from '../custom-design/integration/CustomDesignAssetProvider';
import {
  CustomDesignOwnerEditor,
} from '../custom-design/integration/CustomDesignOwnerEditor';
import {
  CustomDesignSectionCard,
} from '../custom-design/integration/CustomDesignSectionCard';
import { HotspotEditor } from '../custom-design/integration/HotspotEditor';
import {
  getCustomDesignReadiness,
} from '../custom-design/integration/readiness';
import {
  resolveCustomDesignDocumentAction,
} from '../custom-design/integration/document-actions';
import { formatCustomDesignUploadSummary } from '../custom-design/integration/upload-summary';
import type {
  CustomDesignOwnerAssetMap,
  CustomDesignReadinessIssue,
  CustomDesignUploadStatus,
} from '../custom-design/integration/ui-types';
import {
  createCustomDesignIdFactory,
  reconcileCtaPlacementForImages,
  type CustomDesignInteractiveArea,
  type CustomDesignSettings,
} from '../custom-design/model';
import {
  isLibrarySectionType,
  type BuilderCommand,
  type CatalogueSectionType,
  type CommitSectionMoveDestination,
  type OriginStarter,
  type PageDocument,
  type PlaceholderSectionInstance,
  type SectionInstance,
  type SectionSize,
  type SiteBuilderDocument,
} from '../model';
import {
  getOnboardingReferencedAssetIds,
  OnboardingApp,
} from '../onboarding/OnboardingApp';
import { FeedbackProvider } from '../onboarding/feedback/FeedbackProvider';
import { DashboardPreviewSurface } from '../onboarding/integrations/lab/DashboardPreviewSurface';
import { LAB_DASHBOARD_HANDOFF_PORT } from '../onboarding/integrations/lab/createLabDashboardPorts';
import { createOnboardingBookingFixture } from '../onboarding/model/booking-preview';
import {
  loadOnboardingState,
  ONBOARDING_STORAGE_KEY,
  saveOnboardingState,
} from '../onboarding/storage/storage';
import { BookingSectionCard, type BookingCollapseReport } from './BookingSectionCard';
import {
  getCustomDesignInternalTargets,
  toCustomDesignOwnerAssetMap,
} from './custom-design-adapters';
import { Dialog } from './Dialog';
import {
  isEscapeHandledInsideActiveControl,
  keepEscapeInsideActiveControl,
} from './dialog-events';
import {
  AddPageDialog,
  AlertDialog,
  ConfirmationDialog,
  LabOptionsDialog,
  NavigationPromptDialog,
  PageSettingsDialog,
  SectionLibraryDialog,
  SectionSettingsDialog,
  StartAgainDialog,
} from './EditorDialogs';
import { FinalStructurePanel } from './FinalStructurePanel';
import {
  createMoveCompletionBounds,
  createMoveCompletionShield,
  decideMoveCompletionPointerInteraction,
  MOVE_COMPLETION_SEQUENCE_HARD_CAP_MS,
  MOVE_COMPLETION_SHIELD_DURATION_MS,
  moveCompletionShieldIsActive,
  type MoveCompletionPointerType,
  type MoveCompletionShield,
  type MoveCompletionSource,
} from './move-completion-shield';
import { createOnboardingClientBusinessMetadata } from './onboarding-business-metadata';
import { Preview } from './Preview';
import { SectionCard } from './SectionCard';
import { SectionMovePanel } from './SectionMovePanel';
import { StarterChooser } from './StarterChooser';
import { getSectionOwnerIdentity } from './section-identity';
import { useLabDocument } from './useLabDocument';

type EditorMode = 'edit' | 'preview';
type PreviewViewport = 'desktop' | 'tablet' | 'mobile';
type ToastState = { message: string; undoable?: boolean } | null;
type PendingMoveFeedback = { announcement: string; message: string } | null;
type PendingMoveFocus = {
  initialSectionId: string;
  kind: 'commit' | 'restore';
  targetSectionId: string;
};
type ResetChoice = 'lab' | 'starter' | null;
type CustomDesignImageOrderDraft = {
  baselineImageItemIds: string[];
  orderedImageItemIds: string[];
  sectionId: string;
};
type MoveSession = {
  baselineOrder: string[];
  destination: CommitSectionMoveDestination | null;
  entry: 'arrange' | 'section';
  initialSectionId: string;
  sourcePageId: string;
  targetSectionId: string;
  workingOrder: string[];
};
type MoveCompletionActivation = {
  button: number;
  control: HTMLElement;
  eventTimestamp: number;
  pointerType: MoveCompletionPointerType;
};
type MoveCompletionEvent = {
  button: number;
  control: HTMLButtonElement;
  detail: number;
  eventTimestamp: number;
};
type MoveCompletionSequence = {
  shield: MoveCompletionShield;
  until: number;
};

const getOwnerCustomDesignReadiness = (
  settings: CustomDesignSettings,
  assets: CustomDesignOwnerAssetMap,
  document: SiteBuilderDocument,
  activePageId: string,
): CustomDesignReadinessIssue[] => getCustomDesignReadiness(settings, {
  getAssetAvailability: (assetId) => {
    const asset = assets[assetId];
    if (!asset || asset.status === 'loading' || asset.status === 'ready') return 'available';
    return asset.status === 'missing' ? 'missing' : 'error';
  },
  resolveAction: (action) => resolveCustomDesignDocumentAction(action, {
    activePageId,
    document,
  }),
}).issues;

const getHomeOrFirstPage = (document: SiteBuilderDocument): PageDocument =>
  document.pages.find((page) => page.isHome) ?? document.pages[0] as PageDocument;

const findSectionPage = (document: SiteBuilderDocument, sectionId: string): PageDocument | null =>
  document.pages.find((page) => page.sections.some((section) => section.id === sectionId)) ?? null;

const findSection = (document: SiteBuilderDocument, sectionId: string | null): SectionInstance | null => {
  if (!sectionId) {
    return null;
  }
  for (const page of document.pages) {
    const section = page.sections.find((candidate) => candidate.id === sectionId);
    if (section) {
      return section;
    }
  }
  return null;
};

const starterLabel = (starter: OriginStarter): string => ({
  quick_book: 'Quick Book',
  one_page: 'One-page website',
  multi_page: 'Multi-page website',
})[starter];

const restoreOuterEditorTop = () => {
  window.scrollTo({ behavior: 'auto', left: 0, top: 0 });
};

const canReceiveProgrammaticFocus = (element: HTMLElement | null): element is HTMLElement => {
  if (
    !element
    || !element.isConnected
    || element === window.document.body
    || element === window.document.documentElement
    || element.matches(':disabled')
    || element.closest('[aria-hidden="true"], [hidden], [inert]')
  ) {
    return false;
  }

  let current: HTMLElement | null = element;
  while (current) {
    const style = window.getComputedStyle(current);
    if (style.display === 'none' || style.visibility === 'hidden') {
      return false;
    }
    current = current.parentElement;
  }
  return true;
};

const findFocusableByAttribute = (attribute: string, value: string): HTMLElement | null => (
  [...window.document.querySelectorAll<HTMLElement>(`[${attribute}]`)]
    .find((candidate) => (
      candidate.getAttribute(attribute) === value
      && canReceiveProgrammaticFocus(candidate)
    )) ?? null
);

const restoreVisibleFocus = (element: HTMLElement | null): boolean => {
  if (!canReceiveProgrammaticFocus(element)) return false;
  element.focus({ preventScroll: true });
  element.setAttribute('data-restored-focus', 'true');
  element.addEventListener('blur', () => {
    element.removeAttribute('data-restored-focus');
  }, { once: true });
  return window.document.activeElement === element;
};

type LabDocumentController = ReturnType<typeof useLabDocument>;

const getInitialSurface = (): 'builder' | 'dashboard' | 'onboarding' => {
  const search = new URLSearchParams(window.location.search);
  const builderTestHarnessEnabled = import.meta.env.MODE === 'test'
    || import.meta.env.VITE_LUSTER_BUILDER_TEST_HARNESS === '1'
    || search.get('audit') === '1'
    || search.get('labReview') === '1';
  if (
    builderTestHarnessEnabled
    && search.get('surface') === 'builder'
  ) {
    return 'builder';
  }
  const loaded = loadOnboardingState();
  if (
    loaded.status === 'loaded'
    && loaded.state.progress.sessionStatus === 'dashboard'
  ) return 'dashboard';
  if (import.meta.env.MODE !== 'test') return 'onboarding';
  try {
    return window.localStorage.getItem(ONBOARDING_STORAGE_KEY) ? 'onboarding' : 'builder';
  } catch {
    return 'builder';
  }
};

const getAuditMode = (): boolean => {
  const search = new URLSearchParams(window.location.search);
  return import.meta.env.MODE === 'test'
    || search.get('audit') === '1'
    || search.get('labReview') === '1';
};

export function App() {
  const lab = useLabDocument();
  const auditMode = getAuditMode();
  const [surface, setSurface] = useState<'builder' | 'dashboard' | 'onboarding' | 'review'>(getInitialSurface);
  const getReachableAssetIds = useCallback(() => {
    const reachable = new Set(lab.getReachableAssetIds());
    const loaded = loadOnboardingState();
    if (loaded.status === 'loaded') {
      getOnboardingReferencedAssetIds(loaded.state)
        .forEach((assetId) => reachable.add(assetId));
    }
    return reachable;
  }, [lab.getReachableAssetIds]);
  return (
    <CustomDesignAssetProvider getReachableAssetIds={getReachableAssetIds}>
      <FeedbackProvider>
        {surface === 'dashboard' ? (
          <DashboardHandoffSurface
            auditMode={auditMode}
            lab={lab}
            onEditWebsite={() => setSurface('builder')}
            onReturnToReview={() => setSurface('review')}
          />
        ) : surface === 'builder' ? (
          <div className="onboarding-builder-surface">
            <button
              className="onboarding-builder-return"
              type="button"
              onClick={() => setSurface('dashboard')}
            >
              Back to dashboard
            </button>
            <BuilderApp lab={lab} />
          </div>
        ) : (
          <OnboardingApp
            auditMode={auditMode}
            forceReview={surface === 'review'}
            lab={lab}
            onEnterDashboard={() => setSurface('dashboard')}
          />
        )}
      </FeedbackProvider>
    </CustomDesignAssetProvider>
  );
}

function DashboardHandoffSurface({
  auditMode,
  lab,
  onEditWebsite,
  onReturnToReview,
}: {
  auditMode: boolean;
  lab: LabDocumentController;
  onEditWebsite: () => void;
  onReturnToReview: () => void;
}) {
  const initial = useMemo(() => loadOnboardingState(), []);
  const [state, setState] = useState(initial.state);
  const updateTourCompleted = useCallback((tourCompleted: boolean) => {
    setState((current) => {
      const next = {
        ...current,
        dashboardHandoff: {
          ...current.dashboardHandoff,
          tourCompleted,
        },
      };
      saveOnboardingState(next);
      return next;
    });
  }, []);
  const returnToOnboardingReview = useCallback(() => {
    const reviewState = LAB_DASHBOARD_HANDOFF_PORT.prepareOnboardingReview(state);
    const saved = saveOnboardingState(reviewState);
    setState(saved.success ? saved.state : reviewState);
    onReturnToReview();
  }, [onReturnToReview, state]);

  return (
    <DashboardPreviewSurface
      auditMode={auditMode}
      document={lab.document}
      fixtures={state.dashboardHandoff.checklistFixtures}
      onEditWebsite={onEditWebsite}
      onReturnToReview={returnToOnboardingReview}
      onTourCompletedChange={updateTourCompleted}
      planIntent={state.planOffer.planIntent}
      profile={state.profile}
      reducedMotion={state.reviewOptions.reducedMotion}
      selectedServiceIds={state.profile.serviceMenu.selectedServiceIds}
      tourCompleted={state.dashboardHandoff.tourCompleted}
    />
  );
}

function BuilderApp({ lab }: { lab: LabDocumentController }) {
  const document = lab.document;
  const customDesignAssetCoordinator = useCustomDesignAssetCoordinator();
  const customDesignStorageError = useCustomDesignAssetStorageError();
  const customDesignIdFactoryRef = useRef(createCustomDesignIdFactory());
  const [activePageId, setActivePageId] = useState<string | null>(null);
  const [selectedSectionId, setSelectedSectionId] = useState<string | null>(null);
  const [mode, setMode] = useState<EditorMode>('edit');
  const [viewport, setViewport] = useState<PreviewViewport>('desktop');
  const [libraryPosition, setLibraryPosition] = useState<number | null>(null);
  const [editingSectionId, setEditingSectionId] = useState<string | null>(null);
  const [moveSession, setMoveSession] = useState<MoveSession | null>(null);
  const [moveDismissPending, setMoveDismissPending] = useState(false);
  const [editingPageId, setEditingPageId] = useState<string | null>(null);
  const [pendingPageRemovalId, setPendingPageRemovalId] = useState<string | null>(null);
  const [addPageOpen, setAddPageOpen] = useState(false);
  const [navigationPromptOpen, setNavigationPromptOpen] = useState(false);
  const [structureOpen, setStructureOpen] = useState(false);
  const [mobileActionsOpen, setMobileActionsOpen] = useState(false);
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [startAgainOpen, setStartAgainOpen] = useState(false);
  const [resetChoice, setResetChoice] = useState<ResetChoice>(null);
  const [alertMessage, setAlertMessage] = useState<string | null>(null);
  const [alertTitle, setAlertTitle] = useState('That change isn’t available');
  const [toast, setToast] = useState<ToastState>(null);
  const [pendingMoveFeedback, setPendingMoveFeedback] = useState<PendingMoveFeedback>(null);
  const [announcement, setAnnouncement] = useState('');
  const [previewAnnouncement, setPreviewAnnouncement] = useState('');
  const [realHeightSimulation, setRealHeightSimulation] = useState(false);
  const [imageFixture, setImageFixture] = useState<ImageFixture>('image_rich');
  const [menuSize, setMenuSize] = useState<MenuSize>('canonical');
  const [tokenPreset, setTokenPreset] = useState<BookingTokenPresetId>('warm');
  const [bookingSession, setBookingSession] = useState<BookingSessionState>(
    createEmptyBookingSession,
  );
  const [bookingCollapseOverrides, setBookingCollapseOverrides] = useState<Record<string, boolean | undefined>>({});
  const [bookingCollapseReports, setBookingCollapseReports] = useState<Record<string, BookingCollapseReport>>({});
  const [customDesignUploadStatuses, setCustomDesignUploadStatuses] = useState<
    Record<string, CustomDesignUploadStatus | undefined>
  >({});
  const [customDesignRenderErrorAssetIds, setCustomDesignRenderErrorAssetIds] = useState<
    ReadonlySet<string>
  >(() => new Set());
  const [customDesignImageOrderDraft, setCustomDesignImageOrderDraft] = useState<
    CustomDesignImageOrderDraft | null
  >(null);
  const [customDesignOrderDismissPending, setCustomDesignOrderDismissPending] = useState(false);
  const [hotspotImageItemId, setHotspotImageItemId] = useState<string | null>(null);
  const [selectedSectionIntersects, setSelectedSectionIntersects] = useState(true);
  const [selectedSectionIntersectionReady, setSelectedSectionIntersectionReady] = useState(false);
  const [desktopSettings, setDesktopSettings] = useState(() => window.matchMedia('(min-width: 900px)').matches);
  const [settingsTemporarilyHidden, setSettingsTemporarilyHidden] = useState(false);
  const editorAppRef = useRef<HTMLDivElement>(null);
  const builderInitialFocusCompleteRef = useRef(false);
  const topbarRef = useRef<HTMLElement>(null);
  const bookingSettingsDrawerRef = useRef<HTMLElement>(null);
  const bookingSettingsHeadingRef = useRef<HTMLHeadingElement>(null);
  const bookingSettingsHideRef = useRef<HTMLButtonElement>(null);
  const bookingSettingsNativeSelectRef = useRef<HTMLSelectElement | null>(null);
  const bookingSettingsShowRef = useRef<HTMLButtonElement>(null);
  const bookingSettingsTriggerRef = useRef<HTMLElement | null>(null);
  const customDesignSettingsDrawerRef = useRef<HTMLElement>(null);
  const customDesignSettingsHeadingRef = useRef<HTMLHeadingElement>(null);
  const customDesignSettingsTriggerRef = useRef<HTMLElement | null>(null);
  const customDesignOrderDismissTriggerRef = useRef<HTMLElement | null>(null);
  const customDesignOrderResolutionInFlightRef = useRef(false);
  const previousDesktopSettingsRef = useRef(desktopSettings);
  const moveInvocationRef = useRef<HTMLElement | null>(null);
  const moveCommitInFlightRef = useRef(false);
  const moveCompletionShieldRef = useRef<MoveCompletionShield | null>(null);
  const moveCompletionShieldTimeoutRef = useRef<number | null>(null);
  const moveCompletionSequenceRef = useRef<MoveCompletionSequence | null>(null);
  const moveLastActivationRef = useRef<MoveCompletionActivation | null>(null);
  const pendingMoveFocusRef = useRef<PendingMoveFocus | null>(null);
  const pendingEditorTopRestoreRef = useRef(false);
  const previewAnnouncementTokenRef = useRef(0);
  const [moveFocusRequest, setMoveFocusRequest] = useState(0);
  const [contextTop, setContextTop] = useState(86);

  useEffect(() => {
    if (!document || builderInitialFocusCompleteRef.current) return undefined;
    const frame = window.requestAnimationFrame(() => {
      const startHeading = editorAppRef.current?.querySelector<HTMLElement>(
        '[data-builder-start]',
      );
      if (!startHeading) return;
      startHeading.focus({ preventScroll: true });
      builderInitialFocusCompleteRef.current = true;
    });
    return () => window.cancelAnimationFrame(frame);
  }, [document]);

  const releaseMoveCompletionShield = useCallback(() => {
    if (moveCompletionShieldTimeoutRef.current !== null) {
      window.clearTimeout(moveCompletionShieldTimeoutRef.current);
      moveCompletionShieldTimeoutRef.current = null;
    }
    moveCompletionShieldRef.current = null;
    moveCompletionSequenceRef.current = null;
  }, []);

  const armMoveCompletionShield = useCallback((
    completionSource: MoveCompletionSource,
    focusTargetSectionId: string,
    completionEvent: MoveCompletionEvent,
  ) => {
    const rect = completionEvent.control.getBoundingClientRect();
    const recordedActivation = moveLastActivationRef.current;
    const activationMatchesControl = recordedActivation
      && recordedActivation.control === completionEvent.control
      && Math.abs(completionEvent.eventTimestamp - recordedActivation.eventTimestamp) < 1_000
      ? recordedActivation
      : null;
    if (rect.width <= 0 || rect.height <= 0) {
      releaseMoveCompletionShield();
      return;
    }

    const startedAt = window.performance.now();
    const keyboardCompletion = completionEvent.detail === 0;
    const shield = createMoveCompletionShield({
      bounds: createMoveCompletionBounds(rect),
      button: keyboardCompletion
        ? 0
        : activationMatchesControl?.button ?? completionEvent.button,
      completionSource,
      eventTimestamp: completionEvent.eventTimestamp,
      focusTargetSectionId,
      pointerType: keyboardCompletion
        ? 'keyboard'
        : activationMatchesControl?.pointerType ?? 'mouse',
      startedAt,
    });
    releaseMoveCompletionShield();
    moveCompletionShieldRef.current = shield;
    const releaseWhenIdle = () => {
      if (moveCompletionShieldRef.current !== shield) return;
      const now = window.performance.now();
      const sequence = moveCompletionSequenceRef.current;
      if (sequence?.shield === shield && now < sequence.until) {
        moveCompletionShieldTimeoutRef.current = window.setTimeout(
          releaseWhenIdle,
          Math.max(1, sequence.until - now),
        );
        return;
      }
      releaseMoveCompletionShield();
    };
    moveCompletionShieldTimeoutRef.current = window.setTimeout(
      releaseWhenIdle,
      MOVE_COMPLETION_SHIELD_DURATION_MS,
    );
  }, [releaseMoveCompletionShield]);

  const readMoveCompletionEvent = (
    event: ReactMouseEvent<HTMLButtonElement>,
  ): MoveCompletionEvent => ({
    button: event.nativeEvent.button,
    control: event.currentTarget,
    detail: event.nativeEvent.detail,
    eventTimestamp: event.nativeEvent.timeStamp,
  });

  const onboardingHandoffState = useMemo(() => {
    const loaded = loadOnboardingState();
    return loaded.status === 'loaded'
      && (loaded.state.progress.sessionStatus === 'builder'
        || loaded.state.progress.sessionStatus === 'dashboard')
      ? loaded.state
      : null;
  }, [document?.siteName]);
  const onboardingProfile = onboardingHandoffState?.profile ?? null;
  const onboardingBusinessMetadata = useMemo(
    () => onboardingHandoffState
      ? createOnboardingClientBusinessMetadata(onboardingHandoffState)
      : undefined,
    [onboardingHandoffState],
  );
  const bookingFixture = useMemo(() => {
    const fixture = createMenuFixture({ imageFixture, menuSize });
    if (!onboardingProfile) return fixture;
    return createOnboardingBookingFixture({
      ...onboardingProfile,
      businessName: document?.siteName ?? onboardingProfile.businessName,
    }, fixture);
  }, [document?.siteName, imageFixture, menuSize, onboardingProfile]);

  const committedActivePage = document
    ? document.pages.find((page) => page.id === activePageId) ?? getHomeOrFirstPage(document)
    : null;
  const selectedSection = document ? findSection(document, selectedSectionId) : null;
  const editingSection = document ? findSection(document, editingSectionId) : null;
  const editingBooking = editingSection?.sectionType === 'booking' ? editingSection : null;
  const mobileBookingSettingsModalOpen = editingBooking !== null && !desktopSettings;
  const editingCustomDesign = editingSection?.sectionType === 'custom_design'
    ? editingSection
    : null;
  const committedCustomDesignImageItemIds = editingCustomDesign
    ? editingCustomDesign.settings.images.map(image => image.id)
    : [];
  const committedCustomDesignImageOrderKey = committedCustomDesignImageItemIds.join('|');
  const activeCustomDesignImageOrderDraft = editingCustomDesign
    && customDesignImageOrderDraft?.sectionId === editingCustomDesign.id
    ? customDesignImageOrderDraft
    : null;
  const customDesignImageOrderDirty = Boolean(
    activeCustomDesignImageOrderDraft
    && (
      activeCustomDesignImageOrderDraft.orderedImageItemIds.length
        !== activeCustomDesignImageOrderDraft.baselineImageItemIds.length
      || activeCustomDesignImageOrderDraft.orderedImageItemIds.some(
        (id, index) => id !== activeCustomDesignImageOrderDraft.baselineImageItemIds[index],
      )
    ),
  );
  const mobileCustomDesignSettingsModalOpen = editingCustomDesign !== null && !desktopSettings;
  const editingPlaceholder = editingSection
    && editingSection.sectionType !== 'booking'
    && editingSection.sectionType !== 'custom_design'
    && !isLibrarySectionType(editingSection.sectionType)
    ? (editingSection as PlaceholderSectionInstance)
    : null;
  const editingPage = document?.pages.find((page) => page.id === editingPageId) ?? null;
  const pendingPageRemoval = document?.pages.find((page) => page.id === pendingPageRemovalId) ?? null;
  const moveSourcePage = document && moveSession
    ? document.pages.find((page) => page.id === moveSession.sourcePageId) ?? null
    : null;
  const moveSections = useMemo(() => {
    if (!moveSourcePage || !moveSession) return [];
    const byId = new Map(moveSourcePage.sections.map((section) => [section.id, section]));
    return moveSession.workingOrder.flatMap((id, order) => {
      const section = byId.get(id);
      return section ? [{ ...section, order }] : [];
    });
  }, [moveSession, moveSourcePage]);
  const moveDirty = Boolean(
    moveSession
    && (
      moveSession.destination !== null
      || moveSession.workingOrder.some((id, index) => id !== moveSession.baselineOrder[index])
    ),
  );
  const activePage = committedActivePage && moveSession?.sourcePageId === committedActivePage.id
    ? { ...committedActivePage, sections: moveSections }
    : committedActivePage;
  const customDesignAssetIds = useMemo(() => mode === 'edit'
    ? activePage?.sections.flatMap((section) =>
        section.sectionType === 'custom_design'
          ? section.settings.images.map((image) => image.assetId)
          : []) ?? []
    : [], [activePage, mode]);
  const customDesignAssetPairs = useCustomDesignAssetMap(customDesignAssetIds);
  const customDesignAssets = useMemo(() => {
    const resolved = toCustomDesignOwnerAssetMap(customDesignAssetPairs);
    if (customDesignRenderErrorAssetIds.size === 0) return resolved;
    return Object.fromEntries(Object.entries(resolved).map(([assetId, asset]) => [
      assetId,
      customDesignRenderErrorAssetIds.has(assetId)
        ? { status: 'error' as const, reason: 'This design file could not be displayed.' }
        : asset,
    ]));
  }, [customDesignAssetPairs, customDesignRenderErrorAssetIds]);
  const customDesignInternalTargets = useMemo(
    () => document ? getCustomDesignInternalTargets(document) : [],
    [document],
  );

  useEffect(() => {
    if (!editingCustomDesign) return;
    const canonical = editingCustomDesign.settings.images.map(image => image.id);
    setCustomDesignImageOrderDraft((current) => {
      if (!current || current.sectionId !== editingCustomDesign.id) {
        return {
          baselineImageItemIds: canonical,
          orderedImageItemIds: canonical,
          sectionId: editingCustomDesign.id,
        };
      }
      const wasDirty = current.orderedImageItemIds.length
        !== current.baselineImageItemIds.length
        || current.orderedImageItemIds.some(
          (id, index) => id !== current.baselineImageItemIds[index],
        );
      if (!wasDirty) {
        if (
          current.baselineImageItemIds.length === canonical.length
          && current.baselineImageItemIds.every((id, index) => id === canonical[index])
        ) {
          return current;
        }
        return {
          baselineImageItemIds: canonical,
          orderedImageItemIds: canonical,
          sectionId: editingCustomDesign.id,
        };
      }
      const canonicalIds = new Set(canonical);
      const reconciledOrder = current.orderedImageItemIds.filter(id => canonicalIds.has(id));
      canonical.forEach((id) => {
        if (!reconciledOrder.includes(id)) reconciledOrder.push(id);
      });
      return {
        baselineImageItemIds: canonical,
        orderedImageItemIds: reconciledOrder,
        sectionId: editingCustomDesign.id,
      };
    });
  }, [committedCustomDesignImageOrderKey, editingCustomDesign?.id]);

  const reportBookingCollapse = useCallback((sectionId: string, report: BookingCollapseReport) => {
    setBookingCollapseReports((current) => {
      const previous = current[sectionId];
      if (
        previous
        && previous.collapsed === report.collapsed
        && previous.collapseHeight === report.collapseHeight
        && previous.isLong === report.isLong
      ) return current;
      return { ...current, [sectionId]: report };
    });
  }, []);

  useEffect(() => {
    if (!document) {
      setActivePageId(null);
      setSelectedSectionId(null);
      setMode('edit');
      return;
    }
    if (!document.pages.some((page) => page.id === activePageId)) {
      setActivePageId(getHomeOrFirstPage(document).id);
    }
  }, [activePageId, document]);

  useEffect(() => {
    if (!document || !selectedSectionId) {
      return;
    }
    const selectedPage = findSectionPage(document, selectedSectionId);
    if (!selectedPage || selectedPage.id !== activePage?.id) {
      setSelectedSectionId(null);
      setMobileActionsOpen(false);
    }
  }, [activePage?.id, document, selectedSectionId]);

  useLayoutEffect(() => {
    if (!selectedSectionId || mode !== 'edit') {
      setSelectedSectionIntersects(false);
      setSelectedSectionIntersectionReady(false);
      return undefined;
    }
    if (moveSession) {
      setSelectedSectionIntersectionReady(false);
      return undefined;
    }
    const section = window.document.querySelector<HTMLElement>(`[data-section-instance-id="${selectedSectionId}"]`);
    if (!section) {
      setSelectedSectionIntersects(false);
      setSelectedSectionIntersectionReady(true);
      return undefined;
    }
    const bounds = section.getBoundingClientRect();
    const hasMeasuredGeometry = bounds.width > 0 || bounds.height > 0;
    setSelectedSectionIntersects(!hasMeasuredGeometry || (
      bounds.bottom > 0
      && bounds.right > 0
      && bounds.top < window.innerHeight
      && bounds.left < window.innerWidth
    ));
    setSelectedSectionIntersectionReady(true);
    if (typeof IntersectionObserver === 'undefined') return undefined;
    const observer = new IntersectionObserver(([entry]) => {
      setSelectedSectionIntersects(Boolean(entry?.isIntersecting));
    }, { threshold: 0 });
    observer.observe(section);
    return () => observer.disconnect();
  }, [activePage?.id, mode, moveSession, selectedSectionId]);

  useEffect(() => {
    if (!toast) {
      return undefined;
    }
    const timeout = window.setTimeout(() => setToast(null), toast.undoable ? 8_000 : 3_800);
    return () => window.clearTimeout(timeout);
  }, [toast]);

  useEffect(() => {
    setBookingSession((current) => {
      const selection = normalizeBookingSelection(
        current.selection,
        bookingFixture.services,
        bookingFixture.addOns,
      );
      const detailStillExists = current.detailServiceId === null
        || bookingFixture.services.some((service) => service.id === current.detailServiceId);
      return {
        ...current,
        selection,
        detailServiceId: detailStillExists ? current.detailServiceId : null,
        draftAddOnIds: detailStillExists ? current.draftAddOnIds : [],
        handoffOpen: selection.serviceId === null ? false : current.handoffOpen,
      };
    });
  }, [bookingFixture.addOns, bookingFixture.services]);

  useEffect(() => {
    window.document.body.dataset.editorShell = 'final-hybrid';
    return () => {
      delete window.document.body.dataset.editorShell;
    };
  }, []);

  useEffect(() => {
    if (!customDesignAssetCoordinator || lab.transactionPending) return undefined;
    const timeout = window.setTimeout(() => {
      void customDesignAssetCoordinator.cleanupUnreferencedAssets().catch(() => {
        // The owner-facing storage state remains recoverable; cleanup is conservative.
      });
    }, 0);
    return () => window.clearTimeout(timeout);
  }, [customDesignAssetCoordinator, lab.historyRevision, lab.transactionPending]);

  useEffect(() => {
    if (!customDesignAssetCoordinator) return;
    void customDesignAssetCoordinator.reclaimStaleStages().catch(() => {
      // Stale stage reclamation is best effort and never mutates the document.
    });
  }, [customDesignAssetCoordinator]);

  useEffect(() => {
    const media = window.matchMedia('(min-width: 900px)');
    const update = () => setDesktopSettings(media.matches);
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);

  useEffect(() => {
    const topbar = topbarRef.current;
    if (!topbar) return undefined;
    const measure = () => {
      const next = Math.ceil(topbar.getBoundingClientRect().height + 24);
      setContextTop(next);
      window.document.body.style.setProperty('--final-context-top', `${next}px`);
    };
    measure();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    observer?.observe(topbar);
    window.addEventListener('resize', measure);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', measure);
      window.document.body.style.removeProperty('--final-context-top');
    };
  }, [document, mode]);

  useEffect(() => {
    if (!editingBooking) setSettingsTemporarilyHidden(false);
  }, [editingBooking]);

  useEffect(() => {
    const pendingFocus = pendingMoveFocusRef.current;
    if (
      !pendingFocus
      || moveSession
      || moveDismissPending
      || navigationPromptOpen
      || (selectedSectionId !== null && !selectedSectionIntersectionReady)
    ) {
      return undefined;
    }

    const focusFrames = new Set<number>();
    const finishMoveFocus = () => {
      pendingMoveFocusRef.current = null;
      moveInvocationRef.current = null;
    };
    const restoreMoveFocus = (attemptsRemaining: number) => {
      const sectionId = pendingFocus.kind === 'commit'
        ? pendingFocus.targetSectionId
        : pendingFocus.initialSectionId;
      const invocation = moveInvocationRef.current;
      const moveControl = findFocusableByAttribute('data-move-trigger-for', sectionId);
      const sectionReturnControl = findFocusableByAttribute(
        'data-section-return-for',
        sectionId,
      );
      const sectionSurface = [...window.document.querySelectorAll<HTMLElement>('[data-section-instance-id]')]
          .find((candidate) => (
            candidate.dataset.sectionInstanceId === sectionId
            && canReceiveProgrammaticFocus(candidate.querySelector<HTMLElement>('.section-card__select-surface'))
          ))
          ?.querySelector<HTMLElement>('.section-card__select-surface')
        ?? null;
      const fallback = window.document.querySelector<HTMLElement>('.final-topbar__page');
      const candidates = pendingFocus.kind === 'commit'
        ? [moveControl, sectionReturnControl, sectionSurface, invocation, fallback]
        : [invocation, moveControl, sectionReturnControl, sectionSurface, fallback];
      const focusTarget = candidates.find(canReceiveProgrammaticFocus) ?? null;
      if (focusTarget && restoreVisibleFocus(focusTarget)) {
        finishMoveFocus();
        return;
      }
      if (attemptsRemaining > 0) {
        const retryFrame = window.requestAnimationFrame(() => {
          restoreMoveFocus(attemptsRemaining - 1);
        });
        focusFrames.add(retryFrame);
      }
    };
    const focusFrame = window.requestAnimationFrame(() => restoreMoveFocus(3));
    focusFrames.add(focusFrame);

    return () => {
      focusFrames.forEach((frame) => window.cancelAnimationFrame(frame));
    };
  }, [
    activePageId,
    document,
    moveDismissPending,
    moveFocusRequest,
    moveSession,
    navigationPromptOpen,
    selectedSectionId,
    selectedSectionIntersectionReady,
    selectedSectionIntersects,
  ]);

  useEffect(() => {
    if (!pendingMoveFeedback) return;
    if (lab.saveStatus === 'saved') {
      setAnnouncement(pendingMoveFeedback.announcement);
      setToast({ message: pendingMoveFeedback.message });
      setPendingMoveFeedback(null);
    } else if (lab.saveStatus === 'error') {
      setPendingMoveFeedback(null);
    }
  }, [lab.saveStatus, pendingMoveFeedback]);

  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || window.document.querySelector('[role="dialog"]')) {
        return;
      }
      setSelectedSectionId(null);
      setMobileActionsOpen(false);
    };
    window.document.addEventListener('keydown', handleEscape);
    return () => window.document.removeEventListener('keydown', handleEscape);
  }, []);

  useEffect(() => {
    const keyboardActivation = (event: KeyboardEvent): boolean => (
      event.key === 'Enter' || event.key === ' ' || event.key === 'Spacebar'
    );
    const normalizePointerType = (
      pointerType: string,
    ): Exclude<MoveCompletionPointerType, 'keyboard'> => {
      if (pointerType === 'pen' || pointerType === 'touch') return pointerType;
      return 'mouse';
    };
    const recordActivation = (event: Event) => {
      const control = event.target instanceof Element
        ? event.target.closest<HTMLElement>('button, [role="button"]')
        : null;
      const rectangle = control?.getBoundingClientRect();
      if (!control || !rectangle || rectangle.width <= 0 || rectangle.height <= 0) {
        return;
      }

      const previous = moveLastActivationRef.current;
      const recentMatchingPointer = previous?.control === control
        && Math.abs(event.timeStamp - previous.eventTimestamp) < 1_000
        ? previous
        : null;
      let button = recentMatchingPointer?.button ?? 0;
      let pointerType: MoveCompletionPointerType | null = null;
      if (event instanceof KeyboardEvent) {
        if (event.type !== 'keydown' || !keyboardActivation(event)) return;
        pointerType = 'keyboard';
      } else if (typeof PointerEvent !== 'undefined' && event instanceof PointerEvent) {
        if (event.type !== 'pointerdown') return;
        button = event.button;
        pointerType = normalizePointerType(event.pointerType);
      } else if (typeof TouchEvent !== 'undefined' && event instanceof TouchEvent) {
        if (event.type !== 'touchstart') return;
        pointerType = 'touch';
      } else if (event instanceof MouseEvent) {
        if (event.type !== 'mousedown' && event.type !== 'click') return;
        button = recentMatchingPointer?.button ?? event.button;
        pointerType = event.detail === 0
          ? 'keyboard'
          : recentMatchingPointer?.pointerType ?? 'mouse';
      }
      if (!pointerType) return;

      moveLastActivationRef.current = {
        button,
        control,
        eventTimestamp: event.timeStamp,
        pointerType,
      };
    };

    const absorbRapidCompletion = (event: Event) => {
      const now = window.performance.now();
      const shield = moveCompletionShieldRef.current;
      const sequence = moveCompletionSequenceRef.current?.shield === shield
        ? moveCompletionSequenceRef.current
        : null;
      if (!moveCompletionShieldIsActive(shield, now, sequence?.until)) {
        if (shield) releaseMoveCompletionShield();
        recordActivation(event);
        return;
      }

      if (event instanceof KeyboardEvent) {
        if (event.type === 'keydown' && !keyboardActivation(event)) {
          releaseMoveCompletionShield();
          return;
        }
        if (!keyboardActivation(event)) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        return;
      }

      let button = 0;
      let clientX: number | null = null;
      let clientY: number | null = null;
      let pointerType: Exclude<MoveCompletionPointerType, 'keyboard'> = 'mouse';
      if (typeof PointerEvent !== 'undefined' && event instanceof PointerEvent) {
        button = event.button;
        clientX = event.clientX;
        clientY = event.clientY;
        pointerType = normalizePointerType(event.pointerType);
        if (event.type === 'pointermove') {
          const insideBounds = clientX >= shield.bounds.left
            && clientX <= shield.bounds.right
            && clientY >= shield.bounds.top
            && clientY <= shield.bounds.bottom;
          if (!insideBounds) releaseMoveCompletionShield();
          return;
        }
      } else if (typeof TouchEvent !== 'undefined' && event instanceof TouchEvent) {
        const touch = event.touches[0] ?? event.changedTouches[0];
        if (!touch) return;
        clientX = touch.clientX;
        clientY = touch.clientY;
        pointerType = 'touch';
      } else if (event instanceof MouseEvent) {
        button = event.button;
        clientX = event.clientX;
        clientY = event.clientY;
      }
      if (clientX === null || clientY === null) return;

      const decision = decideMoveCompletionPointerInteraction(shield, {
        button,
        clientX,
        clientY,
        now,
        pointerType,
        sequenceUntil: sequence?.until,
      });
      if (decision === 'release') {
        releaseMoveCompletionShield();
        return;
      }
      if (
        event.type === 'mousedown'
        || event.type === 'pointerdown'
        || event.type === 'touchstart'
      ) {
        if (!sequence || now >= sequence.until) {
          moveCompletionSequenceRef.current = {
            shield,
            until: now + MOVE_COMPLETION_SEQUENCE_HARD_CAP_MS,
          };
        }
      }
      event.preventDefault();
      event.stopImmediatePropagation();
      const terminalClick = event.type === 'dblclick'
        || (event instanceof MouseEvent && event.type === 'click' && event.detail !== 2);
      if (terminalClick) {
        moveCompletionSequenceRef.current = null;
        if (!moveCompletionShieldIsActive(shield, now)) {
          releaseMoveCompletionShield();
        }
      }
    };
    const eventTypes = [
      'click',
      'dblclick',
      'mousedown',
      'mouseup',
      'pointerdown',
      'pointermove',
      'pointerup',
      'touchend',
      'touchstart',
    ] as const;
    eventTypes.forEach(type => window.document.addEventListener(
      type,
      absorbRapidCompletion,
      { capture: true, passive: false },
    ));
    window.document.addEventListener('keydown', absorbRapidCompletion, true);
    window.document.addEventListener('keyup', absorbRapidCompletion, true);
    const releaseForGeometryChange = () => releaseMoveCompletionShield();
    const releaseWhenHidden = () => {
      if (window.document.visibilityState === 'hidden') releaseMoveCompletionShield();
    };
    window.addEventListener('hashchange', releaseForGeometryChange);
    window.addEventListener('pagehide', releaseForGeometryChange);
    window.addEventListener('popstate', releaseForGeometryChange);
    window.addEventListener('resize', releaseForGeometryChange);
    window.document.addEventListener('wheel', releaseForGeometryChange, {
      capture: true,
      passive: true,
    });
    window.document.addEventListener('visibilitychange', releaseWhenHidden);
    return () => {
      eventTypes.forEach(type => window.document.removeEventListener(
        type,
        absorbRapidCompletion,
        true,
      ));
      window.document.removeEventListener('keydown', absorbRapidCompletion, true);
      window.document.removeEventListener('keyup', absorbRapidCompletion, true);
      window.removeEventListener('hashchange', releaseForGeometryChange);
      window.removeEventListener('pagehide', releaseForGeometryChange);
      window.removeEventListener('popstate', releaseForGeometryChange);
      window.removeEventListener('resize', releaseForGeometryChange);
      window.document.removeEventListener('wheel', releaseForGeometryChange, true);
      window.document.removeEventListener('visibilitychange', releaseWhenHidden);
      releaseMoveCompletionShield();
    };
  }, [releaseMoveCompletionShield]);

  useEffect(() => {
    if (!moveSession) {
      return undefined;
    }

    const keepHistoryStable = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey)) {
        return;
      }
      const key = event.key.toLowerCase();
      if (key !== 'z' && key !== 'y') {
        return;
      }
      event.preventDefault();
      event.stopImmediatePropagation();
    };

    window.addEventListener('keydown', keepHistoryStable, { capture: true });
    return () => window.removeEventListener('keydown', keepHistoryStable, { capture: true });
  }, [moveSession]);

  useLayoutEffect(() => {
    const app = editorAppRef.current;
    if (
      !app
      || (
        !moveSession
        && !mobileBookingSettingsModalOpen
        && !mobileCustomDesignSettingsModalOpen
      )
    ) {
      return undefined;
    }
    app.setAttribute('inert', '');
    return () => app.removeAttribute('inert');
  }, [mobileBookingSettingsModalOpen, mobileCustomDesignSettingsModalOpen, moveSession]);

  useLayoutEffect(() => {
    if (!document || !pendingEditorTopRestoreRef.current) {
      return;
    }
    pendingEditorTopRestoreRef.current = false;
    restoreOuterEditorTop();
  }, [document]);

  const sortedActiveSections = useMemo(
    () => activePage ? [...activePage.sections].sort((left, right) => left.order - right.order) : [],
    [activePage],
  );
  const canvasNavigationLabels = useMemo(() => {
    if (!document?.navigation.enabled) {
      return [];
    }
    return [...document.navigation.items]
      .sort((left, right) => left.order - right.order)
      .filter((item) => {
        const page = document.pages.find((candidate) => candidate.id === item.pageId);
        return page?.visible && page.visibleInNavigation;
      })
      .map((item) => item.label);
  }, [document]);

  const showError = (message: string, title = 'That change isn’t available') => {
    setAlertTitle(title);
    setAlertMessage(message);
  };

  const execute = (command: BuilderCommand) => {
    const result = lab.runCommand(command);
    if (!result.success) {
      if (result.code === 'booking_required') {
        showError(
          'Your site needs at least one visible way for clients to start booking.',
          'Keep a way to book',
        );
      } else {
        showError(result.message, 'That change isn’t available');
      }
    }
    return result;
  };

  const closeBookingSettings = useCallback(() => {
    const sectionId = editingSectionId;
    bookingSettingsNativeSelectRef.current = null;
    setEditingSectionId(null);
    setSettingsTemporarilyHidden(false);
    window.requestAnimationFrame(() => {
      const invocation = bookingSettingsTriggerRef.current;
      const editControl = sectionId
        ? findFocusableByAttribute('data-booking-settings-trigger-for', sectionId)
        : null;
      const sectionSurface = sectionId
        ? [...window.document.querySelectorAll<HTMLElement>('[data-section-instance-id]')]
          .find((candidate) => candidate.dataset.sectionInstanceId === sectionId)
          ?.querySelector<HTMLElement>('.section-card__select-surface') ?? null
        : null;
      const fallback = window.document.querySelector<HTMLElement>('.final-topbar__page');
      const focusTarget = [invocation, editControl, sectionSurface, fallback]
        .find(canReceiveProgrammaticFocus) ?? null;
      restoreVisibleFocus(focusTarget);
      bookingSettingsTriggerRef.current = null;
    });
  }, [editingSectionId]);

  const finishCustomDesignSettingsClose = useCallback(() => {
    const sectionId = editingSectionId;
    setHotspotImageItemId(null);
    setEditingSectionId(null);
    setCustomDesignOrderDismissPending(false);
    setCustomDesignImageOrderDraft(null);
    setSelectedSectionIntersects(true);
    window.requestAnimationFrame(() => {
      const invocation = customDesignSettingsTriggerRef.current;
      const sectionElement = sectionId
        ? [...window.document.querySelectorAll<HTMLElement>('[data-section-instance-id]')]
          .find((candidate) => candidate.dataset.sectionInstanceId === sectionId)
        : null;
      sectionElement?.scrollIntoView({ behavior: 'auto', block: 'start' });
      window.requestAnimationFrame(() => {
        const editControl = sectionId
          ? findFocusableByAttribute('data-custom-design-settings-trigger-for', sectionId)
          : null;
        const sectionSurface = sectionElement
          ?.querySelector<HTMLElement>('.section-card__select-surface') ?? null;
        const fallback = window.document.querySelector<HTMLElement>('.final-topbar__page');
        restoreVisibleFocus(
          [editControl, invocation, sectionSurface, fallback]
            .find(canReceiveProgrammaticFocus) ?? null,
        );
        customDesignSettingsTriggerRef.current = null;
        customDesignOrderDismissTriggerRef.current = null;
        customDesignOrderResolutionInFlightRef.current = false;
      });
    });
  }, [editingSectionId]);

  const requestCustomDesignSettingsClose = useCallback(() => {
    if (!editingCustomDesign || !customDesignImageOrderDirty) {
      finishCustomDesignSettingsClose();
      return;
    }
    customDesignOrderDismissTriggerRef.current = window.document.activeElement instanceof HTMLElement
      ? window.document.activeElement
      : null;
    customDesignOrderResolutionInFlightRef.current = false;
    setCustomDesignOrderDismissPending(true);
  }, [customDesignImageOrderDirty, editingCustomDesign, finishCustomDesignSettingsClose]);

  const requestSectionLibraryOpen = (position: number) => {
    if (editingCustomDesign && customDesignImageOrderDirty) {
      requestCustomDesignSettingsClose();
      return;
    }
    setLibraryPosition(position);
  };

  const requestLabOptionsOpen = () => {
    if (editingCustomDesign && customDesignImageOrderDirty) {
      requestCustomDesignSettingsClose();
      return;
    }
    setOptionsOpen(true);
  };

  const hideBookingSettings = () => {
    setSettingsTemporarilyHidden(true);
    window.requestAnimationFrame(() => {
      const toolbarEdit = editingBooking
        ? findFocusableByAttribute('data-booking-settings-trigger-for', editingBooking.id)
        : null;
      restoreVisibleFocus(bookingSettingsShowRef.current ?? toolbarEdit);
    });
  };

  const showBookingSettings = () => {
    setSettingsTemporarilyHidden(false);
  };

  useLayoutEffect(() => {
    if (!editingBooking || !desktopSettings || settingsTemporarilyHidden) {
      return;
    }
    restoreVisibleFocus(bookingSettingsHeadingRef.current);
  }, [desktopSettings, editingBooking?.id, settingsTemporarilyHidden]);

  useEffect(() => {
    if (!editingBooking || !desktopSettings || settingsTemporarilyHidden) {
      return undefined;
    }

    const handleSettingsEscape = (event: KeyboardEvent) => {
      const drawer = bookingSettingsDrawerRef.current;
      if (
        event.key !== 'Escape'
        || event.defaultPrevented
        || !drawer?.contains(window.document.activeElement)
        || isEscapeHandledInsideActiveControl(event)
      ) {
        return;
      }
      const higherPriorityDialog = [...window.document.querySelectorAll<HTMLElement>('[role="dialog"][aria-modal="true"]')]
        .find((candidate) => candidate !== drawer);
      if (higherPriorityDialog) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      closeBookingSettings();
    };

    window.document.addEventListener('keydown', handleSettingsEscape);
    return () => window.document.removeEventListener('keydown', handleSettingsEscape);
  }, [closeBookingSettings, desktopSettings, editingBooking, settingsTemporarilyHidden]);

  useLayoutEffect(() => {
    if (!editingCustomDesign || !desktopSettings || hotspotImageItemId) return;
    restoreVisibleFocus(customDesignSettingsHeadingRef.current);
  }, [desktopSettings, editingCustomDesign?.id, hotspotImageItemId]);

  useEffect(() => {
    if (!editingCustomDesign || !desktopSettings) return undefined;
    const handleSettingsEscape = (event: KeyboardEvent) => {
      const drawer = customDesignSettingsDrawerRef.current;
      if (
        event.key !== 'Escape'
        || event.defaultPrevented
        || !drawer?.contains(window.document.activeElement)
        || isEscapeHandledInsideActiveControl(event)
      ) return;
      const higherPriorityDialog = [...window.document.querySelectorAll<HTMLElement>('[role="dialog"][aria-modal="true"]')]
        .find((candidate) => candidate !== drawer);
      if (higherPriorityDialog) return;
      event.preventDefault();
      event.stopPropagation();
      requestCustomDesignSettingsClose();
    };
    window.document.addEventListener('keydown', handleSettingsEscape);
    return () => window.document.removeEventListener('keydown', handleSettingsEscape);
  }, [desktopSettings, editingCustomDesign, requestCustomDesignSettingsClose]);

  useEffect(() => {
    const previousDesktopSettings = previousDesktopSettingsRef.current;
    previousDesktopSettingsRef.current = desktopSettings;
    if (
      previousDesktopSettings !== desktopSettings
      && editingCustomDesign
      && customDesignImageOrderDirty
      && !customDesignOrderDismissPending
    ) {
      requestCustomDesignSettingsClose();
    }
  }, [
    customDesignImageOrderDirty,
    customDesignOrderDismissPending,
    desktopSettings,
    editingCustomDesign,
    requestCustomDesignSettingsClose,
  ]);

  const queueMoveFocus = (session: MoveSession, kind: PendingMoveFocus['kind']) => {
    pendingMoveFocusRef.current = {
      initialSectionId: session.initialSectionId,
      kind,
      targetSectionId: session.targetSectionId,
    };
    setMoveFocusRequest((current) => current + 1);
  };

  const chooseStarter = (starter: OriginStarter) => {
    pendingEditorTopRestoreRef.current = true;
    if (!lab.chooseStarter(starter)) {
      pendingEditorTopRestoreRef.current = false;
      showError(
        'Finish the current image upload before choosing another starting point.',
        'Image upload still in progress',
      );
      return;
    }
    setBookingSession(createEmptyBookingSession());
    setBookingCollapseOverrides({});
    setBookingCollapseReports({});
    setActivePageId(null);
    setSelectedSectionId(null);
    setEditingSectionId(null);
    setHotspotImageItemId(null);
    setCustomDesignUploadStatuses({});
    setCustomDesignRenderErrorAssetIds(new Set());
    setMode('edit');
    setStartAgainOpen(false);
    setOptionsOpen(false);
    setToast({ message: `${starterLabel(starter)} is ready. Change anything later.` });
  };

  const openMoveSection = (
    sectionId: string,
    entry: MoveSession['entry'] = 'section',
  ) => {
    if (editingCustomDesign && customDesignImageOrderDirty) {
      requestCustomDesignSettingsClose();
      return;
    }
    if (!document || moveSession) return;
    const page = findSectionPage(document, sectionId);
    if (!page) return;
    const baselineOrder = [...page.sections]
      .sort((left, right) => left.order - right.order)
      .map((section) => section.id);
    moveInvocationRef.current = window.document.activeElement instanceof HTMLElement
      ? window.document.activeElement
      : null;
    moveCommitInFlightRef.current = false;
    setMoveSession({
      baselineOrder,
      destination: null,
      entry,
      initialSectionId: sectionId,
      sourcePageId: page.id,
      targetSectionId: sectionId,
      workingOrder: baselineOrder,
    });
    setEditingSectionId(null);
    setStructureOpen(false);
    setMobileActionsOpen(false);
    setToast(null);
  };

  const enterReorder = () => {
    if (!activePage || activePage.sections.length < 2) return;
    const focusSection = activePage.sections.find((section) => section.id === selectedSectionId)
      ?? [...activePage.sections].sort((left, right) => left.order - right.order)[0];
    if (focusSection) openMoveSection(focusSection.id, 'arrange');
  };

  const updateWorkingPosition = (
    sectionId: string,
    position: number,
    announce = true,
  ) => {
    if (!moveSession || position < 1 || position > moveSession.workingOrder.length) return;
    const fromIndex = moveSession.workingOrder.indexOf(sectionId);
    if (fromIndex < 0) return;
    if (fromIndex === position - 1) return;
    const workingOrder = [...moveSession.workingOrder];
    workingOrder.splice(fromIndex, 1);
    workingOrder.splice(position - 1, 0, sectionId);
    const section = document ? findSection(document, sectionId) : null;
    setMoveSession({ ...moveSession, workingOrder });
    if (announce) {
      setAnnouncement(`${section?.label ?? 'Section'} moved to position ${position} of ${workingOrder.length}.`);
    }
  };

  const activateMoveTarget = (section: SectionInstance) => {
    setMoveSession((current) => {
      if (!current || current.targetSectionId === section.id) return current;
      return {
        ...current,
        destination: null,
        targetSectionId: section.id,
      };
    });
    setAnnouncement(`${section.label} selected for cross-page movement.`);
  };

  const stageMoveToPage = (pageId: string) => {
    if (!moveSession || !document) return;
    if (pageId === moveSession.sourcePageId) {
      setMoveSession({ ...moveSession, destination: null });
      setAnnouncement('Cross-page movement cleared. The section will stay on this page.');
      return;
    }
    const destinationPage = document.pages.find((page) => page.id === pageId);
    if (!destinationPage) return;
    const destination: CommitSectionMoveDestination = {
      type: 'existing_page',
      pageId,
      position: destinationPage.sections.length + 1,
    };
    setMoveSession({ ...moveSession, destination });
    const section = findSection(document, moveSession.targetSectionId);
    setAnnouncement(`${section?.label ?? 'Section'} staged to move to ${destinationPage.name}.`);
  };

  const stageMoveToNewPage = (name: string) => {
    if (!moveSession || !document) return;
    const destination: CommitSectionMoveDestination = {
      type: 'new_page',
      name,
      position: 1,
    };
    setMoveSession({ ...moveSession, destination });
    const section = findSection(document, moveSession.targetSectionId);
    setAnnouncement(`${name} staged as a new page for ${section?.label ?? 'this section'}.`);
  };

  const updateMoveDestinationPosition = (position: number) => {
    const destination = moveSession?.destination;
    if (!moveSession || !destination || destination.type !== 'existing_page') return;
    const destinationPage = document?.pages.find((page) => page.id === destination.pageId);
    if (!destinationPage || position < 1 || position > destinationPage.sections.length + 1) return;
    setMoveSession({
      ...moveSession,
      destination: { ...destination, position },
    });
    setAnnouncement(`Destination position ${position} of ${destinationPage.sections.length + 1} selected.`);
  };

  const clearMoveDestination = () => {
    if (!moveSession?.destination) return;
    setMoveSession({ ...moveSession, destination: null });
    setAnnouncement('Cross-page movement cleared. The section will stay on this page.');
  };

  const cancelMoveSection = (
    completionSource: Extract<MoveCompletionSource, 'cancel' | 'discard-changes'>,
    completionEvent: MoveCompletionEvent,
  ) => {
    if (!moveSession || !document || moveCommitInFlightRef.current) return;
    moveCommitInFlightRef.current = true;
    armMoveCompletionShield(
      completionSource,
      moveSession.initialSectionId,
      completionEvent,
    );
    const initialSection = findSection(document, moveSession.initialSectionId);
    const baselinePosition = moveSession.baselineOrder.indexOf(moveSession.initialSectionId) + 1;
    queueMoveFocus(moveSession, 'restore');
    setMoveSession(null);
    setMoveDismissPending(false);
    setAnnouncement(`Order restored. ${initialSection?.label ?? 'Section'} is back at position ${baselinePosition}.`);
  };

  const commitMoveSection = (
    completionSource: Extract<MoveCompletionSource, 'done' | 'keep-order'>,
    completionEvent: MoveCompletionEvent,
  ) => {
    if (!moveSession || !document || moveCommitInFlightRef.current) return;
    moveCommitInFlightRef.current = true;
    armMoveCompletionShield(
      completionSource,
      moveSession.targetSectionId,
      completionEvent,
    );
    const targetSection = findSection(document, moveSession.targetSectionId);
    const destination = moveSession.destination ?? undefined;
    const beforePageIds = new Set(document.pages.map((page) => page.id));
    const beforeVisibleCount = document.pages.filter((page) => page.visible).length;
    const result = execute({
      type: 'commit_section_move',
      input: {
        sourcePageId: moveSession.sourcePageId,
        orderedSectionIds: moveSession.workingOrder,
        sectionId: moveSession.targetSectionId,
        destination,
      },
    });
    if (!result.success) {
      moveCommitInFlightRef.current = false;
      releaseMoveCompletionShield();
      return;
    }

    queueMoveFocus(moveSession, 'commit');
    setMoveSession(null);
    setMoveDismissPending(false);
    if (!result.changed) return;
    if (destination?.type === 'existing_page') {
      const targetPage = result.document.pages.find((page) => page.id === destination.pageId);
      setActivePageId(destination.pageId);
      setSelectedSectionId(moveSession.targetSectionId);
      const message = `${targetSection?.label ?? 'Section'} moved to ${targetPage?.name ?? 'page'}.`;
      setPendingMoveFeedback({ announcement: message, message });
      return;
    }
    if (destination?.type === 'new_page') {
      const created = result.document.pages.find((page) => !beforePageIds.has(page.id));
      if (created) setActivePageId(created.id);
      setSelectedSectionId(moveSession.targetSectionId);
      if (!document.navigation.enabled && beforeVisibleCount === 1) setNavigationPromptOpen(true);
      setPendingMoveFeedback({
        announcement: `${targetSection?.label ?? 'Section'} moved to ${destination.name}.`,
        message: `${destination.name} created with ${targetSection?.label ?? 'section'} intact.`,
      });
      return;
    }

    setPendingMoveFeedback({
      announcement: 'Section order saved.',
      message: 'Section order saved.',
    });
  };

  const requestMoveClose = () => {
    if (!moveSession) return;
    if (moveDirty) setMoveDismissPending(true);
    else {
      queueMoveFocus(moveSession, 'restore');
      setMoveSession(null);
    }
  };

  const enterPreview = () => {
    if (editingCustomDesign && customDesignImageOrderDirty) {
      requestCustomDesignSettingsClose();
      return;
    }
    if (!document) {
      return;
    }
    const current = activePage?.visible ? activePage : document.pages.find((page) => page.visible) ?? getHomeOrFirstPage(document);
    setActivePageId(current.id);
    setStructureOpen(false);
    if (window.matchMedia('(max-width: 700px)').matches || window.document.body.clientWidth <= 700) {
      setViewport('mobile');
    }
    setMode('preview');
    window.requestAnimationFrame(() => window.scrollTo({ top: 0, behavior: 'auto' }));
  };

  const leavePreview = () => {
    setBookingSession((current) => normalizeSessionForLayoutChange(current));
    setMode('edit');
  };

  const selectPreviewViewport = (nextViewport: PreviewViewport) => {
    if (nextViewport === viewport) return;
    setViewport(nextViewport);
    setPreviewAnnouncement('');
    const announcementToken = previewAnnouncementTokenRef.current + 1;
    previewAnnouncementTokenRef.current = announcementToken;
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        if (previewAnnouncementTokenRef.current !== announcementToken) return;
        const stage = window.document.querySelector<HTMLElement>('#site-preview-stage');
        const announceSettledWidth = () => {
          window.requestAnimationFrame(() => {
            if (previewAnnouncementTokenRef.current !== announcementToken) return;
            const frame = window.document.querySelector<HTMLElement>(
              `#site-preview-stage .preview-frame[data-preview-viewport="${nextViewport}"]`,
            );
            if (!frame) return;
            const measuredWidth = Math.round(frame.getBoundingClientRect().width);
            if (measuredWidth <= 0) return;
            const label = nextViewport === 'mobile'
              ? 'Phone'
              : `${nextViewport[0]?.toUpperCase()}${nextViewport.slice(1)}`;
            setPreviewAnnouncement(`${label} preview selected — ${measuredWidth} pixels wide.`);
          });
        };
        const activeTransitions = stage?.getAnimations?.() ?? [];
        if (activeTransitions.length === 0) {
          announceSettledWidth();
          return;
        }
        void Promise.allSettled(activeTransitions.map((animation) => animation.finished))
          .then(announceSettledWidth);
      });
    });
  };

  const addSection = (
    sectionType: CatalogueSectionType | 'custom_design',
    size?: SectionSize,
  ) => {
    if (!activePage || libraryPosition === null) {
      return;
    }
    const beforeIds = new Set(activePage.sections.map((section) => section.id));
    const input = sectionType === 'custom_design'
      ? {
          pageId: activePage.id,
          position: libraryPosition,
          sectionType,
        } as const
      : {
          pageId: activePage.id,
          position: libraryPosition,
          sectionType,
          size: size ?? 'medium',
        } as const;
    const result = execute({ type: 'add_section', input });
    if (!result.success) {
      return;
    }
    const nextPage = result.document.pages.find((page) => page.id === activePage.id);
    const created = nextPage?.sections.find((section) => !beforeIds.has(section.id));
    setSelectedSectionId(created?.id ?? null);
    if (created?.sectionType === 'custom_design') {
      customDesignSettingsTriggerRef.current = null;
      setCustomDesignImageOrderDraft({
        baselineImageItemIds: [],
        orderedImageItemIds: [],
        sectionId: created.id,
      });
      setEditingSectionId(created.id);
      window.requestAnimationFrame(() => {
        const surface = window.document.querySelector<HTMLElement>(
          `[data-section-instance-id="${created.id}"]`,
        );
        surface?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      });
    }
    setLibraryPosition(null);
    setToast({ message: `${created?.label ?? 'Section'} added to ${activePage.name}.` });
  };

  const editSection = (section: SectionInstance) => {
    if (
      editingCustomDesign
      && customDesignImageOrderDirty
      && section.id !== editingCustomDesign.id
    ) {
      requestCustomDesignSettingsClose();
      return;
    }
    if (section.sectionType === 'booking') {
      bookingSettingsTriggerRef.current = window.document.activeElement instanceof HTMLElement
        ? window.document.activeElement
        : null;
      setSettingsTemporarilyHidden(false);
    } else if (section.sectionType === 'custom_design') {
      customDesignSettingsTriggerRef.current = window.document.activeElement instanceof HTMLElement
        ? window.document.activeElement
        : null;
      setHotspotImageItemId(null);
    }
    setStructureOpen(false);
    setSelectedSectionId(section.id);
    setEditingSectionId(section.id);
    setMobileActionsOpen(false);
    setToast(null);
  };

  const saveSection = (values: { note: string; size: SectionSize }) => {
    if (!editingPlaceholder) {
      return;
    }
    const result = execute({ type: 'update_section_settings', sectionId: editingPlaceholder.id, note: values.note, size: values.size });
    if (result.success) {
      setEditingSectionId(null);
      setToast({ message: `${editingPlaceholder.label} settings saved.` });
    }
  };

  const updateBookingPresentation = (
    settings: BookingSectionPresentationSettings,
  ) => {
    if (!editingBooking) {
      return;
    }
    const result = execute({
      type: 'update_booking_presentation',
      sectionId: editingBooking.id,
      settings,
    });
    if (!result.success) {
      return;
    }
    setToast({ message: 'Booking presentation updated.' });
  };

  const resetBookingPresentation = () => {
    if (!editingBooking) {
      return;
    }
    const result = execute({
      type: 'reset_booking_presentation',
      sectionId: editingBooking.id,
    });
    if (result.success) {
      setToast({ message: 'Booking presentation reset.' });
    }
  };

  const setCustomDesignUploadStatus = (
    sectionId: string,
    status: CustomDesignUploadStatus | undefined,
  ) => {
    setCustomDesignUploadStatuses((current) => ({ ...current, [sectionId]: status }));
  };

  const prepareCustomDesignImageTransition = (
    sectionId: string,
    expectedImagesJson: string,
    images: CustomDesignSettings['images'],
  ) => {
    const history = lab.getHistorySnapshot();
    const section = history ? findSection(history.present, sectionId) : null;
    if (section?.sectionType !== 'custom_design') {
      throw new Error('This Custom Design section is no longer available.');
    }
    if (JSON.stringify(section.settings.images) !== expectedImagesJson) {
      throw new Error('This image list changed while the files were processing. Try the upload again.');
    }
    const cta = reconcileCtaPlacementForImages(section.settings.cta, images).cta;
    const prepared = lab.prepareCommand({
      type: 'update_custom_design_settings',
      sectionId,
      settings: { ...section.settings, cta, images: [...images] },
    });
    if (!prepared.success) throw new Error(prepared.message);
    return {
      cancel: prepared.cancel,
      changed: prepared.changed,
      publish: prepared.publish,
    };
  };

  const uploadCustomDesignImages = async (
    sectionId: string,
    files: readonly File[],
  ) => {
    const section = document ? findSection(document, sectionId) : null;
    if (section?.sectionType !== 'custom_design') return;
    if (!customDesignAssetCoordinator) {
      showError(
        customDesignStorageError?.message
          ?? 'Uploaded-design storage is not available in this browser.',
        'Images could not be stored',
      );
      return;
    }

    const expectedImagesJson = JSON.stringify(section.settings.images);
    setCustomDesignUploadStatus(sectionId, { pending: true, message: 'Checking and saving images…' });
    try {
      const result = await customDesignAssetCoordinator.uploadImages({
        createAssetId: () => customDesignIdFactoryRef.current('asset'),
        createImageItemId: () => customDesignIdFactoryRef.current('image'),
        currentImages: section.settings.images,
        files,
        prepareDocumentTransition: (images) => prepareCustomDesignImageTransition(
          sectionId,
          expectedImagesJson,
          [...images],
        ),
      });
      const addedCount = result.added.length;
      const failures = result.failures.map((failure) => ({
        code: failure.code,
        fileName: failure.fileName,
        message: failure.message,
      }));
      const message = formatCustomDesignUploadSummary(addedCount, failures);
      setCustomDesignUploadStatus(sectionId, {
        failures,
        message,
        pending: false,
      });
      if (addedCount > 0) {
        setToast({ message });
        setAnnouncement(message);
      } else if (failures.length > 0) {
        showError(message, 'Images could not be added');
      }
    } catch (error) {
      const message = error instanceof Error
        ? error.message
        : 'The selected images could not be added safely.';
      setCustomDesignUploadStatus(sectionId, {
        failures: [{ fileName: 'Upload', message }],
        message: 'No images were added.',
        pending: false,
      });
      showError(message, 'Images could not be added');
    }
  };

  const replaceCustomDesignImageAsset = async (
    sectionId: string,
    imageItemId: string,
    file: File,
  ) => {
    const section = document ? findSection(document, sectionId) : null;
    if (section?.sectionType !== 'custom_design') return;
    if (!customDesignAssetCoordinator) {
      showError(
        customDesignStorageError?.message
          ?? 'Uploaded-design storage is not available in this browser.',
        'Image could not be replaced',
      );
      return;
    }
    const expectedImagesJson = JSON.stringify(section.settings.images);
    setCustomDesignUploadStatus(sectionId, { pending: true, message: 'Replacing image…' });
    try {
      const result = await customDesignAssetCoordinator.replaceImage({
        createAssetId: () => customDesignIdFactoryRef.current('asset'),
        currentImages: section.settings.images,
        file,
        imageItemId,
        prepareDocumentTransition: (images) => prepareCustomDesignImageTransition(
          sectionId,
          expectedImagesJson,
          [...images],
        ),
      });
      if (!result.success) {
        setCustomDesignUploadStatus(sectionId, {
          failures: [{ fileName: result.failure.fileName, message: result.failure.message }],
          message: 'The image was not replaced.',
          pending: false,
        });
        showError(result.failure.message, 'Image could not be replaced');
        return;
      }
      const message = result.reviewRequired
        ? 'Image replaced. Review link positions before Preview.'
        : 'Image replaced. Link areas were preserved.';
      setCustomDesignUploadStatus(sectionId, { pending: false, message });
      setToast({ message });
      setAnnouncement(message);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'The image could not be replaced safely.';
      setCustomDesignUploadStatus(sectionId, {
        failures: [{ fileName: file.name, message }],
        message: 'The image was not replaced.',
        pending: false,
      });
      showError(message, 'Image could not be replaced');
    }
  };

  const updateCustomDesignSettings = (
    sectionId: string,
    update: (settings: CustomDesignSettings) => CustomDesignSettings,
    message: string,
    undoable = false,
  ) => {
    const history = lab.getHistorySnapshot();
    const section = history ? findSection(history.present, sectionId) : null;
    if (section?.sectionType !== 'custom_design') return false;
    const result = execute({
      type: 'update_custom_design_settings',
      sectionId,
      settings: update(section.settings),
    });
    if (!result.success) return false;
    setToast({ message, ...(undoable ? { undoable: true } : {}) });
    setAnnouncement(message);
    return true;
  };

  const commitCustomDesignImageOrder = (
    sectionId: string,
    orderedImageItemIds: readonly string[],
  ) => updateCustomDesignSettings(sectionId, (settings) => {
    const byId = new Map(settings.images.map((image) => [image.id, image]));
    const images = orderedImageItemIds.flatMap((id) => {
      const image = byId.get(id);
      return image ? [image] : [];
    });
    return images.length === settings.images.length
      ? { ...settings, images }
      : settings;
  }, 'Image order saved.');

  const keepEditingCustomDesignImageOrder = () => {
    setCustomDesignOrderDismissPending(false);
    window.requestAnimationFrame(() => {
      const meaningfulManagerTarget = window.document.querySelector<HTMLElement>(
        '.custom-design-owner-editor .custom-design-owner-order-actions button, .custom-design-owner-editor [data-image-item-id] button',
      );
      restoreVisibleFocus(
        [
          customDesignOrderDismissTriggerRef.current,
          meaningfulManagerTarget,
          customDesignSettingsHeadingRef.current,
        ].find(canReceiveProgrammaticFocus) ?? null,
      );
    });
  };

  const discardCustomDesignImageOrderAndClose = () => {
    if (customDesignOrderResolutionInFlightRef.current) return;
    customDesignOrderResolutionInFlightRef.current = true;
    if (editingCustomDesign) {
      const canonical = editingCustomDesign.settings.images.map(image => image.id);
      setCustomDesignImageOrderDraft({
        baselineImageItemIds: canonical,
        orderedImageItemIds: canonical,
        sectionId: editingCustomDesign.id,
      });
    }
    finishCustomDesignSettingsClose();
  };

  const saveCustomDesignImageOrderAndClose = () => {
    if (
      customDesignOrderResolutionInFlightRef.current
      || !editingCustomDesign
      || !activeCustomDesignImageOrderDraft
    ) return;
    customDesignOrderResolutionInFlightRef.current = true;
    const orderedImageItemIds = activeCustomDesignImageOrderDraft.orderedImageItemIds;
    if (!commitCustomDesignImageOrder(editingCustomDesign.id, orderedImageItemIds)) {
      customDesignOrderResolutionInFlightRef.current = false;
      return;
    }
    setCustomDesignImageOrderDraft({
      baselineImageItemIds: [...orderedImageItemIds],
      orderedImageItemIds: [...orderedImageItemIds],
      sectionId: editingCustomDesign.id,
    });
    finishCustomDesignSettingsClose();
  };

  const removeCustomDesignImage = (
    sectionId: string,
    imageItemId: string,
  ) => updateCustomDesignSettings(sectionId, (settings) => {
    const images = settings.images.filter((image) => image.id !== imageItemId);
    return {
      ...settings,
      cta: reconcileCtaPlacementForImages(settings.cta, images).cta,
      images,
    };
  }, 'Image removed.', true);

  const commitCustomDesignAreas = (
    sectionId: string,
    imageItemId: string,
    areas: readonly CustomDesignInteractiveArea[],
  ) => {
    const changed = updateCustomDesignSettings(sectionId, (settings) => ({
      ...settings,
      images: settings.images.map((image) => image.id === imageItemId
        ? { ...image, interactiveAreas: [...areas] }
        : image),
    }), 'Link areas saved.');
    if (changed) setHotspotImageItemId(null);
  };

  const toggleSection = (section: SectionInstance) => {
    const result = execute({ type: 'set_section_visible', sectionId: section.id, visible: !section.visible });
    if (result.success) {
      setToast({ message: `${section.label} is now ${section.visible ? 'hidden' : 'shown'}.` });
    }
  };

  const removeSection = (section: SectionInstance) => {
    if (
      editingCustomDesign?.id === section.id
      && customDesignImageOrderDirty
    ) {
      requestCustomDesignSettingsClose();
      return;
    }
    const result = execute({ type: 'remove_section', sectionId: section.id });
    if (result.success) {
      setSelectedSectionId(null);
      setEditingSectionId(null);
      setHotspotImageItemId(null);
      setCustomDesignUploadStatuses({});
      setCustomDesignRenderErrorAssetIds(new Set());
      setMobileActionsOpen(false);
      setToast({ message: 'Section removed', undoable: true });
    }
  };

  const restoreSection = (section: SectionInstance, position?: number) => {
    if (!activePage) {
      return false;
    }
    const result = execute({
      type: 'restore_section',
      sectionId: section.id,
      pageId: activePage.id,
      ...(position === undefined ? {} : { position }),
    });
    if (result.success) {
      setSelectedSectionId(section.id);
      setToast({ message: `${section.label} restored to ${activePage.name}.` });
      return true;
    }
    return false;
  };

  const restoreSectionFromLibrary = (section: SectionInstance, position?: number) => {
    if (!restoreSection(section, position)) return;
    setLibraryPosition(null);
    window.requestAnimationFrame(() => {
      const restored = window.document.querySelector<HTMLElement>(
        `[data-section-instance-id="${section.id}"]`,
      );
      restored?.scrollIntoView({ behavior: 'auto', block: 'start' });
      window.requestAnimationFrame(() => {
        restored?.querySelector<HTMLElement>('.section-card__select-surface')
          ?.focus({ preventScroll: true });
      });
    });
  };

  const addPage = (name: string, slug: string) => {
    if (!document) {
      return;
    }
    const beforeIds = new Set(document.pages.map((page) => page.id));
    const beforeVisibleCount = document.pages.filter((page) => page.visible).length;
    const result = execute({ type: 'add_page', input: { name, slug: slug || undefined } });
    if (!result.success) {
      return;
    }
    const created = result.document.pages.find((page) => !beforeIds.has(page.id));
    setAddPageOpen(false);
    setStructureOpen(false);
    if (created) {
      setActivePageId(created.id);
    }
    if (!document.navigation.enabled && beforeVisibleCount === 1 && result.document.pages.filter((page) => page.visible).length > 1) {
      setNavigationPromptOpen(true);
    }
    setToast({ message: `${name} page added.` });
  };

  const savePage = (values: { name: string; slug: string; visible: boolean; visibleInNavigation: boolean }) => {
    if (!editingPage) {
      return;
    }
    const result = execute({
      type: 'update_page_settings',
      pageId: editingPage.id,
      ...values,
    });
    if (result.success) {
      setEditingPageId(null);
      setToast({ message: `${values.name} page settings saved.` });
    }
  };

  const movePage = (page: PageDocument, position: number) => {
    const result = execute({ type: 'move_page', pageId: page.id, position });
    if (result.success) {
      setAnnouncement(`${page.name} moved to page position ${position} of ${result.document.pages.length}.`);
    }
  };

  const confirmRemovePage = () => {
    if (!pendingPageRemoval) {
      return;
    }
    const result = execute({ type: 'remove_page', pageId: pendingPageRemoval.id });
    setPendingPageRemovalId(null);
    if (result.success) {
      setToast({ message: 'Page removed', undoable: true });
      if (activePageId === pendingPageRemoval.id) {
        setActivePageId(getHomeOrFirstPage(result.document).id);
      }
    }
  };

  const restorePage = (pageId: string) => {
    const result = execute({ type: 'restore_page', pageId });
    if (result.success) {
      const page = result.document.pages.find((candidate) => candidate.id === pageId);
      setActivePageId(pageId);
      setToast({ message: `${page?.name ?? 'Page'} restored with its sections intact.` });
    }
  };

  const toggleNavigation = () => {
    if (!document) {
      return;
    }
    const result = execute({ type: 'toggle_navigation', enabled: !document.navigation.enabled });
    if (result.success) {
      setToast({ message: `Menu ${document.navigation.enabled ? 'turned off' : 'added'}.` });
    }
  };

  const exportJson = () => {
    try {
      const json = lab.exportJson();
      if (!json) return;
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const anchor = window.document.createElement('a');
      anchor.href = url;
      anchor.download = 'luster-site-builder-v2-booking-integration-lab-v1.json';
      anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 0);
      setOptionsOpen(false);
      setToast({ message: 'JSON exported. Uploaded image bytes are not included.' });
    } catch (error) {
      showError(
        error instanceof Error ? error.message : 'The JSON backup could not be created.',
        'Export could not be completed',
      );
    }
  };

  const importFile = async (file: File) => {
    try {
      const json = await file.text();
      const result = customDesignAssetCoordinator
        ? await customDesignAssetCoordinator.coordinateDocumentMutation(
          () => lab.importJson(json),
        )
        : lab.importJson(json);
      if (!result.success) {
        showError(result.issues.join(' '), 'Import could not be completed');
        return;
      }
      setOptionsOpen(false);
      setActivePageId(getHomeOrFirstPage(result.document).id);
      setSelectedSectionId(null);
      setEditingSectionId(null);
      setHotspotImageItemId(null);
      setCustomDesignUploadStatuses({});
      setCustomDesignRenderErrorAssetIds(new Set());
      setBookingSession(createEmptyBookingSession());
      setBookingCollapseOverrides({});
      setBookingCollapseReports({});
      setMode('edit');
      setToast({ message: 'Site restored from imported JSON.' });
    } catch {
      showError('The selected file could not be read.', 'Import could not be completed');
    }
  };

  const confirmReset = async () => {
    if (resetChoice === 'lab') {
      try {
        await customDesignAssetCoordinator?.clearAllAssets();
      } catch (error) {
        showError(
          error instanceof Error ? error.message : 'Uploaded images could not be cleared.',
          'Lab assets could not be cleared',
        );
        setResetChoice(null);
        return;
      }
      lab.resetLab();
      setBookingSession(createEmptyBookingSession());
      setBookingCollapseOverrides({});
      setBookingCollapseReports({});
      setOptionsOpen(false);
      setEditingSectionId(null);
      setHotspotImageItemId(null);
      setCustomDesignUploadStatuses({});
      setCustomDesignRenderErrorAssetIds(new Set());
      setToast(null);
    } else if (resetChoice === 'starter') {
      pendingEditorTopRestoreRef.current = true;
      if (!lab.resetToStarter()) {
        pendingEditorTopRestoreRef.current = false;
        setResetChoice(null);
        showError(
          'Finish the current image upload before resetting this starting kit.',
          'Image upload still in progress',
        );
        return;
      }
      setBookingSession(createEmptyBookingSession());
      setBookingCollapseOverrides({});
      setBookingCollapseReports({});
      setActivePageId(null);
      setSelectedSectionId(null);
      setEditingSectionId(null);
      setHotspotImageItemId(null);
      setCustomDesignUploadStatuses({});
      setCustomDesignRenderErrorAssetIds(new Set());
      setMode('edit');
      setOptionsOpen(false);
      setToast({ message: 'Reset to the original starting kit.' });
    }
    setResetChoice(null);
  };

  if (!document || !activePage) {
    return (
      <>
        {lab.loadIssues.length > 0 ? (
          <div className="toast" role="alert"><span>Saved Lab data is corrupted and was not loaded. {lab.loadIssues.join(' ')}</span><button type="button" onClick={() => {
            void (async () => {
              try {
                await customDesignAssetCoordinator?.clearAllAssets();
              } finally {
                lab.resetLab();
              }
            })();
          }}>Reset saved Lab</button></div>
        ) : null}
        <StarterChooser
          onChoose={chooseStarter}
          onImport={importFile}
        />
        <AlertDialog message={alertMessage} onClose={() => setAlertMessage(null)} title={alertTitle} />
      </>
    );
  }

  const previewPage = activePage.visible ? activePage : document.pages.find((page) => page.visible) ?? getHomeOrFirstPage(document);
  const selectedBookingReport = selectedSection?.sectionType === 'booking'
    ? bookingCollapseReports[selectedSection.id]
    : undefined;
  const selectedSectionIdentity = selectedSection
    ? getSectionOwnerIdentity(selectedSection)
    : null;
  const selectedSectionSubtitle = selectedSectionIdentity?.detail ?? '';
  const editingCustomDesignReadiness = editingCustomDesign
    ? getOwnerCustomDesignReadiness(
        editingCustomDesign.settings,
        customDesignAssets,
        document,
        activePage.id,
      )
    : [];
  const hotspotImage = editingCustomDesign?.settings.images.find(
    (image) => image.id === hotspotImageItemId,
  ) ?? null;
  const hotspotAsset = hotspotImage
    ? customDesignAssets[hotspotImage.assetId] ?? { status: 'loading' as const }
    : { status: 'loading' as const };

  const toggleSelectedBookingCollapse = () => {
    if (selectedSection?.sectionType !== 'booking' || !selectedBookingReport) return;
    setBookingCollapseOverrides((current) => ({
      ...current,
      [selectedSection.id]: !selectedBookingReport.collapsed,
    }));
  };

  const returnToSelectedSection = () => {
    if (!selectedSection) return;
    const section = window.document.querySelector<HTMLElement>(`[data-section-instance-id="${selectedSection.id}"]`);
    if (!section) return;
    setSelectedSectionIntersects(true);
    section.scrollIntoView({ block: 'start', behavior: 'smooth' });
    window.requestAnimationFrame(() => {
      section.querySelector<HTMLElement>('.section-card__select-surface')?.focus({ preventScroll: true });
    });
  };

  const undoLastChange = (): boolean => {
    if (editingCustomDesign && customDesignImageOrderDirty) {
      requestCustomDesignSettingsClose();
      return false;
    }
    if (lab.undo()) {
      setAnnouncement('Last change undone.');
      setToast({ message: 'Last change undone.' });
      return true;
    }
    return false;
  };

  const redoLastChange = (): boolean => {
    if (editingCustomDesign && customDesignImageOrderDirty) {
      requestCustomDesignSettingsClose();
      return false;
    }
    if (lab.redo()) {
      setAnnouncement('Last change redone.');
      setToast({ message: 'Last change redone.' });
      return true;
    }
    return false;
  };

  const closeStructureOnMobile = () => {
    if (window.matchMedia('(max-width: 899px)').matches) {
      setStructureOpen(false);
    }
  };

  const openStructure = () => {
    if (editingCustomDesign && customDesignImageOrderDirty) {
      requestCustomDesignSettingsClose();
      return;
    }
    setEditingSectionId(null);
    setEditingPageId(null);
    setAddPageOpen(false);
    setMobileActionsOpen(false);
    setStructureOpen(true);
  };

  const structurePanel = (
    <FinalStructurePanel
      activePageId={activePage.id}
      document={document}
      onAddPage={() => { setToast(null); setStructureOpen(false); setAddPageOpen(true); }}
      onEditPage={(page) => { setEditingPageId(page.id); }}
      onEnterReorder={enterReorder}
      onMoveNavigationItem={(pageId, position) => execute({ type: 'move_navigation_item', pageId, position })}
      onMovePage={movePage}
      onRemovePage={(page) => { setStructureOpen(false); setPendingPageRemovalId(page.id); }}
      onRenameNavigationItem={(pageId, label) => execute({ type: 'rename_navigation_item', pageId, label })}
      onRestorePage={restorePage}
      onRestoreSection={restoreSection}
      onSelectPage={(pageId) => {
        setActivePageId(pageId);
        setSelectedSectionId(null);
        closeStructureOnMobile();
      }}
      onSelectSection={(pageId, section) => {
        setActivePageId(pageId);
        setSelectedSectionId(section.id);
        closeStructureOnMobile();
      }}
      onToggleNavigation={toggleNavigation}
      open={structureOpen}
      selectedSectionId={selectedSectionId}
    />
  );

  const customDesignOwnerEditor = editingCustomDesign ? (
    <CustomDesignOwnerEditor
      assets={customDesignAssets}
      imageOrderDraft={activeCustomDesignImageOrderDraft?.orderedImageItemIds
        ?? committedCustomDesignImageItemIds}
      internalTargets={customDesignInternalTargets}
      readinessIssues={editingCustomDesignReadiness}
      settings={editingCustomDesign.settings}
      uploadStatus={customDesignUploadStatuses[editingCustomDesign.id]}
      onAddImages={(files) => {
        void uploadCustomDesignImages(editingCustomDesign.id, files);
      }}
      onCommitImageOrder={(imageItemIds) => {
        if (commitCustomDesignImageOrder(editingCustomDesign.id, imageItemIds)) {
          setCustomDesignImageOrderDraft({
            baselineImageItemIds: [...imageItemIds],
            orderedImageItemIds: [...imageItemIds],
            sectionId: editingCustomDesign.id,
          });
        }
      }}
      onImageOrderDraftChange={(imageItemIds) => {
        setCustomDesignImageOrderDraft((current) => ({
          baselineImageItemIds: current?.sectionId === editingCustomDesign.id
            ? current.baselineImageItemIds
            : editingCustomDesign.settings.images.map(image => image.id),
          orderedImageItemIds: [...imageItemIds],
          sectionId: editingCustomDesign.id,
        }));
      }}
      onEditAreas={setHotspotImageItemId}
      onRemoveImage={(imageItemId) => {
        removeCustomDesignImage(editingCustomDesign.id, imageItemId);
      }}
      onReplaceImage={(imageItemId, file) => {
        void replaceCustomDesignImageAsset(editingCustomDesign.id, imageItemId, file);
      }}
      onUpdateAccessibility={(imageItemId, update) => {
        updateCustomDesignSettings(editingCustomDesign.id, (settings) => ({
          ...settings,
          images: settings.images.map((image) => image.id === imageItemId
            ? { ...image, ...update }
            : image),
        }), 'Accessibility information saved.');
      }}
      onUpdateBackground={(background) => {
        updateCustomDesignSettings(editingCustomDesign.id, (settings) => ({
          ...settings,
          background,
        }), 'Custom Design background updated.');
      }}
      onUpdateCta={(cta) => {
        updateCustomDesignSettings(editingCustomDesign.id, (settings) => ({
          ...settings,
          cta,
        }), cta.type === 'none' ? 'Native button removed.' : 'Native button saved.');
      }}
      onUpdateDisplay={(displayMode) => {
        updateCustomDesignSettings(editingCustomDesign.id, (settings) => ({
          ...settings,
          displayMode,
        }), `${displayMode === 'full_width' ? 'Full width' : `${displayMode[0]?.toUpperCase()}${displayMode.slice(1)}`} display selected.`);
      }}
      onUpdateGap={(gap) => {
        updateCustomDesignSettings(editingCustomDesign.id, (settings) => ({
          ...settings,
          gap,
        }), `${gap[0]?.toUpperCase()}${gap.slice(1)} image spacing selected.`);
      }}
    />
  ) : null;

  const zoomCompactedPreview = window.innerWidth > 700 && window.document.body.clientWidth <= 700;

  if (mode === 'preview') {
    return (
      <div className={`preview-app final-hybrid-preview${realHeightSimulation ? ' is-real-height-simulation' : ''}`} data-editor-shell="final-hybrid">
        <header className={`preview-toolbar final-preview-toolbar${zoomCompactedPreview ? ' is-zoom-compact' : ''}`} aria-label="Preview controls">
          <button aria-label="Back to editor" className="final-preview-toolbar__back" type="button" onClick={leavePreview}><ArrowLeft aria-hidden="true" size={18} /><span>Back to editor</span></button>
          <div className="final-preview-toolbar__page"><Eye aria-hidden="true" size={17} /><span>Previewing <strong>{previewPage.name}</strong></span></div>
          <div className="segmented-control final-preview-devices" role="group" aria-label="Preview viewport" aria-controls="site-preview-stage">
            <button aria-label="Desktop" aria-pressed={viewport === 'desktop'} type="button" onClick={() => selectPreviewViewport('desktop')}><Laptop aria-hidden="true" size={17} /><span>Desktop</span></button>
            <button aria-label="Tablet" aria-pressed={viewport === 'tablet'} type="button" onClick={() => selectPreviewViewport('tablet')}><Tablet aria-hidden="true" size={17} /><span>Tablet</span></button>
            <button aria-label="Phone" aria-pressed={viewport === 'mobile'} type="button" onClick={() => selectPreviewViewport('mobile')}><Smartphone aria-hidden="true" size={17} /><span>Phone</span></button>
          </div>
        </header>
        <section aria-label="Site preview">
          <Preview
            activePage={previewPage}
            bookingFixture={bookingFixture}
            bookingSession={bookingSession}
            businessMetadata={onboardingBusinessMetadata}
            document={document}
            tokenPreset={tokenPreset}
            viewport={viewport}
            stageId="site-preview-stage"
            onBookingSessionChange={setBookingSession}
            onNavigate={(pageId) => {
              const page = document.pages.find((candidate) => candidate.id === pageId);
              if (page?.visible) {
                setActivePageId(pageId);
              }
            }}
          />
        </section>
        <div
          aria-live="polite"
          className="visually-hidden"
          data-testid="preview-viewport-announcement"
          role="status"
        >
          {previewAnnouncement}
        </div>
      </div>
    );
  }

  return (
    <div
      ref={editorAppRef}
      className={`editor-app final-hybrid-app${selectedSection ? ' has-selected-section' : ''}${editingSectionId || moveSession || editingPageId || addPageOpen ? ' has-context-drawer' : ''}${editingBooking && !settingsTemporarilyHidden ? ' has-booking-settings' : ''}${editingCustomDesign ? ' has-custom-design-settings' : ''}${moveSession ? ' has-move-session' : ''}${realHeightSimulation ? ' is-real-height-simulation' : ''}`}
      data-canvas-viewport={viewport}
      data-editor-shell="final-hybrid"
      data-editor-mode={mode}
      data-testid="final-hybrid-editor"
      style={{ '--final-context-top': `${contextTop}px` } as CSSProperties}
    >
      <header ref={topbarRef} className="final-topbar" aria-label="Site builder toolbar">
        <div className="final-topbar__brand">
          <span aria-hidden="true">L</span><strong>Luster</strong>
          {lab.saveStatus === 'error' ? (
            <><button aria-label="Local save failed. Open backup and reset options" className="save-status is-error" type="button" onClick={requestLabOptionsOpen}><AlertTriangle aria-hidden="true" size={15} /><span>Save failed</span></button><span className="visually-hidden" role="alert">Local saving failed. Open backup and reset options for recovery actions.</span></>
          ) : (
            <span className={`save-status${moveDirty ? ' is-order-dirty' : lab.saveStatus === 'saved' ? ' is-saved' : ''}`} role="status" aria-label="Save status">
              {!moveDirty && lab.saveStatus === 'saved' ? <Check aria-hidden="true" size={14} /> : <Save aria-hidden="true" size={14} />}
              <span>{moveDirty ? 'Order not saved yet' : lab.saveStatus === 'saving' ? 'Saving…' : 'Saved'}</span>
            </span>
          )}
        </div>
        <button
          aria-expanded={structureOpen}
          aria-label={`Open Pages & Structure for ${activePage.name}`}
          className="final-topbar__page"
          disabled={Boolean(moveSession)}
          type="button"
          onClick={openStructure}
        >
          <span>{activePage.name}</span><ChevronDown aria-hidden="true" size={16} />
        </button>
        <div className="final-topbar__actions">
          <div className="final-topbar__history">
            <button aria-label="Undo" disabled={!lab.canUndo || Boolean(moveSession)} type="button" onClick={undoLastChange}><Undo2 aria-hidden="true" size={18} /></button>
            <button aria-label="Redo" disabled={!lab.canRedo || Boolean(moveSession)} type="button" onClick={redoLastChange}><Redo2 aria-hidden="true" size={18} /></button>
          </div>
          <button aria-label="Preview" className="final-topbar__preview" disabled={Boolean(moveSession)} type="button" onClick={enterPreview}><Eye aria-hidden="true" size={18} /><span>Preview</span></button>
          <button aria-label="More site options" className="final-topbar__more" disabled={Boolean(moveSession)} type="button" onClick={requestLabOptionsOpen}><MoreHorizontal aria-hidden="true" size={20} /></button>
        </div>
      </header>

      <main
        className="final-canvas-shell"
        onClick={(event) => {
          const target = event.target as HTMLElement;
          if (!target.closest('.section-card, button, input, select, textarea, a')) {
            setSelectedSectionId(null);
            setMobileActionsOpen(false);
          }
        }}
      >
        <div className="final-canvas-frame">
          <div className="final-site-canvas" data-page-id={activePage.id}>
              <div className="canvas-client-header" aria-hidden="true">
                <span title={document.siteName}><i>L</i><strong>{document.siteName}</strong></span>
                {canvasNavigationLabels.length > 0 ? <span className="canvas-client-header__nav">{canvasNavigationLabels.join('   ')}</span> : null}
              </div>
              <div className="final-page-heading">
                <h1 data-builder-start tabIndex={-1}>{activePage.name}</h1>
                <p>{activePage.sections.length} section{activePage.sections.length === 1 ? '' : 's'}{activePage.visible ? '' : ' · Page hidden'}</p>
              </div>

              <div aria-label={`Sections on ${activePage.name}`} className="final-sections-list" role="list">
                {sortedActiveSections.length === 0 ? (
                  <div className="final-empty-page">
                    <h2>Your page is empty</h2>
                    <p>Add a section to start building it.</p>
                    <button type="button" onClick={() => requestSectionLibraryOpen(1)}><Plus aria-hidden="true" size={18} /> Add section</button>
                  </div>
                ) : (
                  <>
                    <button className="final-insertion final-insertion--top" type="button" aria-label={`Add section at top of ${activePage.name}`} onClick={() => requestSectionLibraryOpen(1)}><Plus aria-hidden="true" size={15} /> Add section here</button>
                    {sortedActiveSections.map((section, index) => (
                      <div className="final-section-block" key={section.id}>
                        {section.sectionType === 'booking' ? (
                          <BookingSectionCard
                            collapseOverride={bookingCollapseOverrides[section.id]}
                            fixture={bookingFixture}
                            headingLevel="h2"
                            page={activePage}
                            section={section}
                            selected={selectedSectionId === section.id}
                            session={bookingSession}
                            tokenPreset={tokenPreset}
                            onCollapseChange={(collapsed) => setBookingCollapseOverrides((current) => ({ ...current, [section.id]: collapsed }))}
                            onCollapseReport={(report) => reportBookingCollapse(section.id, report)}
                            onEdit={editSection}
                            onEnterReorder={enterReorder}
                            onMove={(candidate) => openMoveSection(candidate.id)}
                            onRemove={removeSection}
                            onSelect={(candidate) => {
                              setSelectedSectionId((current) => current === candidate.id ? null : candidate.id);
                              setMobileActionsOpen(false);
                            }}
                            onSessionChange={setBookingSession}
                            onToggleVisible={toggleSection}
                          />
                        ) : section.sectionType === 'custom_design' ? (
                          <CustomDesignSectionCard
                            assets={customDesignAssets}
                            order={index + 1}
                            readinessIssues={getOwnerCustomDesignReadiness(
                              section.settings,
                              customDesignAssets,
                              document,
                              activePage.id,
                            )}
                            resolveAction={(action, source) => {
                              const effectiveAction = action
                                ?? (source.type === 'cta' && source.cta.type === 'book_now'
                                  ? { type: 'start_booking' as const }
                                  : null);
                              return effectiveAction
                              ? resolveCustomDesignDocumentAction(effectiveAction, {
                                  activePageId: activePage.id,
                                  document,
                                })
                              : { status: 'unresolved', reason: 'invalid_destination' };
                            }}
                            sectionId={section.id}
                            selected={selectedSectionId === section.id}
                            settings={section.settings}
                            uploadStatus={customDesignUploadStatuses[section.id]}
                            visible={section.visible}
                            onChooseImages={(files) => {
                              void uploadCustomDesignImages(section.id, files);
                            }}
                            onAssetRenderError={(assetId) => {
                              setCustomDesignRenderErrorAssetIds((current) => new Set(current).add(assetId));
                            }}
                            onEdit={() => editSection(section)}
                            onMove={() => openMoveSection(section.id)}
                            onRemove={() => removeSection(section)}
                            onReplaceImage={(imageItemId, file) => {
                              void replaceCustomDesignImageAsset(section.id, imageItemId, file);
                            }}
                            onSelect={() => {
                              setSelectedSectionId((current) => current === section.id ? null : section.id);
                              setMobileActionsOpen(false);
                            }}
                            onToggleVisible={() => toggleSection(section)}
                          />
                        ) : (
                          <SectionCard
                            page={activePage}
                            section={section}
                            selected={selectedSectionId === section.id}
                            onEdit={editSection}
                            onEnterReorder={enterReorder}
                            onMove={(candidate) => openMoveSection(candidate.id)}
                            onRemove={removeSection}
                            onSelect={(candidate) => {
                              setSelectedSectionId((current) => current === candidate.id ? null : candidate.id);
                              setMobileActionsOpen(false);
                            }}
                            onToggleVisible={toggleSection}
                          />
                        )}
                        <button
                          className="final-insertion"
                          type="button"
                          aria-label={index === sortedActiveSections.length - 1 ? `Add section at bottom of ${activePage.name}` : `Add section after ${section.label}`}
                          onClick={() => requestSectionLibraryOpen(index + 2)}
                        >
                          <Plus aria-hidden="true" size={15} /> Add section here
                        </button>
                      </div>
                    ))}
                  </>
                )}
              </div>
          </div>
        </div>
      </main>

      {editingBooking && desktopSettings ? (
        <aside
          ref={bookingSettingsDrawerRef}
          aria-label="Booking settings"
          aria-modal="false"
          className="final-booking-settings-drawer"
          hidden={settingsTemporarilyHidden}
          role="dialog"
          onBlurCapture={(event) => {
            if (event.target === bookingSettingsNativeSelectRef.current) {
              bookingSettingsNativeSelectRef.current = null;
            }
          }}
          onChangeCapture={(event) => {
            if (event.target === bookingSettingsNativeSelectRef.current) {
              bookingSettingsNativeSelectRef.current = null;
            }
          }}
          onClickCapture={(event) => {
            bookingSettingsNativeSelectRef.current = event.target instanceof HTMLSelectElement
              ? event.target
              : null;
          }}
          onKeyDownCapture={(event) => {
            if (
              event.key === 'Escape'
              && event.target === bookingSettingsNativeSelectRef.current
            ) {
              keepEscapeInsideActiveControl(event.nativeEvent);
              bookingSettingsNativeSelectRef.current = null;
              event.stopPropagation();
              return;
            }
            if (
              event.target instanceof HTMLSelectElement
              && (
                event.key === 'Enter'
                || event.key === ' '
                || event.key === 'F4'
                || (event.altKey && event.key === 'ArrowDown')
              )
            ) {
              bookingSettingsNativeSelectRef.current = event.target;
            }
          }}
          onPointerDownCapture={(event) => {
            bookingSettingsNativeSelectRef.current = event.target instanceof HTMLSelectElement
              ? event.target
              : null;
          }}
        >
          <header>
            <div className="final-booking-settings-drawer__intro">
              <h2 ref={bookingSettingsHeadingRef} className="final-booking-settings-drawer__title" tabIndex={-1}>Booking</h2>
              <p>Choose how clients browse your services. You can change this anytime. Your services, prices and booking settings stay the same.</p>
            </div>
            <button ref={bookingSettingsHideRef} className="final-booking-settings-drawer__preview" type="button" onClick={hideBookingSettings}>
              Hide settings
            </button>
            <button aria-label="Close Booking settings" className="icon-button" type="button" onClick={closeBookingSettings}>×</button>
          </header>
          <div className="final-booking-settings-drawer__body">
            <BookingSettingsPanel
              settings={editingBooking.settings}
              showIntro={false}
              onChange={updateBookingPresentation}
              onReset={resetBookingPresentation}
            />
          </div>
        </aside>
      ) : null}
      {editingCustomDesign && desktopSettings ? (
        <aside
          ref={customDesignSettingsDrawerRef}
          aria-label="Custom Design settings"
          aria-modal="false"
          className="final-booking-settings-drawer final-custom-design-settings-drawer"
          role="dialog"
        >
          <header>
            <div className="final-booking-settings-drawer__intro">
              <h2
                ref={customDesignSettingsHeadingRef}
                className="final-booking-settings-drawer__title"
                tabIndex={-1}
              >
                Custom Design
              </h2>
              <p>Manage uploaded pages, presentation, accessibility, and real client actions.</p>
            </div>
            <button
              aria-label="Close Custom Design settings"
              className="icon-button"
              type="button"
              onClick={requestCustomDesignSettingsClose}
            >
              ×
            </button>
          </header>
          <div className="final-booking-settings-drawer__body">
            {customDesignOwnerEditor}
          </div>
        </aside>
      ) : null}
      {selectedSection && !moveSession ? (
        <aside
          aria-label={`${selectedSection.label} owner controls`}
          className={`final-selected-toolbar${selectedSectionIntersects ? '' : ' is-away'}`}
          data-testid="selected-section-toolbar"
        >
          {selectedSectionIntersects ? (
            <>
              <div className="final-selected-toolbar__identity">
                <span aria-hidden="true">{selectedSectionIdentity?.mark}</span>
                <div><strong>{selectedSectionIdentity?.label}</strong><small>{selectedSectionSubtitle}</small></div>
              </div>
              <div className="final-selected-toolbar__actions">
                <button
                  data-booking-settings-trigger-for={selectedSection.sectionType === 'booking' ? selectedSection.id : undefined}
                  data-custom-design-settings-trigger-for={selectedSection.sectionType === 'custom_design' ? selectedSection.id : undefined}
                  type="button"
                  onClick={() => editSection(selectedSection)}
                >
                  <Pencil aria-hidden="true" size={17} /> Edit
                </button>
                <button data-move-trigger-for={selectedSection.id} type="button" onClick={() => openMoveSection(selectedSection.id)}><Move aria-hidden="true" size={17} /> Move</button>
                {selectedSection.sectionType === 'booking' && selectedBookingReport?.isLong ? (
                  <button type="button" onClick={toggleSelectedBookingCollapse}>
                    {selectedBookingReport.collapsed ? <Maximize2 aria-hidden="true" size={17} /> : <Minimize2 aria-hidden="true" size={17} />}
                    {selectedBookingReport.collapsed ? 'Expand' : 'Collapse'}
                  </button>
                ) : null}
                <button type="button" onClick={() => setMobileActionsOpen(true)}><MoreHorizontal aria-hidden="true" size={18} /> More</button>
              </div>
            </>
          ) : (
            <>
              <button
                className="final-selected-toolbar__return"
                data-section-return-for={selectedSection.id}
                type="button"
                onClick={returnToSelectedSection}
              >
                Back to {selectedSection.label}
              </button>
              {editingBooking && desktopSettings && settingsTemporarilyHidden ? (
                <button
                  ref={bookingSettingsShowRef}
                  className="final-selected-toolbar__return final-selected-toolbar__show-settings"
                  type="button"
                  onClick={showBookingSettings}
                >
                  Show Booking settings
                </button>
              ) : null}
            </>
          )}
        </aside>
      ) : null}

      <div className="final-mobile-dock">
        {moveSession ? null : selectedSection ? (
          selectedSectionIntersects ? (
            <div aria-label={`${selectedSection.label} actions`} className="final-mobile-dock__selected" role="group">
              <div className="final-mobile-dock__identity">
                <span aria-hidden="true">{selectedSectionIdentity?.mark}</span>
                <div><strong>{selectedSectionIdentity?.label}</strong><small>{selectedSectionIdentity?.short}</small></div>
              </div>
              <div className={`final-mobile-dock__actions${selectedSection.sectionType === 'booking' && selectedBookingReport?.isLong ? ' has-collapse' : ''}`}>
                <button
                  data-booking-settings-trigger-for={selectedSection.sectionType === 'booking' ? selectedSection.id : undefined}
                  data-custom-design-settings-trigger-for={selectedSection.sectionType === 'custom_design' ? selectedSection.id : undefined}
                  type="button"
                  onClick={() => editSection(selectedSection)}
                >
                  <Pencil aria-hidden="true" size={18} /> Edit
                </button>
                <button data-move-trigger-for={selectedSection.id} type="button" onClick={() => openMoveSection(selectedSection.id)}><Menu aria-hidden="true" size={18} /> Move</button>
                <button type="button" onClick={() => toggleSection(selectedSection)}><Eye aria-hidden="true" size={18} /> {selectedSection.visible ? 'Hide' : 'Show'}</button>
                <button type="button" onClick={() => setMobileActionsOpen(true)}><MoreHorizontal aria-hidden="true" size={19} /> More</button>
                {selectedSection.sectionType === 'booking' && selectedBookingReport?.isLong ? (
                  <button type="button" onClick={toggleSelectedBookingCollapse}>
                    {selectedBookingReport.collapsed ? <Maximize2 aria-hidden="true" size={18} /> : <Minimize2 aria-hidden="true" size={18} />}
                    {selectedBookingReport.collapsed ? 'Expand' : 'Collapse'}
                  </button>
                ) : null}
              </div>
            </div>
          ) : (
            <button
              className="final-mobile-dock__back"
              data-section-return-for={selectedSection.id}
              type="button"
              onClick={returnToSelectedSection}
            >
              Back to {selectedSection.label}
            </button>
          )
        ) : (
          <button className="final-mobile-dock__add" type="button" onClick={() => requestSectionLibraryOpen(sortedActiveSections.length + 1)}><Plus aria-hidden="true" size={20} /> Add section</button>
        )}
      </div>

      <div className="visually-hidden" aria-live="polite" data-testid="reorder-live-region" role="status">{announcement}</div>

      {toast ? (
        <div className="toast" role="status"><span>{toast.message}</span>{toast.undoable ? <button type="button" onClick={() => { if (undoLastChange()) { setToast(null); setAnnouncement('Removal undone.'); } }}>Undo</button> : null}</div>
      ) : null}

      <Dialog onClose={() => setStructureOpen(false)} open={structureOpen} title="Pages & Structure" variant="structure-panel">
        {structurePanel}
      </Dialog>
      <SectionLibraryDialog document={document} insertionPosition={libraryPosition} onAdd={addSection} onClose={() => setLibraryPosition(null)} onRestore={restoreSectionFromLibrary} page={activePage} />
      <SectionSettingsDialog onClose={() => setEditingSectionId(null)} onSave={saveSection} section={editingPlaceholder} />
      <Dialog
        initialFocusSelector="[data-dialog-title]"
        onClose={closeBookingSettings}
        open={editingBooking !== null && !desktopSettings}
        title="Booking"
        variant="context-panel"
      >
        {editingBooking ? (
          <BookingSettingsPanel
            settings={editingBooking.settings}
            onChange={updateBookingPresentation}
            onReset={resetBookingPresentation}
          />
        ) : null}
      </Dialog>
      <Dialog
        initialFocusSelector="[data-dialog-title]"
        onClose={requestCustomDesignSettingsClose}
        open={editingCustomDesign !== null && !desktopSettings && hotspotImageItemId === null}
        title="Custom Design"
        variant="context-panel"
      >
        {customDesignOwnerEditor}
      </Dialog>
      <HotspotEditor
        asset={hotspotAsset}
        createAreaId={() => customDesignIdFactoryRef.current('area')}
        image={hotspotImage}
        internalTargets={customDesignInternalTargets}
        open={editingCustomDesign !== null && hotspotImage !== null}
        onCancel={() => setHotspotImageItemId(null)}
        onCommit={(imageItemId, areas) => {
          if (editingCustomDesign) {
            commitCustomDesignAreas(editingCustomDesign.id, imageItemId, areas);
          }
        }}
      />
      {moveSession && moveSourcePage ? (
        <SectionMovePanel
          commitStatus={lab.saveStatus === 'idle' ? 'saved' : lab.saveStatus}
          destination={moveSession.destination}
          dirty={moveDirty}
          document={document}
          entry={moveSession.entry}
          onActivateSection={activateMoveTarget}
          onAnnounce={setAnnouncement}
          onCancel={(event) => cancelMoveSection(
            'cancel',
            readMoveCompletionEvent(event),
          )}
          onClearDestination={clearMoveDestination}
          onCreatePage={stageMoveToNewPage}
          onDestinationPositionChange={updateMoveDestinationPosition}
          onDone={(event) => commitMoveSection(
            'done',
            readMoveCompletionEvent(event),
          )}
          onDragReorder={(sectionId, position) => updateWorkingPosition(sectionId, position, false)}
          onMoveDown={(section) => {
            const index = moveSession.workingOrder.indexOf(section.id);
            updateWorkingPosition(section.id, index + 2);
          }}
          onMoveToPage={stageMoveToPage}
          onMoveToPosition={(section, position) => updateWorkingPosition(section.id, position)}
          onMoveUp={(section) => {
            const index = moveSession.workingOrder.indexOf(section.id);
            updateWorkingPosition(section.id, index);
          }}
          onRequestClose={requestMoveClose}
          open
          page={moveSourcePage}
          sections={moveSections}
          targetSectionId={moveSession.targetSectionId}
        />
      ) : null}
      <AddPageDialog onAdd={addPage} onClose={() => setAddPageOpen(false)} open={addPageOpen} />
      <PageSettingsDialog onClose={() => setEditingPageId(null)} onSave={savePage} page={editingPage} />
      <NavigationPromptDialog onAddNavigation={() => { execute({ type: 'toggle_navigation', enabled: true }); setNavigationPromptOpen(false); setToast({ message: 'Menu added.' }); }} onClose={() => setNavigationPromptOpen(false)} open={navigationPromptOpen} />
      <ConfirmationDialog confirmLabel="Remove page" danger description={pendingPageRemoval ? `${pendingPageRemoval.name} and its sections will move to Removed pages, where they can be restored.` : ''} onClose={() => setPendingPageRemovalId(null)} onConfirm={confirmRemovePage} open={pendingPageRemoval !== null} title="Remove this page?" />
      <Dialog
        description="You changed the order of your uploaded design pages."
        initialFocusSelector="[data-custom-design-order-keep-editing]"
        onClose={keepEditingCustomDesignImageOrder}
        open={customDesignOrderDismissPending}
        restoreFocusOnClose={false}
        title="Save this page order?"
      >
        <p className="eyebrow">UNSAVED IMAGE ORDER</p>
        <div className="dialog-actions">
          <button
            className="secondary-button"
            data-custom-design-order-keep-editing
            type="button"
            onClick={keepEditingCustomDesignImageOrder}
          >
            Keep editing
          </button>
          <button
            className="secondary-button"
            type="button"
            onClick={discardCustomDesignImageOrderAndClose}
          >
            Discard changes
          </button>
          <button
            className="primary-button"
            type="button"
            onClick={saveCustomDesignImageOrderAndClose}
          >
            Save order
          </button>
        </div>
      </Dialog>
      <Dialog
        description={moveSession ? (() => {
          const targetSection = findSection(document, moveSession.targetSectionId);
          const destination = moveSession.destination;
          if (destination?.type === 'existing_page') {
            const destinationPage = document.pages.find((page) => page.id === destination.pageId);
            const orderAlsoChanged = moveSession.workingOrder.some((id, index) => (
              id !== moveSession.baselineOrder[index]
            ));
            return `${targetSection?.label ?? 'Section'} will move to ${destinationPage?.name ?? 'the selected page'} at position ${destination.position ?? destinationPage?.sections.length ?? 1}.${orderAlsoChanged ? ' Other section order changes will be saved too.' : ''}`;
          }
          if (destination?.type === 'new_page') {
            const orderAlsoChanged = moveSession.workingOrder.some((id, index) => (
              id !== moveSession.baselineOrder[index]
            ));
            return `${destination.name} will be created and ${targetSection?.label ?? 'the section'} will move there.${orderAlsoChanged ? ' Other section order changes will be saved too.' : ''}`;
          }
          const changedSectionId = moveSession.workingOrder.find((id, index) => (
            moveSession.baselineOrder.indexOf(id) !== index
          )) ?? moveSession.targetSectionId;
          return `${findSection(document, changedSectionId)?.label ?? 'Section'} is at position ${moveSession.workingOrder.indexOf(changedSectionId) + 1} instead of ${moveSession.baselineOrder.indexOf(changedSectionId) + 1}.`;
        })() : ''}
        onClose={() => setMoveDismissPending(false)}
        open={moveDismissPending}
        restoreFocusOnClose={moveSession !== null}
        title="Keep this new order?"
      >
        <div className="dialog-actions">
          <button className="secondary-button" type="button" onClick={(event) => cancelMoveSection('discard-changes', readMoveCompletionEvent(event))}>Discard changes</button>
          <button className="primary-button" type="button" onClick={(event) => commitMoveSection('keep-order', readMoveCompletionEvent(event))}>Keep order</button>
        </div>
      </Dialog>
      <LabOptionsDialog
        canRedo={lab.canRedo}
        canUndo={lab.canUndo}
        imageFixture={imageFixture}
        menuSize={menuSize}
        onClose={() => setOptionsOpen(false)}
        onExport={exportJson}
        onImageFixtureChange={setImageFixture}
        onImport={importFile}
        onMenuSizeChange={setMenuSize}
        onRedo={redoLastChange}
        onResetLab={() => { setOptionsOpen(false); setResetChoice('lab'); }}
        onResetStarter={() => { setOptionsOpen(false); setResetChoice('starter'); }}
        onStartAgain={() => { setOptionsOpen(false); setStartAgainOpen(true); }}
        onTokenPresetChange={setTokenPreset}
        onToggleRealHeightSimulation={() => setRealHeightSimulation((value) => !value)}
        onUndo={undoLastChange}
        open={optionsOpen}
        realHeightSimulation={realHeightSimulation}
        tokenPreset={tokenPreset}
      />
      <StartAgainDialog onChoose={chooseStarter} onClose={() => setStartAgainOpen(false)} open={startAgainOpen} />
      <ConfirmationDialog confirmLabel={resetChoice === 'lab' ? 'Reset Lab' : 'Reset to starter'} danger description={resetChoice === 'lab' ? 'This clears the local Lab document and returns to the starting-point chooser.' : 'This replaces local changes with fresh defaults for the current starting point.'} onClose={() => setResetChoice(null)} onConfirm={confirmReset} open={resetChoice !== null} title={resetChoice === 'lab' ? 'Reset the entire Lab?' : 'Reset to the starting point?'} />
      <AlertDialog message={alertMessage} onClose={() => setAlertMessage(null)} title={alertTitle} />

      <Dialog onClose={() => setMobileActionsOpen(false)} open={mobileActionsOpen && selectedSection !== null} title={selectedSection ? `${selectedSection.label} actions` : 'Section actions'} variant="bottom-sheet">
        {selectedSection ? (
          <div className="final-more-actions">
            <p>
              {selectedSection.visible ? 'Shown on your website' : 'Hidden from clients'} · {' '}
              {selectedSection.sectionType === 'booking'
                ? 'Your client booking menu · keeps booking available'
                : getSectionOwnerIdentity(selectedSection).detail}
            </p>
            <button type="button" onClick={() => { setMobileActionsOpen(false); openMoveSection(selectedSection.id); }}><Menu aria-hidden="true" size={18} /> Move section</button>
            <button type="button" onClick={() => { setMobileActionsOpen(false); removeSection(selectedSection); }}><Trash2 aria-hidden="true" size={18} /> Remove from page</button>
          </div>
        ) : null}
      </Dialog>
    </div>
  );
}
