import { ArrowRight, CalendarDays, FileUp, Instagram, Sparkles } from 'lucide-react';
import {
  type CSSProperties,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';

import { summarizeSelection } from '../booking/helpers';
import {
  getStarterPageDefinitions,
  type StarterPageDefinition,
  type StarterSectionDefinition,
} from '../model/starters';
import type { OriginStarter } from '../model/types';

type StarterChooserProps = {
  onChoose: (starter: OriginStarter) => void;
  onImport?: (file: File) => void;
};

type PreviewItem = {
  label: string;
  meta?: string;
};

type PreviewScene = {
  action?: string;
  body?: string;
  durationMs: number;
  eyebrow?: string;
  heading: string;
  id: string;
  items?: readonly PreviewItem[];
  kind: 'about' | 'booking' | 'contact' | 'custom_design' | 'gallery' | 'hero' | 'reviews' | 'services';
  navigation?: string;
  structureLabels: readonly string[];
};

type PreviewPosterContent = {
  action?: string;
  heading: string;
  items: readonly PreviewItem[];
  kind: 'multi-home' | 'one-page-map' | 'quick-summary';
  label: string;
};

type StarterPreviewDefinition = {
  durationMs: number;
  finalFrame: string;
  middleDistance?: string;
  motionDistance: string;
  navigationItems: readonly string[];
  poster: PreviewPosterContent;
  posterState: string;
  previewType: 'continuous-scroll' | 'design-walkthrough' | 'page-switch' | 'short-scroll';
  scenes: readonly PreviewScene[];
};

export type StarterChoiceDefinition = {
  cta: string;
  description: string;
  id: OriginStarter;
  includedItems: readonly string[];
  includesLabel: string;
  preview: StarterPreviewDefinition;
  title: string;
};

/** Composition chrome (`summary: false`) stays out of owner-facing summaries. */
const summarySections = (
  page: ReturnType<typeof getStarterPageDefinitions>[number],
) => page.sections.filter(section => section.summary !== false);

const getIncludedItems = (starter: OriginStarter): readonly string[] => {
  const pages = getStarterPageDefinitions(starter);
  return starter === 'multi_page'
    ? pages.map(page => page.previewLabel ?? page.name)
    : pages.flatMap(page => summarySections(page).map(section => section.previewLabel));
};

const CANONICAL_FEATURED_SELECTION = summarizeSelection({
  addOnIds: ['addon-french'],
  serviceId: 'svc-manicure-russian',
});
const CANONICAL_SECONDARY_SELECTION = summarizeSelection({
  addOnIds: [],
  serviceId: 'svc-builder-overlay',
});

const CANONICAL_SERVICE_ITEMS: readonly PreviewItem[] = [
  CANONICAL_FEATURED_SELECTION,
  CANONICAL_SECONDARY_SELECTION,
].flatMap(selection => selection
  ? [{
      label: [
        selection.service.name,
        ...selection.addOns.map(({ name }) => name),
      ].join(' + '),
      meta: `${selection.durationLabel} · ${selection.price.label}`,
    }]
  : []);

type StarterChoiceCopy = Omit<StarterChoiceDefinition, 'includedItems' | 'preview'>;

const STARTER_CHOICE_COPY: Record<OriginStarter, StarterChoiceCopy> = {
  quick_book: {
    cta: 'Start with Quick Book',
    description: 'Start taking bookings with only the essentials.',
    id: 'quick_book',
    includesLabel: 'Includes',
    title: 'Quick Book',
  },
  your_design: {
    cta: 'Start with Your Design',
    description: 'Use your Canva design, AI artwork, or your own image.',
    id: 'your_design',
    includesLabel: 'Includes',
    title: 'Your Design',
  },
  one_page: {
    cta: 'Start with One-page',
    description: 'Show your whole business on one scrolling page.',
    id: 'one_page',
    includesLabel: 'Includes',
    title: 'One-page website',
  },
  multi_page: {
    cta: 'Start with Full Website',
    description: 'Give each part of your business its own page and navigation link.',
    id: 'multi_page',
    includesLabel: 'Includes pages',
    title: 'Full Website',
  },
};

const getSceneKind = (labels: readonly string[]): PreviewScene['kind'] => {
  const normalized = labels.join(' ').toLocaleLowerCase();
  if (normalized.includes('your design')) {
    return 'custom_design';
  }
  if (normalized.includes('service') || normalized.includes('booking')) {
    return 'services';
  }
  if (normalized.includes('gallery') || normalized.includes('featured work')) {
    return 'gallery';
  }
  if (normalized.includes('about')) {
    return 'about';
  }
  if (normalized.includes('review')) {
    return 'reviews';
  }
  if (normalized.includes('visit') || normalized.includes('contact')) {
    return 'contact';
  }
  if (normalized.includes('book')) {
    return 'booking';
  }
  return 'hero';
};

const getSceneCopy = (
  kind: PreviewScene['kind'],
  heading: string,
): Pick<PreviewScene, 'action' | 'body' | 'eyebrow' | 'heading' | 'items'> => {
  switch (kind) {
    case 'custom_design':
      return { body: 'Your exported artwork appears here, above booking.', heading };
    case 'services':
      return {
        action: 'Book an appointment',
        heading,
        items: CANONICAL_SERVICE_ITEMS,
      };
    case 'booking':
      return {
        action: 'Book an appointment',
        body: 'Choose your service and preferred time.',
        eyebrow: 'Booking',
        heading,
      };
    case 'about':
      return { body: 'Meet the nail artist behind the studio.', heading };
    case 'reviews':
      return { body: 'See what clients appreciate about their visits.', heading };
    case 'contact':
      return { body: 'Find contact and appointment details.', heading };
    case 'gallery':
      return { heading };
    case 'hero':
      return { action: 'Explore the studio', eyebrow: heading, heading: 'Nails designed around you.' };
  }
};

const createSectionScene = (
  section: StarterSectionDefinition,
  index: number,
): PreviewScene => {
  const kind = section.previewLabel === 'Booking'
    ? 'booking'
    : getSceneKind([section.previewLabel]);
  return {
    ...getSceneCopy(kind, section.previewLabel),
    durationMs: kind === 'booking' ? 1_050 : 900,
    id: `section-${index}-${section.previewLabel.toLocaleLowerCase().replaceAll(/[^a-z0-9]+/gu, '-')}`,
    kind,
    structureLabels: [section.previewLabel],
  };
};

const createPageScene = (
  page: StarterPageDefinition,
  index: number,
): PreviewScene => {
  const structureLabels = summarySections(page).map(({ previewLabel }) => previewLabel);
  const kind = index === 0 && page.slug === '' ? 'hero' : getSceneKind(structureLabels);
  const heading = page.previewLabel ?? page.name;
  return {
    ...getSceneCopy(kind, heading),
    durationMs: 1_120,
    id: `page-${index}-${page.slug || 'home'}`,
    kind,
    navigation: page.name,
    structureLabels,
  };
};

const createStarterPreview = (starter: OriginStarter): StarterPreviewDefinition => {
  const pages = getStarterPageDefinitions(starter);
  const scenes = starter === 'multi_page'
    ? pages.map(createPageScene)
    : pages.flatMap(page => summarySections(page)).map(createSectionScene);
  const posterItems = starter === 'multi_page'
    ? pages.map(page => ({
      label: page.previewLabel ?? page.name,
      meta: summarySections(page).map(({ previewLabel }) => previewLabel).join(' · '),
    }))
    : pages.flatMap(page => summarySections(page).map(({ previewLabel }) => ({ label: previewLabel })));
  const posterKind = starter === 'quick_book'
    ? 'quick-summary'
    : starter === 'one_page'
      ? 'one-page-map'
      : 'multi-home';
  const previewType = starter === 'quick_book'
    ? 'short-scroll'
    : starter === 'one_page'
      ? 'continuous-scroll'
      : 'page-switch';

  return {
    durationMs: starter === 'quick_book' ? 4_800 : starter === 'multi_page' ? 7_000 : 5_800,
    finalFrame: scenes.at(-1)?.id ?? 'site',
    ...(starter === 'quick_book' ? { middleDistance: '-33.3333%' } : {}),
    motionDistance: starter === 'multi_page' ? '8px' : '-66.6667%',
    navigationItems: starter === 'quick_book' ? [] : pages.map(({ name }) => name),
    poster: {
      ...(starter === 'quick_book' || starter === 'multi_page'
        ? { action: 'Book an appointment' }
        : {}),
      heading: starter === 'quick_book'
        ? 'A focused path from services to booking.'
        : starter === 'your_design'
          ? 'Your artwork, followed by booking.'
          : starter === 'one_page'
            ? 'Your whole studio, all in one place.'
            : 'A home page with separate destinations.',
      items: posterItems,
      kind: posterKind,
      label: starter === 'quick_book'
        ? 'Booking-focused page'
        : starter === 'your_design'
          ? 'Artwork-led booking page'
          : starter === 'one_page'
            ? 'One continuous page'
            : 'Five connected pages',
    },
    posterState: starter === 'quick_book'
      ? 'booking-summary'
      : starter === 'one_page'
        ? 'page-overview'
        : 'site-map',
    previewType: starter === 'your_design' ? 'design-walkthrough' : previewType,
    scenes,
  };
};

export const STARTER_CHOICES: readonly StarterChoiceDefinition[] = (
  ['quick_book', 'your_design', 'multi_page'] as const
).map(starter => ({
  ...STARTER_CHOICE_COPY[starter],
  includedItems: getIncludedItems(starter),
  preview: createStarterPreview(starter),
}));

const RESET_DELAY_MS = 180;
const MOBILE_ACTIVE_RATIO = 0.64;
const OFFSCREEN_RATIO = 0.05;
const STARTER_IDS = STARTER_CHOICES.map(({ id }) => id);

type PreviewCssProperties = CSSProperties & {
  '--preview-duration': string;
  '--preview-middle-distance'?: string;
  '--preview-motion-distance': string;
};

export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => (
    typeof window === 'undefined' || typeof window.matchMedia !== 'function'
      ? false
      : window.matchMedia(query).matches
  ));

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') {
      return undefined;
    }
    const mediaQuery = window.matchMedia(query);
    const updateMatch = () => setMatches(mediaQuery.matches);

    updateMatch();
    mediaQuery.addEventListener('change', updateMatch);
    return () => mediaQuery.removeEventListener('change', updateMatch);
  }, [query]);

  return matches;
}

