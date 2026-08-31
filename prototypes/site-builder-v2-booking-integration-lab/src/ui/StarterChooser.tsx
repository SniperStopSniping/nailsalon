import { ArrowRight, CalendarDays, FileUp, Sparkles } from 'lucide-react';
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
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
  kind: 'about' | 'booking' | 'contact' | 'gallery' | 'hero' | 'reviews' | 'services';
  navigation?: string;
  structureLabels: readonly string[];
};

type PreviewPoster = {
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
  poster: PreviewPoster;
  posterState: string;
  previewType: 'continuous-scroll' | 'page-switch' | 'short-scroll';
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
].flatMap((selection) => selection
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
  one_page: {
    cta: 'Start with One-page',
    description: 'Show your whole business on one scrolling page.',
    id: 'one_page',
    includesLabel: 'Includes',
    title: 'One-page website',
  },
  multi_page: {
    cta: 'Start with Multi-page',
    description: 'Give each part of your business its own page and navigation link.',
    id: 'multi_page',
    includesLabel: 'Includes pages',
    title: 'Multi-page website',
  },
};

const getSceneKind = (labels: readonly string[]): PreviewScene['kind'] => {
  const normalized = labels.join(' ').toLocaleLowerCase();
  if (normalized.includes('service') || normalized.includes('booking')) return 'services';
  if (normalized.includes('gallery') || normalized.includes('featured work')) return 'gallery';
  if (normalized.includes('about')) return 'about';
  if (normalized.includes('review')) return 'reviews';
  if (normalized.includes('visit') || normalized.includes('contact')) return 'contact';
  if (normalized.includes('book')) return 'booking';
  return 'hero';
};

const getSceneCopy = (
  kind: PreviewScene['kind'],
  heading: string,
): Pick<PreviewScene, 'action' | 'body' | 'eyebrow' | 'heading' | 'items'> => {
  switch (kind) {
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
    durationMs: starter === 'quick_book' ? 4_800 : starter === 'one_page' ? 5_800 : 7_000,
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
        : starter === 'one_page'
          ? 'Your whole studio, all in one place.'
          : 'A home page with separate destinations.',
      items: posterItems,
      kind: posterKind,
      label: starter === 'quick_book'
        ? 'Booking-focused page'
        : starter === 'one_page'
          ? 'One continuous page'
          : 'Five connected pages',
    },
    posterState: starter === 'quick_book'
      ? 'booking-summary'
      : starter === 'one_page'
        ? 'page-overview'
        : 'site-map',
    previewType,
    scenes,
  };
};

