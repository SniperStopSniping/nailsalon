import { BOOKING_PAGE_BUILDER_UIQI_CAPABILITIES } from '@/libs/bookingPageBuilder';
import { SECTION_PRESENTATION_UIQI_CAPABILITIES } from '@/libs/sectionPresentation';

export const UIQI_CONTRACT_VERSION = '1.0.0' as const;

export const UIQI_APPLICABILITY_CLASSES = [
  'AUTOMATED_CURRENT',
  'MANUAL_CURRENT',
  'FUTURE_TRIGGERED',
  'STRUCTURAL_INVARIANT',
  'NOT_CURRENTLY_APPLICABLE',
] as const;

export const UIQI_STATUS_VALUES = [
  'PASS',
  'FAIL',
  'PENDING_MANUAL',
  'FUTURE_TRIGGERED',
  'NOT_APPLICABLE',
] as const;

export const UIQI_MANUAL_RESULTS = ['PASS', 'FAIL', 'PENDING', 'NOT_APPLICABLE'] as const;

export type UIQIApplicability = typeof UIQI_APPLICABILITY_CLASSES[number];
export type UIQIStatus = typeof UIQI_STATUS_VALUES[number];
export type UIQIManualResult = typeof UIQI_MANUAL_RESULTS[number];
export type UIQICategory = 'SYSTEM' | 'STATE' | 'ACCESSIBILITY' | 'NAMED_OBLIGATION';
export type UIQISeverity = 'REQUIRED';
export type UIQISurface = 'OWNER' | 'CLIENT' | 'SHARED';
export type UIQIEvidenceType = 'AUTOMATED_TEST' | 'SOURCE_GUARD' | 'MANUAL_PROTOCOL' | 'FUTURE_TRIGGER';
export type UIQIAutomatedEvidenceKind = 'VITEST' | 'PLAYWRIGHT' | 'SOURCE_GUARD' | 'COMPOSITE';

export type UIQIAutomatedEvidence = {
  id: string;
  kind: UIQIAutomatedEvidenceKind;
  paths: readonly string[];
  command: string;
  ciContext: 'Full Vitest Suite' | 'Run all tests' | 'UIQI release conditions';
  proves: string;
};

export type UIQIManualProtocol = {
  id: string;
  deviceEnvironment: string;
  viewport: string;
  browserOrWebView: string;
  assistiveTechnology: string;
  steps: readonly string[];
  expectedResult: string;
  expectedArtifact: string;
};

export type UIQIManualEvidenceRecord = {
  conditionId: string;
  protocolId: string;
  contractVersion: typeof UIQI_CONTRACT_VERSION;
  testedBuildSha: string | null;
  result: UIQIManualResult;
  date: string | null;
  artifact: string | null;
};

export type UIQIFutureCapabilityKey =
  | 'portfolioVariant'
  | 'portfolioAltAuthoring'
  | 'salonProfileHeroImage'
  | 'salonProfileHeroDerivedAlt'
  | 'serviceMenuGroupedCategories'
  | 'serviceMenuGroupedSemanticHeadings'
  | 'builderReorder'
  | 'builderKeyboardReorder'
  | 'builderDomVisualOrder';

export type UIQIFutureCapabilities = Record<UIQIFutureCapabilityKey, boolean>;

export type UIQIFutureTrigger = {
  id: string;
  activationCapability: UIQIFutureCapabilityKey;
  prerequisiteCapability: UIQIFutureCapabilityKey;
  activatesWhen: string;
  requirementWhenActive: string;
};

export type UIQICondition = {
  id: string;
  requirement: string;
  category: UIQICategory;
  applicability: UIQIApplicability;
  severity: UIQISeverity;
  evidenceType: UIQIEvidenceType;
  automatedEvidenceIds: readonly string[];
  manualProtocolId: string | null;
  futureTriggerId: string | null;
  currentStatus: UIQIStatus;
  rationale: string;
  surface: UIQISurface;
  version: typeof UIQI_CONTRACT_VERSION;
};