function useStarterPreviewPlayback(forceReducedMotion = false) {
  const hasFinePointer = useMediaQuery('(any-hover: hover) and (any-pointer: fine)');
  const systemPrefersReducedMotion = useMediaQuery('(prefers-reduced-motion: reduce)');
  const prefersReducedMotion = forceReducedMotion || systemPrefersReducedMotion;
  const [interactionActiveId, setInteractionActiveId] = useState<OriginStarter | null>(null);
  const [cardRatios, setCardRatios] = useState<Partial<Record<OriginStarter, number>>>({});
  const [pageVisible, setPageVisible] = useState(() => document.visibilityState !== 'hidden');
  const cardElementsRef = useRef(new Map<OriginStarter, HTMLButtonElement>());
  const focusedIdRef = useRef<OriginStarter | null>(null);
  const hoveredIdRef = useRef<OriginStarter | null>(null);
  const resetTimerRef = useRef<number | null>(null);

  const clearResetTimer = useCallback(() => {
    if (resetTimerRef.current !== null) {
      window.clearTimeout(resetTimerRef.current);
      resetTimerRef.current = null;
    }
  }, []);

  const startInteractionPreview = useCallback((starterId: OriginStarter) => {
    clearResetTimer();
    if (!prefersReducedMotion) {
      setInteractionActiveId(starterId);
    }
  }, [clearResetTimer, prefersReducedMotion]);

  const settleInteractionPreview = useCallback((fallbackId: OriginStarter | null) => {
    clearResetTimer();
    if (fallbackId) {
      setInteractionActiveId(fallbackId);
      return;
    }
    resetTimerRef.current = window.setTimeout(() => {
      setInteractionActiveId(null);
      resetTimerRef.current = null;
    }, RESET_DELAY_MS);
  }, [clearResetTimer]);

  const registerCard = useCallback((starterId: OriginStarter, element: HTMLButtonElement | null) => {
    if (element) {
      cardElementsRef.current.set(starterId, element);
    } else {
      cardElementsRef.current.delete(starterId);
    }
  }, []);

  const onCardMouseEnter = useCallback((starterId: OriginStarter) => {
    if (!hasFinePointer) {
      return;
    }
    hoveredIdRef.current = starterId;
    startInteractionPreview(starterId);
  }, [hasFinePointer, startInteractionPreview]);

  const onCardMouseLeave = useCallback((starterId: OriginStarter) => {
    if (!hasFinePointer || hoveredIdRef.current !== starterId) {
      return;
    }
    hoveredIdRef.current = null;
    settleInteractionPreview(focusedIdRef.current);
  }, [hasFinePointer, settleInteractionPreview]);

  const onCardFocus = useCallback((starterId: OriginStarter) => {
    focusedIdRef.current = starterId;
    startInteractionPreview(starterId);
  }, [startInteractionPreview]);

  const onCardBlur = useCallback((starterId: OriginStarter) => {
    if (focusedIdRef.current !== starterId) {
      return;
    }
    focusedIdRef.current = null;
    settleInteractionPreview(hasFinePointer ? hoveredIdRef.current : null);
  }, [hasFinePointer, settleInteractionPreview]);

  useEffect(() => {
    const updateVisibility = () => setPageVisible(document.visibilityState !== 'hidden');
    document.addEventListener('visibilitychange', updateVisibility);
    return () => document.removeEventListener('visibilitychange', updateVisibility);
  }, []);

  useEffect(() => {
    if (!prefersReducedMotion) {
      return;
    }
    clearResetTimer();
    hoveredIdRef.current = null;
    setInteractionActiveId(null);
  }, [clearResetTimer, prefersReducedMotion]);

  useEffect(() => {
    if (prefersReducedMotion || typeof IntersectionObserver === 'undefined') {
      return undefined;
    }

    const thresholds = Array.from({ length: 21 }, (_, index) => index / 20);
    const observer = new IntersectionObserver((entries) => {
      setCardRatios((currentRatios) => {
        let changed = false;
        const nextRatios = { ...currentRatios };
        for (const entry of entries) {
          const starterId = (entry.target as HTMLElement).dataset.starterId as OriginStarter | undefined;
          if (!starterId) {
            continue;
          }
          const nextRatio = entry.isIntersecting ? entry.intersectionRatio : 0;
          if (nextRatios[starterId] !== nextRatio) {
            nextRatios[starterId] = nextRatio;
            changed = true;
          }
        }
        return changed ? nextRatios : currentRatios;
      });
    }, { threshold: thresholds });

    for (const card of cardElementsRef.current.values()) {
      observer.observe(card);
    }
    return () => observer.disconnect();
  }, [prefersReducedMotion]);

  useEffect(() => () => clearResetTimer(), [clearResetTimer]);

  const mobileActiveId = hasFinePointer
    ? null
    : STARTER_IDS.reduce<OriginStarter | null>((winner, starterId) => {
      const ratio = cardRatios[starterId] ?? 0;
      if (ratio < MOBILE_ACTIVE_RATIO) {
        return winner;
      }
      if (!winner || ratio > (cardRatios[winner] ?? 0)) {
        return starterId;
      }
      return winner;
    }, null);
  const interactionRatio = interactionActiveId ? cardRatios[interactionActiveId] : undefined;
  const visibleInteractionId = interactionActiveId
    && (interactionRatio === undefined || interactionRatio >= OFFSCREEN_RATIO)
    ? interactionActiveId
    : null;
  const activeId = prefersReducedMotion ? null : visibleInteractionId ?? mobileActiveId;

  return {
    activeId,
    onCardBlur,
    onCardFocus,
    onCardMouseEnter,
    onCardMouseLeave,
    pageVisible,
    prefersReducedMotion,
    registerCard,
  };
}