export const STARTER_CHOICES: readonly StarterChoiceDefinition[] = (
  ['quick_book', 'one_page', 'multi_page'] as const
).map((starter) => ({
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
    if (typeof window.matchMedia !== 'function') return undefined;
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
    if (!hasFinePointer) return;
    hoveredIdRef.current = starterId;
    startInteractionPreview(starterId);
  }, [hasFinePointer, startInteractionPreview]);

  const onCardMouseLeave = useCallback((starterId: OriginStarter) => {
    if (!hasFinePointer || hoveredIdRef.current !== starterId) return;
    hoveredIdRef.current = null;
    settleInteractionPreview(focusedIdRef.current);
  }, [hasFinePointer, settleInteractionPreview]);

  const onCardFocus = useCallback((starterId: OriginStarter) => {
    focusedIdRef.current = starterId;
    startInteractionPreview(starterId);
  }, [startInteractionPreview]);

  const onCardBlur = useCallback((starterId: OriginStarter) => {
    if (focusedIdRef.current !== starterId) return;
    focusedIdRef.current = null;
    settleInteractionPreview(hasFinePointer ? hoveredIdRef.current : null);
  }, [hasFinePointer, settleInteractionPreview]);

  useEffect(() => {
    const updateVisibility = () => setPageVisible(document.visibilityState !== 'hidden');
    document.addEventListener('visibilitychange', updateVisibility);
    return () => document.removeEventListener('visibilitychange', updateVisibility);
  }, []);

  useEffect(() => {
    if (!prefersReducedMotion) return;
    clearResetTimer();
    hoveredIdRef.current = null;
    setInteractionActiveId(null);
  }, [clearResetTimer, prefersReducedMotion]);

  useEffect(() => {
    if (prefersReducedMotion || typeof IntersectionObserver === 'undefined') return undefined;

    const thresholds = Array.from({ length: 21 }, (_, index) => index / 20);
    const observer = new IntersectionObserver((entries) => {
      setCardRatios((currentRatios) => {
        let changed = false;
        const nextRatios = { ...currentRatios };
        for (const entry of entries) {
          const starterId = (entry.target as HTMLElement).dataset.starterId as OriginStarter | undefined;
          if (!starterId) continue;
          const nextRatio = entry.isIntersecting ? entry.intersectionRatio : 0;
          if (nextRatios[starterId] !== nextRatio) {
            nextRatios[starterId] = nextRatio;
            changed = true;
          }
        }
        return changed ? nextRatios : currentRatios;
      });
    }, { threshold: thresholds });

    for (const card of cardElementsRef.current.values()) observer.observe(card);
    return () => observer.disconnect();
  }, [prefersReducedMotion]);

  useEffect(() => () => clearResetTimer(), [clearResetTimer]);

  const mobileActiveId = hasFinePointer
    ? null
    : STARTER_IDS.reduce<OriginStarter | null>((winner, starterId) => {
        const ratio = cardRatios[starterId] ?? 0;
        if (ratio < MOBILE_ACTIVE_RATIO) return winner;
        if (!winner || ratio > (cardRatios[winner] ?? 0)) return starterId;
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
  poster: PreviewPoster;
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
        {poster.items.map((item) => (
          <span key={item.label}><b>{item.label}</b>{item.meta ? <small>{item.meta}</small> : null}</span>
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
          {scene.items?.map((item) => (
            <span key={item.label}><b>{item.label}</b><small>{item.meta}</small></span>
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
        <span className="final-starter-preview__gallery-grid"><i /><i /><i /><i /></span>
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
      {scene.eyebrow ? (
        <small className="final-starter-preview__scene-label">
          {scene.kind === 'hero' ? businessName : scene.eyebrow}
        </small>
      ) : null}
      <strong>{scene.kind === 'hero' ? businessName : scene.heading}</strong>
      {scene.body ? <span className="final-starter-preview__scene-body">{scene.body}</span> : null}
      {scene.action ? (
        <span className={`final-starter-preview__mini-cta${scene.kind === 'booking' ? ' is-booking-action' : ''}`}>
          {scene.kind === 'booking' ? <CalendarDays size={11} /> : null}{scene.action}
        </span>
      ) : null}
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
            {definition.scenes.map((scene) => (
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
          return (
            <button
              aria-pressed={selected}
              className="final-starter-card"
              data-committing={committingStarter === starter.id ? 'true' : undefined}
              data-preview-active={previewActive ? 'true' : 'false'}
              data-selected={selected ? 'true' : 'false'}
              data-starter-id={starter.id}
              key={starter.id}
              ref={(element) => playback.registerCard(starter.id, element)}
              type="button"
              onBlur={() => playback.onCardBlur(starter.id)}
              onClick={() => onChoose(starter.id)}
              onFocus={() => playback.onCardFocus(starter.id)}
              onMouseEnter={() => playback.onCardMouseEnter(starter.id)}
              onMouseLeave={() => playback.onCardMouseLeave(starter.id)}
            >
              <span className="final-starter-card__copy">
                {selected ? (
                  <span className="final-starter-card__current">Current starting point</span>
                ) : null}
                <span className="final-starter-card__identity">
                  <strong>{starter.title}</strong>
                  <small>{starter.description}</small>
                </span>
                <span className="final-starter-card__included">
                  <small>{starter.includesLabel}</small>
                  <span>{starter.includedItems.join(' · ')}</span>
                </span>
                <span className="final-starter-card__action">{actionLabel} <ArrowRight aria-hidden="true" size={18} /></span>
              </span>
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
            </button>
          );
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
          <span aria-hidden="true">L</span><strong>Luster</strong>
        </a>
        <span className="final-starter-header__lab"><Sparkles aria-hidden="true" size={15} /> Site Builder Lab</span>
      </header>

      <section className="final-starter-content" aria-labelledby="starter-title">
        <h1 id="starter-title">Choose your starting point</h1>
        <p className="final-starter-intro">
          Start simple or with a full website. You can add or change pages and sections anytime.
        </p>

        <StarterChoiceGrid onChoose={onChoose} />

        {onImport ? (
          <div className="final-starter-import">
            <span>Have a Lab backup?</span>
            <button type="button" onClick={() => importInputRef.current?.click()}><FileUp aria-hidden="true" size={17} /> Import JSON</button>
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
        ) : null}
      </section>

      <p className="final-starter-disclaimer">Mock data only · Saved in this browser · Not connected to Production</p>
    </main>
  );
}