export const UIQI_AUTOMATED_EVIDENCE = {
  'stage2-canonical-sections': {
    id: 'stage2-canonical-sections',
    kind: 'SOURCE_GUARD',
    paths: [
      'src/libs/sectionDecisionPlan.test.ts',
      'src/libs/sectionRegistry.test.ts',
      'src/libs/sectionArchitecture.test.ts',
      'src/libs/sectionPresentation.test.ts',
      'src/libs/bookingPageBuilder.test.ts',
      'src/libs/bookingPageConfig.publishRevert.test.ts',
      'src/components/admin/BookingPageBuilder.test.tsx',
      'src/app/[locale]/admin/booking-page/page.test.tsx',
      'src/app/api/admin/booking-page/route.test.ts',
      'src/components/booking/SectionOrderRenderer.test.tsx',
      'src/app/(unauth)/book/service/BookServiceClient.editorial.test.tsx',
    ],
    command: `npx vitest run src/libs/sectionDecisionPlan.test.ts src/libs/sectionRegistry.test.ts src/libs/sectionArchitecture.test.ts src/libs/sectionPresentation.test.ts src/libs/bookingPageBuilder.test.ts src/libs/bookingPageConfig.publishRevert.test.ts src/components/admin/BookingPageBuilder.test.tsx 'src/app/[locale]/admin/booking-page/page.test.tsx' src/app/api/admin/booking-page/route.test.ts src/components/booking/SectionOrderRenderer.test.tsx 'src/app/(unauth)/book/service/BookServiceClient.editorial.test.tsx'`,
    ciContext: 'Full Vitest Suite',
    proves: 'The canonical decision owner controls readiness, hidden intent, and admission while validated owner builder operations, typed presentation resolution, the one renderer, DOM-order persistence, and the activated hero-alt, grouped-service heading, and keyboard-reorder obligations remain downstream structural boundaries.',
  },
  'public-dto-boundary': {
    id: 'public-dto-boundary',
    kind: 'SOURCE_GUARD',
    paths: ['src/libs/catalogPublicDtoBoundary.test.ts'],
    command: 'npx vitest run src/libs/catalogPublicDtoBoundary.test.ts',
    ciContext: 'Full Vitest Suite',
    proves: 'Owner-only setup, readiness, and diagnostic state do not enter anonymous public data.',
  },
  'stage3a-target-geometry': {
    id: 'stage3a-target-geometry',
    kind: 'PLAYWRIGHT',
    paths: ['tests/e2e/mobile-service-layout.e2e.ts'],
    command: 'npx playwright test tests/e2e/mobile-service-layout.e2e.ts --project=chromium --project=mobile-webkit',
    ciContext: 'Run all tests',
    proves: 'Applicable public-booking targets measure at least 44 by 44 CSS pixels without mobile overlap or overflow.',
  },
  'stage3a-dialog-focus': {
    id: 'stage3a-dialog-focus',
    kind: 'COMPOSITE',
    paths: [
      'src/components/ui/dialog-shell.test.tsx',
      'src/components/ui/confirm-dialog.test.tsx',
      'tests/e2e/mobile-admin-appointment-sheet.e2e.ts',
    ],
    command: `npx vitest run src/components/ui/dialog-shell.test.tsx src/components/ui/confirm-dialog.test.tsx && npx playwright test tests/e2e/mobile-admin-appointment-sheet.e2e.ts --project=chromium --project=mobile-webkit`,
    ciContext: 'Run all tests',
    proves: 'The shared dialog/sheet lifecycle owns initial focus, containment, topmost Escape, restoration, and cleanup.',
  },
  'stage3b-booking-states': {
    id: 'stage3b-booking-states',
    kind: 'VITEST',
    paths: ['src/app/(unauth)/book/confirm/BookConfirmClient.test.tsx'],
    command: `npx vitest run 'src/app/(unauth)/book/confirm/BookConfirmClient.test.tsx'`,
    ciContext: 'Full Vitest Suite',
    proves: 'Known data survives loading; pending, success, and conflict states retain their distinct durable semantics and safe copy.',
  },
  'stage3b-deadline': {
    id: 'stage3b-deadline',
    kind: 'VITEST',
    paths: [
      'src/components/deposits/HoldCountdown.test.tsx',
      'src/app/[locale]/[slug]/deposit/DepositStatusPanel.test.tsx',
    ],
    command: `npx vitest run src/components/deposits/HoldCountdown.test.tsx 'src/app/[locale]/[slug]/deposit/DepositStatusPanel.test.tsx'`,
    ciContext: 'Full Vitest Suite',
    proves: 'Relative and salon-local absolute deposit deadlines derive from the same authoritative expiry instant.',
  },
  'stage3c1-public-booking': {
    id: 'stage3c1-public-booking',
    kind: 'VITEST',
    paths: [
      'src/app/(unauth)/book/service/BookServiceClient.test.tsx',
      'src/app/(unauth)/book/tech/BookTechClient.test.tsx',
      'src/app/(unauth)/book/time/BookTimeClient.test.tsx',
      'src/app/(unauth)/book/confirm/BookConfirmClient.test.tsx',
    ],
    command: `npx vitest run 'src/app/(unauth)/book/service/BookServiceClient.test.tsx' 'src/app/(unauth)/book/tech/BookTechClient.test.tsx' 'src/app/(unauth)/book/time/BookTimeClient.test.tsx' 'src/app/(unauth)/book/confirm/BookConfirmClient.test.tsx'`,
    ciContext: 'Full Vitest Suite',
    proves: 'Maximum availability, landmarks, persistent labels, add-on announcements, and written Required status remain explicit.',
  },
  'stage3c2-modal-focus': {
    id: 'stage3c2-modal-focus',
    kind: 'VITEST',
    paths: [
      'src/components/admin/AppModal.test.tsx',
      'src/components/ui/dialog-shell.test.tsx',
      'src/app/[locale]/(auth)/staff/components/BottomSheet.test.tsx',
    ],
    command: `npx vitest run src/components/admin/AppModal.test.tsx src/components/ui/dialog-shell.test.tsx 'src/app/[locale]/(auth)/staff/components/BottomSheet.test.tsx'`,
    ciContext: 'Full Vitest Suite',
    proves: 'Owner/staff overlays share one topmost focus lifecycle without escaping, stale listeners, or unsafe restoration.',
  },
  'stage3c2-bottom-sheet': {
    id: 'stage3c2-bottom-sheet',
    kind: 'COMPOSITE',
    paths: [
      'src/app/[locale]/(auth)/staff/components/BottomSheet.test.tsx',
      'tests/e2e/mobile-staff-uiqi.e2e.ts',
    ],
    command: `npx vitest run 'src/app/[locale]/(auth)/staff/components/BottomSheet.test.tsx' && npx playwright test tests/e2e/mobile-staff-uiqi.e2e.ts --project=chromium --project=mobile-webkit`,
    ciContext: 'Run all tests',
    proves: 'BottomSheet pointer and keyboard resize paths converge on truthful bounded snap semantics.',
  },
  'stage3c2-destructive-confirmation': {
    id: 'stage3c2-destructive-confirmation',
    kind: 'VITEST',
    paths: [
      'src/components/admin/PortfolioModal.test.tsx',
      'src/components/admin/staff/tabs/ScheduleTab.test.tsx',
      'src/app/[locale]/(auth)/staff/schedule/page.test.tsx',
      'src/app/[locale]/(auth)/staff/components/ActionBar.test.tsx',
    ],
    command: `npx vitest run src/components/admin/PortfolioModal.test.tsx src/components/admin/staff/tabs/ScheduleTab.test.tsx 'src/app/[locale]/(auth)/staff/schedule/page.test.tsx' 'src/app/[locale]/(auth)/staff/components/ActionBar.test.tsx'`,
    ciContext: 'Full Vitest Suite',
    proves: 'Audited persisted deletions and appointment cancellation require contextual confirmation and execute at most once.',
  },
  'stage3c2-bottom-region': {
    id: 'stage3c2-bottom-region',
    kind: 'COMPOSITE',
    paths: [
      'src/app/[locale]/(auth)/staff/page.test.tsx',
      'src/components/staff/StaffBottomNav.test.tsx',
      'src/app/[locale]/(auth)/staff/components/FloatingActionBar.test.tsx',
      'tests/e2e/mobile-staff-uiqi.e2e.ts',
    ],
    command: `npx vitest run 'src/app/[locale]/(auth)/staff/page.test.tsx' src/components/staff/StaffBottomNav.test.tsx 'src/app/[locale]/(auth)/staff/components/FloatingActionBar.test.tsx' && npx playwright test tests/e2e/mobile-staff-uiqi.e2e.ts --project=chromium --project=mobile-webkit`,
    ciContext: 'Run all tests',
    proves: 'Staff navigation and contextual actions compose into one safe bottom-edge region at mobile, short-height, and zoomed layouts.',
  },
  'responsive-reduced-motion': {
    id: 'responsive-reduced-motion',
    kind: 'PLAYWRIGHT',
    paths: [
      'tests/e2e/mobile-service-layout.e2e.ts',
      'tests/e2e/mobile-staff-uiqi.e2e.ts',
    ],
    command: 'npx playwright test tests/e2e/mobile-service-layout.e2e.ts tests/e2e/mobile-staff-uiqi.e2e.ts --project=chromium --project=mobile-webkit',
    ciContext: 'Run all tests',
    proves: 'Representative public and staff surfaces retain facts, controls, and layout under reduced motion, short height, and 200% zoom approximation.',
  },
} as const satisfies Record<string, UIQIAutomatedEvidence>;