function PreviewHeader({
  businessName = 'Your studio',
  definition,
  logoUrl,
}: {
  businessName?: string;
  definition: StarterPreviewDefinition;
  logoUrl?: string;
}) {
  return (
    <span className="final-starter-preview__header">
      <span className="final-starter-preview__identity">
        {logoUrl
          ? <img alt="" className="final-starter-preview__logo" data-media-role="logo" src={logoUrl} />
          : <i>{businessName.trim().charAt(0).toLocaleUpperCase() || 'Y'}</i>}
        <b title={businessName}>{businessName}</b>
      </span>
      <span className="final-starter-preview__nav">
        {definition.navigationItems.map((item, index) => (
          <span className={index === 0 ? 'is-poster-active' : undefined} key={item}>{item}</span>
        ))}
      </span>
    </span>
  );
}

function PreviewPoster({
  businessName,
  ownerName,
  poster,
  publicLocation,
}: {
  businessName: string;
  ownerName?: string;
  poster: PreviewPosterContent;
  publicLocation?: string;
}) {
  const profileLine = [ownerName?.trim(), publicLocation?.trim()].filter(Boolean).join(' · ');
  return (
    <span className={`final-starter-preview__poster is-${poster.kind}`} data-preview-poster={poster.kind}>
      <span className="final-starter-preview__poster-copy">
        <small>{poster.label}</small>
        <strong>{businessName}</strong>
        <span className="final-starter-preview__poster-description">{poster.heading}</span>
        {profileLine ? <span className="final-starter-preview__profile-line">{profileLine}</span> : null}
      </span>
      <span className="final-starter-preview__poster-items">
        {poster.items.map(item => (
          <span key={item.label}>
            <b>{item.label}</b>
            {item.meta ? <small>{item.meta}</small> : null}
          </span>
        ))}
      </span>
      {poster.action ? <span className="final-starter-preview__mini-cta">{poster.action}</span> : null}
    </span>
  );
}

function PreviewSceneContent({
  businessName,
  ownerName,
  publicLocation,
  scene,
}: {
  businessName: string;
  ownerName?: string;
  publicLocation?: string;
  scene: PreviewScene;
}) {
  const aboutBody = [
    ownerName?.trim() ? `Meet ${ownerName.trim()}.` : null,
    publicLocation?.trim() ? `Appointments in ${publicLocation.trim()}.` : null,
  ].filter(Boolean).join(' ');
  const contactBody = publicLocation?.trim()
    ? `Appointments in ${publicLocation.trim()}.`
    : scene.body;

  if (scene.kind === 'services') {
    return (
      <>
        <small className="final-starter-preview__scene-label">Services</small>
        <strong>{scene.heading}</strong>
        <span className="final-starter-preview__service-list">
          {scene.items?.map(item => (
            <span key={item.label}>
              <b>{item.label}</b>
              <small>{item.meta}</small>
            </span>
          ))}
        </span>
        {scene.action ? <span className="final-starter-preview__mini-cta">{scene.action}</span> : null}
      </>
    );
  }

  if (scene.kind === 'gallery') {
    return (
      <>
        <small className="final-starter-preview__scene-label">Gallery</small>
        <strong>{scene.heading}</strong>
        <span className="final-starter-preview__gallery-grid">
          <i />
          <i />
          <i />
          <i />
        </span>
      </>
    );
  }

  if (scene.kind === 'about' || scene.kind === 'reviews') {
    return (
      <>
        <small className="final-starter-preview__scene-label">{scene.kind === 'about' ? 'About' : 'Reviews'}</small>
        <strong>{scene.heading}</strong>
        <span className="final-starter-preview__scene-body">
          {scene.kind === 'about' && aboutBody ? aboutBody : scene.body}
        </span>
      </>
    );
  }

  if (scene.kind === 'contact') {
    return (
      <>
        <small className="final-starter-preview__scene-label">Contact</small>
        <strong>{scene.heading}</strong>
        <span className="final-starter-preview__scene-body">{contactBody}</span>
      </>
    );
  }

  return (
    <>
      {scene.eyebrow
        ? (
            <small className="final-starter-preview__scene-label">
              {scene.kind === 'hero' ? businessName : scene.eyebrow}
            </small>
          )
        : null}
      <strong>{scene.kind === 'hero' ? businessName : scene.heading}</strong>
      {scene.body ? <span className="final-starter-preview__scene-body">{scene.body}</span> : null}
      {scene.action
        ? (
            <span className={`final-starter-preview__mini-cta${scene.kind === 'booking' ? ' is-booking-action' : ''}`}>
              {scene.kind === 'booking' ? <CalendarDays size={11} /> : null}
              {scene.action}
            </span>
          )
        : null}
    </>
  );
}