export const UIQI_MANUAL_PROTOCOLS = {
  'manual-visual-system': {
    id: 'manual-visual-system',
    deviceEnvironment: 'Physical representative phone and desktop using the release candidate',
    viewport: '320px, 375x600, representative modern phone, and desktop',
    browserOrWebView: 'Current Safari and Chromium',
    assistiveTechnology: 'Not required unless the condition also references an assistive-technology protocol',
    steps: [
      'Open each currently applicable owner, staff, and public surface named by the condition.',
      'Compare the rendered hierarchy, rhythm, labels, media, motion, and persistent facts with the frozen requirement.',
      'Exercise the relevant state transition without mutating Production data.',
      'Capture full-page and focused-detail evidence at each required viewport.',
    ],
    expectedResult: 'The condition is visibly satisfied without relying on taste-only interpretation or hidden implementation details.',
    expectedArtifact: 'Timestamped screenshots or video plus a condition-scoped checklist tied to the tested build SHA.',
  },
  'manual-state-language': {
    id: 'manual-state-language',
    deviceEnvironment: 'Release candidate with synthetic empty-state fixtures',
    viewport: '320px, 375x600, and desktop',
    browserOrWebView: 'Current Safari and Chromium',
    assistiveTechnology: 'VoiceOver or NVDA where available',
    steps: [
      'Open each applicable empty state with synthetic data.',
      'Confirm the copy names what is absent.',
      'Confirm the nearest useful recovery action is present when one exists.',
      'Capture the rendered state and accessibility tree.',
    ],
    expectedResult: 'Empty-state language is honest, specific, and actionable where recovery exists.',
    expectedArtifact: 'Screenshot, accessibility-tree capture, and checklist tied to the tested build SHA.',
  },
  'manual-contrast': {
    id: 'manual-contrast',
    deviceEnvironment: 'Release candidate on calibrated physical displays',
    viewport: 'Representative mobile and desktop viewports',
    browserOrWebView: 'Current Safari and Chromium',
    assistiveTechnology: 'Trusted contrast measurement tooling; no visual-estimate-only result',
    steps: [
      'Measure foreground/background pairs for text, controls, focus indicators, and state communication.',
      'Include normal, hover, focus, disabled, error, pending, and success states where applicable.',
      'Record measured ratios and the exact sampled colors.',
    ],
    expectedResult: 'Every applicable pair meets the frozen readable-contrast floor.',
    expectedArtifact: 'Measurement export with ratios, sampled colors, screenshots, and tested build SHA.',
  },
  'manual-focus-visibility': {
    id: 'manual-focus-visibility',
    deviceEnvironment: 'Physical keyboard on representative desktop and mobile-with-keyboard environments',
    viewport: '375x600 and desktop',
    browserOrWebView: 'Current Safari and Chromium',
    assistiveTechnology: 'Keyboard-only; VoiceOver or NVDA supplemental where available',
    steps: [
      'Traverse every applicable interactive element using keyboard input only.',
      'Confirm focus remains visibly distinguishable at each stop and is not clipped by sticky regions.',
      'Capture representative focus states and any high-risk overlay transitions.',
    ],
    expectedResult: 'Keyboard focus is consistently visible and usable without color-only ambiguity.',
    expectedArtifact: 'Video or screenshot sequence with the tested build SHA.',
  },
  'manual-color-independence': {
    id: 'manual-color-independence',
    deviceEnvironment: 'Release candidate with representative state fixtures',
    viewport: 'Representative mobile and desktop viewports',
    browserOrWebView: 'Current Safari and Chromium',
    assistiveTechnology: 'Grayscale/color-vision simulation plus accessibility-tree inspection',
    steps: [
      'Inspect every consequence-bearing status and selection state in grayscale and color-vision simulations.',
      'Confirm text, icon shape, or another non-color cue carries the meaning.',
      'Capture each applicable state.',
    ],
    expectedResult: 'No required meaning depends on color alone.',
    expectedArtifact: 'Annotated screenshots and checklist tied to the tested build SHA.',
  },
  'manual-screen-reader-time': {
    id: 'manual-screen-reader-time',
    deviceEnvironment: 'Physical iOS/macOS VoiceOver and Windows NVDA where available',
    viewport: 'Representative booking and deposit viewports',
    browserOrWebView: 'Safari with VoiceOver and Chromium with NVDA',
    assistiveTechnology: 'VoiceOver and NVDA',
    steps: [
      'Navigate salon-local appointment times and absolute deposit deadlines by semantic reading order.',
      'Confirm the date, wall-clock time, timezone context, and expiry meaning are announced without ambiguity.',
      'Record spoken output and the tested build SHA.',
    ],
    expectedResult: 'Time and deadline semantics are understandable without inspecting visual formatting.',
    expectedArtifact: 'Audio/video recording, transcript, and tested build SHA.',
  },
  'manual-social-webview': {
    id: 'manual-social-webview',
    deviceEnvironment: 'Authenticated physical-device Instagram and TikTok in-app browsers',
    viewport: 'The in-app browser viewport reported by each physical device',
    browserOrWebView: 'Real Instagram and TikTok WebViews; simulated Chromium is not equivalent',
    assistiveTechnology: 'Platform screen reader where supported',
    steps: [
      'Open the public booking link from authenticated Instagram and TikTok apps.',
      'Traverse the representative booking flow without creating an appointment.',
      'Verify focus, labels, sticky controls, zoom/text sizing, safe areas, and return navigation.',
      'Capture device/app versions and video evidence.',
    ],
    expectedResult: 'The representative flow remains readable, operable, and non-overlapping in each real WebView.',
    expectedArtifact: 'Device video, app/browser versions, checklist, and tested build SHA.',
  },
} as const satisfies Record<string, UIQIManualProtocol>;