export function StarterPreview({
  active,
  businessName,
  definition,
  logoUrl,
  ownerName,
  pageVisible,
  publicLocation,
  reducedMotion,
  starterId,
}: {
  active: boolean;
  businessName?: string;
  definition: StarterPreviewDefinition;
  logoUrl?: string;
  ownerName?: string;
  pageVisible: boolean;
  publicLocation?: string;
  reducedMotion: boolean;
  starterId: OriginStarter;
}) {
  const previewStyle: PreviewCssProperties = {
    '--preview-duration': `${definition.durationMs}ms`,
    '--preview-middle-distance': definition.middleDistance,
    '--preview-motion-distance': definition.motionDistance,
  };
  const state = reducedMotion ? 'poster' : active ? (pageVisible ? 'playing' : 'paused') : 'poster';
  const resolvedBusinessName = businessName?.trim() || 'Your studio';

  return (
    <span
      aria-hidden="true"
      className={`final-starter-preview final-starter-preview--${definition.previewType}`}
      data-final-frame={definition.finalFrame}
      data-poster-state={definition.posterState}
      data-preview-active={active ? 'true' : 'false'}
      data-preview-paused={active && !pageVisible ? 'true' : 'false'}
      data-preview-state={state}
      data-preview-type={definition.previewType}
      data-starter-navigation={definition.navigationItems.join('|')}
      data-starter-structure={definition.scenes.flatMap(({ structureLabels }) => structureLabels).join('|')}
      data-testid={`starter-preview-${starterId}`}
      style={previewStyle}
    >
      <PreviewHeader
        businessName={resolvedBusinessName}
        definition={definition}
        logoUrl={logoUrl}
      />
      <span className="final-starter-preview__viewport">
        <PreviewPoster
          businessName={resolvedBusinessName}
          ownerName={ownerName}
          poster={definition.poster}
          publicLocation={publicLocation}
        />
        <span className="final-starter-preview__motion">
          <span className="final-starter-preview__track">
            {definition.scenes.map(scene => (
              <span
                className={`final-starter-preview__scene is-${scene.kind}`}
                data-navigation-state={scene.navigation}
                data-preview-scene={scene.id}
                data-scene-duration-ms={scene.durationMs}
                key={scene.id}
              >
                <PreviewSceneContent
                  businessName={resolvedBusinessName}
                  ownerName={ownerName}
                  publicLocation={publicLocation}
                  scene={scene}
                />
              </span>
            ))}
          </span>
        </span>
      </span>
    </span>
  );
}

const DESIGN_DEMO_SCENES = [
  { hint: '💡 Let’s bring your design to life.', label: 'Choose images', duration: 2200 },
  { hint: 'Your image is uploaded. Now make part of it clickable.', label: 'Make something clickable', duration: 2400 },
  { hint: 'Choose what happens when a client taps.', label: 'Instagram', duration: 2000 },
  { hint: 'Enter your Instagram username.', label: 'Place button on design', duration: 3000 },
  { hint: 'Tap the Instagram already printed in your design.', label: 'Tap to place', duration: 2200 },
  { hint: 'Adjust the corners to fit your design.', label: 'Done', duration: 2200 },
  { hint: 'Save your design, then open customer Preview.', label: 'Save design → Preview', duration: 2200 },
  { hint: 'Now a client can tap your Instagram button.', label: 'Customer Preview', duration: 2200 },
  { hint: 'Your Instagram opens. Same artwork, now clickable!', label: 'Instagram opens · Demo', duration: 3000 },
] as const;

function YourDesignDemo({ reducedMotion, pageVisible }: { reducedMotion: boolean; pageVisible: boolean }) {
  const [sceneIndex, setSceneIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const [visible, setVisible] = useState(true);
  const demoRef = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!demoRef.current || typeof IntersectionObserver === 'undefined') {
      return;
    }
    const observer = new IntersectionObserver(([entry]) => setVisible(Boolean(entry?.isIntersecting)), { threshold: 0 });
    observer.observe(demoRef.current);
    return () => observer.disconnect();
  }, []);
  const scene = DESIGN_DEMO_SCENES[sceneIndex]!;
  const playing = visible && pageVisible && !paused && !reducedMotion;
  useEffect(() => {
    if (!playing) {
      return;
    }
    const timer = window.setTimeout(() => setSceneIndex(current => (current + 1) % DESIGN_DEMO_SCENES.length), scene.duration);
    return () => window.clearTimeout(timer);
  }, [playing, scene.duration, sceneIndex]);
  const frame = reducedMotion ? 7 : sceneIndex;
  const placed = frame >= 5;
  return (
    <section aria-label="Watch your design become clickable" className="final-design-demo final-design-demo--automatic" data-testid="design-automatic-demo" data-scene={frame} data-playing={playing} ref={demoRef}>
      <span className="final-design-demo__note">Watch how it works · Example only</span>
      <span className="visually-hidden">Upload an exported image. Choose Make something clickable, then Instagram. Enter your username, tap its location on your image, adjust the rectangle, and save. In customer Preview, tapping the button opens Instagram. This demonstration never opens an external website or changes your draft.</span>
      <div aria-hidden="true" className="final-design-demo__film" key={frame}>
        <p className="final-design-demo__coach">{reducedMotion ? 'Upload → choose Instagram → enter your username → outline it → Preview.' : scene.hint}</p>
        <div className="final-design-demo__screen">
          {frame === 0
            ? (
                <div className="final-design-demo__upload">
                  <FileUp size={32} />
                  <strong>Your Canva or AI design</strong>
                  <span className="final-design-demo__file">✦ my-design.png</span>
                  <span className="final-design-demo__fake-button final-design-demo__target">
                    Choose images
                    <span className="final-design-demo__pointer">↖</span>
                  </span>
                </div>
              )
            : frame === 8
              ? (
                  <div className="final-design-demo__profile">
                    <Instagram size={28} />
                    <small>Instagram · Example destination</small>
                    <strong>@lustergel.app</strong>
                    <span className="final-design-demo__avatar">L</span>
                    <span>Luster</span>
                    <div className="final-design-demo__profile-grid">
                      <i />
                      <i />
                      <i />
                    </div>
                    <small>Opens here in the demo only</small>
                  </div>
                )
              : (
                  <>
                    <div className="final-design-demo__artwork">
                      <small>YOUR UPLOADED DESIGN</small>
                      <strong>Your nail studio</strong>
                      <span className="final-design-demo__tagline">Beautiful nails. Your signature style.</span>
                      <span className="final-design-demo__instagram">
                        <Instagram size={18} />
                        {' '}
                        @lustergel.app
                        {placed || frame === 4
                          ? (
                              <span className="final-design-demo__outline" data-fitting={frame === 5}>
                                <i />
                                <i />
                                <i />
                                <i />
                              </span>
                            )
                          : null}
                        {frame === 4 || frame === 5 || frame === 7 ? <span className="final-design-demo__pointer">↖</span> : null}
                      </span>
                    </div>
                    {frame === 2 || frame === 3
                      ? (
                          <div className="final-design-demo__sheet">
                            <strong>What should happen when clients tap?</strong>
                            {frame === 2
                              ? (
                                  <>
                                    <span className="final-design-demo__fake-button final-design-demo__target">
                                      <Instagram size={18} />
                                      {' '}
                                      Instagram
                                      <span className="final-design-demo__pointer">↖</span>
                                    </span>
                                    <small>Call · Email · Book appointment · Website</small>
                                  </>
                                )
                              : (
                                  <>
                                    <small>Instagram username</small>
                                    <span className="final-design-demo__input"><span>lustergel.app</span></span>
                                    <span className="final-design-demo__fake-button">Place button on design</span>
                                  </>
                                )}
                          </div>
                        )
                      : null}
                    {frame === 1 || frame === 5 || frame === 6
                      ? (
                          <span className="final-design-demo__fake-button final-design-demo__target">
                            {scene.label}
                            <span className="final-design-demo__pointer">↖</span>
                          </span>
                        )
                      : null}
                    {frame === 7 ? <small className="final-design-demo__note">Customer Preview · Tap opens Instagram</small> : null}
                    <span className="final-design-demo__booking">
                      <CalendarDays size={14} />
                      {' '}
                      Book appointment
                    </span>
                  </>
                )}
        </div>
      </div>
      <div className="final-design-demo__playback">
        <span aria-hidden="true">{reducedMotion ? 'Your design + real booking' : `${sceneIndex + 1} / ${DESIGN_DEMO_SCENES.length} · Repeats automatically`}</span>
        {!reducedMotion ? <button type="button" onClick={() => setPaused(current => !current)}>{paused ? 'Play demo' : 'Pause demo'}</button> : null}
      </div>
    </section>
  );
}