export const UIQI_FUTURE_TRIGGERS = {
  'portfolio-alt-authoring': {
    id: 'portfolio-alt-authoring',
    activationCapability: 'portfolioVariant',
    prerequisiteCapability: 'portfolioAltAuthoring',
    activatesWhen: 'A portfolio presentation variant is included in a release candidate.',
    requirementWhenActive: 'The actual owner workflow must make informative portfolio alt text authorable before the variant is releasable.',
  },
  'salon-profile-hero-derived-alt': {
    id: 'salon-profile-hero-derived-alt',
    activationCapability: 'salonProfileHeroImage',
    prerequisiteCapability: 'salonProfileHeroDerivedAlt',
    activatesWhen: 'The salonProfile:hero_image variant is included in a release candidate.',
    requirementWhenActive: 'Hero alt must be derived from canonical salon identity/context rather than arbitrary owner-authored alt.',
  },
  'service-menu-grouped-headings': {
    id: 'service-menu-grouped-headings',
    activationCapability: 'serviceMenuGroupedCategories',
    prerequisiteCapability: 'serviceMenuGroupedSemanticHeadings',
    activatesWhen: 'The serviceMenu:grouped_categories variant is included in a release candidate.',
    requirementWhenActive: 'Every rendered group must use real semantic heading structure.',
  },
  'builder-keyboard-reorder': {
    id: 'builder-keyboard-reorder',
    activationCapability: 'builderReorder',
    prerequisiteCapability: 'builderKeyboardReorder',
    activatesWhen: 'The owner composer exposes drag or reorder capability.',
    requirementWhenActive: 'The same reorder operation must be available through keyboard and assistive-technology controls.',
  },
  'builder-dom-visual-order': {
    id: 'builder-dom-visual-order',
    activationCapability: 'builderReorder',
    prerequisiteCapability: 'builderDomVisualOrder',
    activatesWhen: 'The owner composer exposes drag or reorder capability.',
    requirementWhenActive: 'Published DOM order must match the resulting visual order.',
  },
} as const satisfies Record<string, UIQIFutureTrigger>;