export type StarterChoiceGridProps = {
  businessName?: string;
  committingStarter?: OriginStarter | null;
  logoUrl?: string;
  onChoose: (starter: OriginStarter) => void;
  ownerName?: string;
  publicLocation?: string;
  reducedMotion?: boolean;
  selectedStarter?: OriginStarter | null;
};

export function StarterChoiceGrid({
  businessName,
  committingStarter = null,
  logoUrl,
  onChoose,
  ownerName,
  publicLocation,
  reducedMotion = false,
  selectedStarter = null,
}: StarterChoiceGridProps) {
  const playback = useStarterPreviewPlayback(reducedMotion);

  return (
    <>
      <div
        className="final-starter-grid"
        data-committing={committingStarter ? 'true' : undefined}
      >
        {STARTER_CHOICES.map((starter) => {
          const previewActive = playback.activeId === starter.id;
          const selected = selectedStarter === starter.id;
          const actionLabel = selected
            ? 'Continue with this starting point'
            : selectedStarter
              ? `Switch to ${starter.title}`
              : starter.cta;
          const choice = (
            <button
              aria-pressed={selected}
              className={starter.id === 'your_design' ? 'final-starter-card__choose' : 'final-starter-card'}
              data-committing={committingStarter === starter.id ? 'true' : undefined}
              data-preview-active={previewActive ? 'true' : 'false'}
              data-selected={selected ? 'true' : 'false'}
              data-starter-id={starter.id}
              key={starter.id}
              ref={element => playback.registerCard(starter.id, element)}
              type="button"
              onBlur={() => playback.onCardBlur(starter.id)}
              onClick={() => onChoose(starter.id)}
              onFocus={() => playback.onCardFocus(starter.id)}
              onMouseEnter={() => playback.onCardMouseEnter(starter.id)}
              onMouseLeave={() => playback.onCardMouseLeave(starter.id)}
            >
              <span className="final-starter-card__copy">
                {selected
                  ? (
                      <span className="final-starter-card__current">Current starting point</span>
                    )
                  : null}
                <span className="final-starter-card__identity">
                  <strong>{starter.title}</strong>
                  <small>{starter.description}</small>
                </span>
                <span className="final-starter-card__included">
                  <small>{starter.includesLabel}</small>
                  <span>{starter.includedItems.join(' · ')}</span>
                </span>
                {starter.id === 'your_design' ? <span className="visually-hidden">Upload your image, choose what happens when clients tap, then draw a box around that part of your design. Booking stays underneath.</span> : null}
                <span className="final-starter-card__action">
                  {actionLabel}
                  {' '}
                  <ArrowRight aria-hidden="true" size={18} />
                </span>
              </span>
              {starter.id !== 'your_design'
                ? (
                    <StarterPreview
                      active={previewActive}
                      businessName={businessName}
                      definition={starter.preview}
                      logoUrl={logoUrl}
                      ownerName={ownerName}
                      pageVisible={playback.pageVisible}
                      publicLocation={publicLocation}
                      reducedMotion={playback.prefersReducedMotion}
                      starterId={starter.id}
                    />
                  )
                : null}
            </button>
          );
          return starter.id === 'your_design'
            ? (
                <div className="final-starter-card" data-selected={selected ? 'true' : 'false'} key={starter.id}>
                  {choice}
                  <YourDesignDemo pageVisible={playback.pageVisible} reducedMotion={playback.prefersReducedMotion} />
                </div>
              )
            : choice;
        })}
      </div>

      <div className="final-starter-reassurance">
        <strong>Nothing is permanent.</strong>
        <span>Every starting point uses the same editor. Add, remove, or rearrange pages and sections anytime.</span>
      </div>
    </>
  );
}

export function StarterChooser({ onChoose, onImport }: StarterChooserProps) {
  const importInputRef = useRef<HTMLInputElement>(null);

  return (
    <main className="final-starter-screen">
      <header className="final-starter-header">
        <a aria-label="Luster" className="final-starter-header__brand" href="#starter-title">
          <span aria-hidden="true">L</span>
          <strong>Luster</strong>
        </a>
        <span className="final-starter-header__lab">
          <Sparkles aria-hidden="true" size={15} />
          {' '}
          Site Builder Lab
        </span>
      </header>

      <section className="final-starter-content" aria-labelledby="starter-title">
        <h1 id="starter-title">Choose your starting point</h1>
        <p className="final-starter-intro">
          Start simple or with a full website. You can add or change pages and sections anytime.
        </p>

        <StarterChoiceGrid onChoose={onChoose} />

        {onImport
          ? (
              <div className="final-starter-import">
                <span>Have a Lab backup?</span>
                <button type="button" onClick={() => importInputRef.current?.click()}>
                  <FileUp aria-hidden="true" size={17} />
                  {' '}
                  Import JSON
                </button>
                <input
                  ref={importInputRef}
                  accept="application/json,.json"
                  aria-label="Import site JSON file"
                  className="visually-hidden"
                  tabIndex={-1}
                  type="file"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) {
                      onImport(file);
                    }
                    event.target.value = '';
                  }}
                />
              </div>
            )
          : null}
      </section>

      <p className="final-starter-disclaimer">Mock data only · Saved in this browser · Not connected to Production</p>
    </main>
  );
}