type BaseCondition = Pick<UIQICondition, 'id' | 'requirement' | 'category' | 'rationale' | 'surface'>;

function automated(condition: BaseCondition, automatedEvidenceIds: readonly string[]): UIQICondition {
  return {
    ...condition,
    applicability: 'AUTOMATED_CURRENT',
    severity: 'REQUIRED',
    evidenceType: 'AUTOMATED_TEST',
    automatedEvidenceIds,
    manualProtocolId: null,
    futureTriggerId: null,
    currentStatus: 'PASS',
    version: UIQI_CONTRACT_VERSION,
  };
}

function structural(condition: BaseCondition, automatedEvidenceIds: readonly string[]): UIQICondition {
  return {
    ...condition,
    applicability: 'STRUCTURAL_INVARIANT',
    severity: 'REQUIRED',
    evidenceType: 'SOURCE_GUARD',
    automatedEvidenceIds,
    manualProtocolId: null,
    futureTriggerId: null,
    currentStatus: 'PASS',
    version: UIQI_CONTRACT_VERSION,
  };
}

function manual(condition: BaseCondition, manualProtocolId: keyof typeof UIQI_MANUAL_PROTOCOLS): UIQICondition {
  return {
    ...condition,
    applicability: 'MANUAL_CURRENT',
    severity: 'REQUIRED',
    evidenceType: 'MANUAL_PROTOCOL',
    automatedEvidenceIds: [],
    manualProtocolId,
    futureTriggerId: null,
    currentStatus: 'PENDING_MANUAL',
    version: UIQI_CONTRACT_VERSION,
  };
}

function future(condition: BaseCondition, futureTriggerId: keyof typeof UIQI_FUTURE_TRIGGERS): UIQICondition {
  return {
    ...condition,
    applicability: 'FUTURE_TRIGGERED',
    severity: 'REQUIRED',
    evidenceType: 'FUTURE_TRIGGER',
    automatedEvidenceIds: [],
    manualProtocolId: null,
    futureTriggerId,
    currentStatus: 'FUTURE_TRIGGERED',
    version: UIQI_CONTRACT_VERSION,
  };
}

export const UIQI_CONDITIONS: readonly UIQICondition[] = [
  manual({ id: 'system.semantic-typography-levels', requirement: 'Use fixed semantic typography levels.', category: 'SYSTEM', surface: 'SHARED', rationale: 'Typography is currently shipped across heterogeneous surfaces; honest system-wide proof requires rendered review rather than class-name matching.' }, 'manual-visual-system'),
  manual({ id: 'system.operational-body-typography', requirement: 'Render operational price, time, and status content with dependable body typography.', category: 'SYSTEM', surface: 'SHARED', rationale: 'Representative automation exists, but system-wide legibility remains a rendered/manual claim.' }, 'manual-visual-system'),
  manual({ id: 'system.range-qualifiers-legible', requirement: 'Keep range qualifiers out of fine print.', category: 'SYSTEM', surface: 'SHARED', rationale: 'Rendered size and context must be judged on actual devices.' }, 'manual-visual-system'),
  manual({ id: 'system.single-spacing-rhythm', requirement: 'Use one coherent spacing rhythm.', category: 'SYSTEM', surface: 'SHARED', rationale: 'A global regex over utility classes would be brittle and would not prove perceived rhythm.' }, 'manual-visual-system'),
  manual({ id: 'system.divider-separation', requirement: 'Provide separation before dividers.', category: 'SYSTEM', surface: 'SHARED', rationale: 'The requirement is visual and contextual, so manual rendered evidence is the narrow truthful claim.' }, 'manual-visual-system'),
  manual({ id: 'system.card-object-rule', requirement: 'Use cards only for one selectable object, summary, recovery action, or coherent receipt object.', category: 'SYSTEM', surface: 'SHARED', rationale: 'Card semantics require contextual review; source shape alone cannot prove the grouping is coherent.' }, 'manual-visual-system'),
  manual({ id: 'system.sheet-route-rule', requirement: 'Apply the explicit sheet-versus-route rule consistently.', category: 'SYSTEM', surface: 'SHARED', rationale: 'Current surfaces are applicable, but route-versus-sheet suitability requires interaction review.' }, 'manual-visual-system'),
  automated({ id: 'system.one-sticky-region-per-edge', requirement: 'Allow only one sticky or fixed operational region per edge.', category: 'SYSTEM', surface: 'SHARED', rationale: 'Stage 3C2 browser geometry now discriminates the current staff conflict and representative booking edges.' }, ['stage3c2-bottom-region']),
  automated({ id: 'system.no-competing-floating-control', requirement: 'Do not let sticky regions compete with floating chat or operational controls at the same edge.', category: 'SYSTEM', surface: 'SHARED', rationale: 'The current reachable staff composition is covered by labeled fixed-region and overlap assertions.' }, ['stage3c2-bottom-region']),
  structural({ id: 'system.sticky-fact-has-durable-copy', requirement: 'Never make a sticky region the only location of a critical fact.', category: 'SYSTEM', surface: 'CLIENT', rationale: 'Current booking summaries and durable receipt/state tests pin critical facts outside transient sticky controls.' }, ['stage3b-booking-states', 'stage3c1-public-booking']),
  manual({ id: 'system.nav-cta-handoff', requirement: 'Extend rather than duplicate the navigation-to-CTA handoff.', category: 'SYSTEM', surface: 'SHARED', rationale: 'The handoff is currently rendered and requires whole-flow review rather than a global source heuristic.' }, 'manual-visual-system'),
  manual({ id: 'system.operational-icons-have-meaning', requirement: 'Give operational icons visible and understandable meaning.', category: 'SYSTEM', surface: 'SHARED', rationale: 'Specific controls are automated, but the system-wide claim still requires manual inventory evidence.' }, 'manual-visual-system'),
  automated({ id: 'system.maximum-availability-written', requirement: 'Write maximum availability explicitly instead of representing it only with a shuffle or random icon.', category: 'SYSTEM', surface: 'CLIENT', rationale: 'Stage 3C1 asserts exact client-visible meaning while preserving the any-technician value and request path.' }, ['stage3c1-public-booking']),
  manual({ id: 'system.media-reserved-aspect-ratio', requirement: 'Reserve media aspect ratios where layout stability requires media.', category: 'SYSTEM', surface: 'SHARED', rationale: 'Rendered stability across current media surfaces requires browser/device evidence.' }, 'manual-visual-system'),
  manual({ id: 'system.media-alt-strategy', requirement: 'Author informative alt text and mark decorative media explicitly decorative.', category: 'SYSTEM', surface: 'SHARED', rationale: 'Static lint can prove presence, but meaningfulness and decorative intent require manual content review.' }, 'manual-visual-system'),
  manual({ id: 'system.critical-facts-not-rasterized', requirement: 'Never place critical facts only inside raster imagery.', category: 'SYSTEM', surface: 'SHARED', rationale: 'A rendered content inventory is required to prove that image text is not the sole durable source.' }, 'manual-visual-system'),
  manual({ id: 'system.motion-explains-state-change', requirement: 'Use motion only to explain state change.', category: 'SYSTEM', surface: 'SHARED', rationale: 'Intent and necessity of current motion require manual interaction review.' }, 'manual-visual-system'),
  manual({ id: 'system.state-understandable-without-motion', requirement: 'Keep the resulting state understandable without motion.', category: 'SYSTEM', surface: 'SHARED', rationale: 'Reduced-motion automation preserves representative state, while system-wide comprehension remains manual.' }, 'manual-visual-system'),

  automated({ id: 'state.loading-retains-known-data', requirement: 'Loading retains already-known valid data where possible.', category: 'STATE', surface: 'CLIENT', rationale: 'Stage 3B holds booking submission unresolved and asserts that known review facts remain.' }, ['stage3b-booking-states']),
  manual({ id: 'state.empty-identifies-and-recovers', requirement: 'Empty states identify what is absent and provide the nearest useful action where applicable.', category: 'STATE', surface: 'SHARED', rationale: 'Current empty states are reachable, but semantic adequacy across domains needs fixture-based manual review.' }, 'manual-state-language'),
  structural({ id: 'state.incomplete-owner-only', requirement: 'Keep incomplete owner setup diagnosis editor-only.', category: 'STATE', surface: 'SHARED', rationale: 'Stage 2 decisions and the public DTO guard keep readiness explanations outside anonymous output.' }, ['stage2-canonical-sections', 'public-dto-boundary']),
  structural({ id: 'state.hidden-publicly-absent-restorable', requirement: 'Keep hidden content publicly absent while preserving owner-restorable canonical content.', category: 'STATE', surface: 'SHARED', rationale: 'Stage 2 decision-plan tests distinguish hidden intent, public omission, and retained canonical content.' }, ['stage2-canonical-sections']),
  structural({ id: 'state.unsupported-honest', requirement: 'Represent unsupported capability honestly without a false promise or fake affordance.', category: 'STATE', surface: 'SHARED', rationale: 'Registry/readiness and public-boundary guards prevent unsupported owner diagnostics from becoming public controls.' }, ['stage2-canonical-sections', 'public-dto-boundary']),
  automated({ id: 'state.pending-not-confirmed', requirement: 'Keep pending visually and semantically distinct from confirmed success.', category: 'STATE', surface: 'CLIENT', rationale: 'Stage 3B exercises request-approval responses and rejects confirmed copy, icons, and celebration.' }, ['stage3b-booking-states']),
  automated({ id: 'state.success-durable-receipt-first', requirement: 'Lead success with the durable receipt or status rather than transient celebration.', category: 'STATE', surface: 'CLIENT', rationale: 'Stage 3B pins semantic/DOM order and confirmed-versus-request status.' }, ['stage3b-booking-states']),
  automated({ id: 'state.conflict-old-to-current-safe-copy', requirement: 'Show meaningful old to current conflict recovery without exposing a raw technical code.', category: 'STATE', surface: 'CLIENT', rationale: 'Stage 3B preserves the reviewed Smart Fit value, renders the authoritative current value, and sanitizes hostile errors.' }, ['stage3b-booking-states']),

  automated({ id: 'a11y.practical-target-floor', requirement: 'Keep applicable practical interactive targets at least 44 by 44 CSS pixels.', category: 'ACCESSIBILITY', surface: 'SHARED', rationale: 'Stage 3A browser geometry measures both dimensions and rejects overlap/overflow regressions.' }, ['stage3a-target-geometry', 'stage3c2-bottom-region']),
  manual({ id: 'a11y.readable-contrast', requirement: 'Provide readable contrast for text, controls, focus, and states.', category: 'ACCESSIBILITY', surface: 'SHARED', rationale: 'The repository has no trustworthy dependency-free contrast measurement that proves rendered combinations.' }, 'manual-contrast'),
  manual({ id: 'a11y.visible-focus', requirement: 'Provide a visible focus indicator for every keyboard-operable control.', category: 'ACCESSIBILITY', surface: 'SHARED', rationale: 'Focus movement is automated; rendered visibility and contrast require physical/manual evidence.' }, 'manual-focus-visibility'),
  automated({ id: 'a11y.semantic-headings-landmarks', requirement: 'Use coherent semantic headings and landmarks.', category: 'ACCESSIBILITY', surface: 'CLIENT', rationale: 'Stage 3C1 component and browser assertions pin one main landmark and coherent heading ownership on booking steps.' }, ['stage3c1-public-booking']),
  automated({ id: 'a11y.persistent-labels', requirement: 'Keep operational labels persistent and tied to their controls.', category: 'ACCESSIBILITY', surface: 'SHARED', rationale: 'Stage 3C1 pins add-on-specific accessible names and persistent booking labels.' }, ['stage3c1-public-booking']),
  automated({ id: 'a11y.required-optional-written', requirement: 'Write Required and Optional explicitly where the distinction applies.', category: 'ACCESSIBILITY', surface: 'CLIENT', rationale: 'Stage 3C1 verifies required policy status and truthful required-only, optional-only, and mixed add-on wording.' }, ['stage3c1-public-booking']),
  automated({ id: 'a11y.current-drag-keyboard-alternative', requirement: 'Provide a keyboard and assistive-technology alternative for every currently shipped drag action.', category: 'ACCESSIBILITY', surface: 'OWNER', rationale: 'Stage 3C2 proves truthful keyboard slider semantics and pointer/keyboard convergence for BottomSheet resizing.' }, ['stage3c2-bottom-sheet']),
  future({ id: 'a11y.builder-drag-keyboard-alternative', requirement: 'Require a keyboard and assistive-technology alternative when builder drag reorder ships.', category: 'ACCESSIBILITY', surface: 'OWNER', rationale: 'Stage 6 activates this trigger and proves the same validated reorder operation is available through named native keyboard controls.' }, 'builder-keyboard-reorder'),
  structural({ id: 'a11y.current-dom-visual-order', requirement: 'Keep current DOM order aligned with visual reading order.', category: 'ACCESSIBILITY', surface: 'SHARED', rationale: 'Canonical section ordering and semantic receipt/overlay tests pin current reading order at structural seams.' }, ['stage2-canonical-sections', 'stage3b-booking-states', 'stage3c2-modal-focus']),
  future({ id: 'a11y.builder-dom-visual-order', requirement: 'Require published DOM order to match visual order after builder reorder.', category: 'ACCESSIBILITY', surface: 'OWNER', rationale: 'Stage 6 activates this trigger and proves persisted canonical order drives both owner feedback and the shared public renderer DOM.' }, 'builder-dom-visual-order'),
  manual({ id: 'a11y.no-color-alone', requirement: 'Never communicate required meaning through color alone.', category: 'ACCESSIBILITY', surface: 'SHARED', rationale: 'Representative text semantics are automated, while the complete rendered state inventory requires manual evidence.' }, 'manual-color-independence'),
  automated({ id: 'a11y.price-time-change-announcement', requirement: 'Textually announce material price and time changes.', category: 'ACCESSIBILITY', surface: 'CLIENT', rationale: 'Stage 3C1 asserts one atomic add-on update derived from the same visible canonical totals.' }, ['stage3c1-public-booking']),
  automated({ id: 'a11y.sheet-focus-containment-return', requirement: 'Contain sheet focus and return it safely on close.', category: 'ACCESSIBILITY', surface: 'SHARED', rationale: 'Stage 3A and 3C2 jointly cover public, owner, and staff overlay primitives using one topmost lifecycle.' }, ['stage3a-dialog-focus', 'stage3c2-modal-focus']),
  automated({ id: 'a11y.destructive-confirmation', requirement: 'Require contextual confirmation before meaningful destructive actions.', category: 'ACCESSIBILITY', surface: 'OWNER', rationale: 'Stage 3C2 proves cancel has zero mutations and confirm performs exactly one existing mutation for audited domains.' }, ['stage3c2-destructive-confirmation']),
  automated({ id: 'a11y.reduced-motion-parity', requirement: 'Provide equivalent state information with reduced motion.', category: 'ACCESSIBILITY', surface: 'SHARED', rationale: 'Representative public and staff browser lanes explicitly emulate reduced motion and retain usable state.' }, ['responsive-reduced-motion']),
  automated({ id: 'a11y.salon-local-time-semantic-output', requirement: 'Expose salon-local time with unambiguous semantic text and timezone context.', category: 'ACCESSIBILITY', surface: 'CLIENT', rationale: 'Stage 3B date/time tests pin the IANA timezone-derived visible and semantic output.' }, ['stage3b-deadline']),
  manual({ id: 'a11y.salon-local-time-screen-reader', requirement: 'Make salon-local time understandable through a real screen reader.', category: 'ACCESSIBILITY', surface: 'CLIENT', rationale: 'Semantic output automation is not equivalent to assistive-technology usability evidence.' }, 'manual-screen-reader-time'),
  automated({ id: 'a11y.absolute-deadline-semantic-output', requirement: 'Expose absolute deadlines in readable semantic text alongside relative urgency.', category: 'ACCESSIBILITY', surface: 'CLIENT', rationale: 'Stage 3B proves countdown and absolute deadline share the same expiry instant and semantic datetime.' }, ['stage3b-deadline']),
  manual({ id: 'a11y.absolute-deadline-screen-reader', requirement: 'Make absolute deadlines understandable through a real screen reader.', category: 'ACCESSIBILITY', surface: 'CLIENT', rationale: 'Actual spoken comprehension cannot be inferred from component markup alone.' }, 'manual-screen-reader-time'),
  automated({ id: 'a11y.zoom-200', requirement: 'Preserve facts and controls at 200 percent zoom or text resizing.', category: 'ACCESSIBILITY', surface: 'SHARED', rationale: 'Stage 3A/3C1/3C2 browser lanes exercise the repository-standard 200% CSS zoom approximation.' }, ['stage3a-target-geometry', 'responsive-reduced-motion']),
  automated({ id: 'a11y.short-height-keyboard', requirement: 'Keep controls and facts usable at short-height keyboard-oriented viewports.', category: 'ACCESSIBILITY', surface: 'SHARED', rationale: 'Representative 375x600 and short-height browser lanes assert no sticky collision, clipping, or lost action.' }, ['stage3a-target-geometry', 'stage3c2-bottom-region']),
  manual({ id: 'a11y.instagram-tiktok-webview', requirement: 'Validate the public experience in real Instagram and TikTok WebViews.', category: 'ACCESSIBILITY', surface: 'CLIENT', rationale: 'No authenticated physical in-app WebView is available in CI; Chromium simulation would be a false claim.' }, 'manual-social-webview'),

  future({ id: 'future.portfolio-alt-authoring', requirement: 'Block any portfolio variant until informative alt text is authorable in the actual owner workflow.', category: 'NAMED_OBLIGATION', surface: 'OWNER', rationale: 'Portfolio presentation remains a future capability and must activate this prerequisite before release.' }, 'portfolio-alt-authoring'),
  future({ id: 'future.salon-profile-hero-derived-alt', requirement: 'Require salonProfile:hero_image alt to derive from canonical salon identity and context.', category: 'NAMED_OBLIGATION', surface: 'CLIENT', rationale: 'Stage 4 ships the hero-image variant, so its active trigger requires canonical identity-derived alt before release.' }, 'salon-profile-hero-derived-alt'),
  future({ id: 'future.service-menu-grouped-headings', requirement: 'Require real semantic headings for serviceMenu:grouped_categories groups.', category: 'NAMED_OBLIGATION', surface: 'CLIENT', rationale: 'Stage 5 ships the grouped-categories variant, so its active trigger requires real semantic group headings before release.' }, 'service-menu-grouped-headings'),
] as const;

export const UIQI_CONTRACT_METADATA = {
  version: UIQI_CONTRACT_VERSION,
  expectedConditionCount: 51,
  meaningFingerprint: 'a09ed82abebb0b63fdc5a0a04227a4ff0757004670932e9f8570a1f17ea479ac',
  canonicalSource: 'src/libs/uiqi/uiqiContract.ts',
  generatedReport: 'docs/uiqi/UIQI-CONTRACT-STATUS.generated.md',
  aggregateGate: 'npx tsx scripts/run-uiqi-release-gate.ts',
  ciContext: 'UIQI release conditions',
} as const;

export const UIQI_DEFAULT_FUTURE_CAPABILITIES: UIQIFutureCapabilities = {
  portfolioVariant: false,
  portfolioAltAuthoring: false,
  salonProfileHeroImage: SECTION_PRESENTATION_UIQI_CAPABILITIES.salonProfileHeroImage,
  salonProfileHeroDerivedAlt: SECTION_PRESENTATION_UIQI_CAPABILITIES.salonProfileHeroDerivedAlt,
  serviceMenuGroupedCategories: SECTION_PRESENTATION_UIQI_CAPABILITIES.serviceMenuGroupedCategories,
  serviceMenuGroupedSemanticHeadings: SECTION_PRESENTATION_UIQI_CAPABILITIES.serviceMenuGroupedSemanticHeadings,
  builderReorder: BOOKING_PAGE_BUILDER_UIQI_CAPABILITIES.builderReorder,
  builderKeyboardReorder: BOOKING_PAGE_BUILDER_UIQI_CAPABILITIES.builderKeyboardReorder,
  builderDomVisualOrder: BOOKING_PAGE_BUILDER_UIQI_CAPABILITIES.builderDomVisualOrder,
};

export const UIQI_MANUAL_EVIDENCE: readonly UIQIManualEvidenceRecord[] = UIQI_CONDITIONS
  .filter(condition => condition.applicability === 'MANUAL_CURRENT')
  .map(condition => ({
    conditionId: condition.id,
    protocolId: condition.manualProtocolId!,
    contractVersion: UIQI_CONTRACT_VERSION,
    testedBuildSha: null,
    result: 'PENDING',
    date: null,
    artifact: null,
  }));
