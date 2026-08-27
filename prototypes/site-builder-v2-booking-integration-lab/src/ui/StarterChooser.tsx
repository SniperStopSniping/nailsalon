import { ArrowRight, CalendarDays, FileUp, Sparkles } from 'lucide-react';
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
} from 'react';

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
  kind: 'about' | 'booking' | 'gallery' | 'hero' | 'reviews' | 'services';
  navigation?: string;
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

export const STARTER_CHOICES: readonly StarterChoiceDefinition[] = [
  {
    cta: 'Start with Quick Book',
    description: 'Start taking bookings with only the essentials.',
    id: 'quick_book',
    includedItems: ['Salon intro', 'Services', 'Booking'],
    includesLabel: 'Includes',
    preview: {
      durationMs: 4_800,
      finalFrame: 'booking',
      middleDistance: '-33.3333%',
      motionDistance: '-66.6667%',
      navigationItems: ['Services', 'Book'],
      poster: {
        action: 'Choose a service',
        heading: 'Beautiful nails, booked in minutes.',
        items: [
          { label: 'Signature manicure', meta: '60 min · $55' },
          { label: 'Gel extensions', meta: '90 min · $85' },
        ],
        kind: 'quick-summary',
        label: 'Book your visit',
      },
      posterState: 'booking-summary',
      previewType: 'short-scroll',
      scenes: [
        {
          action: 'Book an appointment',
          durationMs: 1_050,
          eyebrow: 'Luster Nail Studio',
          heading: 'Beautiful nails, booked in minutes.',
          id: 'intro',
          kind: 'hero',
        },
        {
          durationMs: 1_500,
          heading: 'Choose your service',
          id: 'services',
          items: [
            { label: 'Signature manicure', meta: '60 min · $55' },
            { label: 'Gel extensions', meta: '90 min · $85' },
            { label: 'Nail art add-on', meta: '20 min · $18' },
          ],
          kind: 'services',
        },
        {
          action: 'Book an appointment',
          body: 'Pick a time that works for you.',
          durationMs: 1_500,
          eyebrow: 'Almost there',
          heading: 'Ready to book?',
          id: 'booking',
          kind: 'booking',
        },
      ],
    },
    title: 'Quick Book',
  },
  {
    cta: 'Start with One-page',
    description: 'Show your whole business on one scrolling page.',
    id: 'one_page',
    includedItems: ['Welcome', 'About', 'Services', 'Gallery', 'Reviews', 'Booking'],
    includesLabel: 'Includes',
    preview: {
      durationMs: 5_800,
      finalFrame: 'booking',
      motionDistance: '-66.6667%',
      navigationItems: ['Welcome', 'Services', 'Book'],
      poster: {
        heading: 'Your whole studio, all in one place.',
        items: [
          { label: 'Welcome' },
          { label: 'About' },
          { label: 'Services' },
          { label: 'Gallery' },
          { label: 'Reviews' },
          { label: 'Booking' },
        ],
        kind: 'one-page-map',
        label: 'One continuous page',
      },
      posterState: 'page-overview',
      previewType: 'continuous-scroll',
      scenes: [
        {
          action: 'Explore the studio',
          durationMs: 850,
          eyebrow: 'Welcome',
          heading: 'Nails designed around you.',
          id: 'welcome',
          kind: 'hero',
        },
        {
          body: 'A calm private studio for thoughtful, lasting nail care.',
          durationMs: 800,
          heading: 'About the studio',
          id: 'about',
          kind: 'about',
        },
        {
          durationMs: 900,
          heading: 'Popular services',
          id: 'services',
          items: [
            { label: 'Gel manicure', meta: '$65' },
            { label: 'Builder gel', meta: '$78' },
          ],
          kind: 'services',
        },
        {
          durationMs: 800,
          heading: 'Recent work',
          id: 'gallery',
          kind: 'gallery',
        },
        {
          body: '“The loveliest appointment and my nails last beautifully.”',
          durationMs: 800,
          heading: 'Client love',
          id: 'reviews',
          kind: 'reviews',
        },
        {
          action: 'Book an appointment',
          body: 'Choose your service and preferred time.',
          durationMs: 1_050,
          eyebrow: 'Booking',
          heading: 'Ready for your next set?',
          id: 'booking',
          kind: 'booking',
        },
      ],
    },
    title: 'One-page website',
  },
  {
    cta: 'Start with Multi-page',
    description: 'Give each part of your business its own page and navigation link.',
    id: 'multi_page',
    includedItems: ['Home', 'Services & Booking', 'Gallery', 'About', 'Contact'],
    includesLabel: 'Includes pages',
    preview: {
      durationMs: 5_600,
      finalFrame: 'gallery',
      motionDistance: '8px',
      navigationItems: ['Home', 'Services', 'Gallery'],
      poster: {
        action: 'Book an appointment',
        heading: 'Nails designed around you.',
        items: [
          { label: 'Featured work' },
          { label: 'Private Toronto studio' },
        ],
        kind: 'multi-home',
        label: 'Home page',
      },
      posterState: 'home',
      previewType: 'page-switch',
      scenes: [
        {
          action: 'See our work',
          durationMs: 1_400,
          eyebrow: 'Home',
          heading: 'Nails designed around you.',
          id: 'home',
          kind: 'hero',
          navigation: 'Home',
        },
        {
          action: 'Book an appointment',
          durationMs: 1_550,
          heading: 'Services & Booking',
          id: 'services',
          items: [
            { label: 'Gel manicure', meta: '60 min · $65' },
            { label: 'Builder gel', meta: '75 min · $78' },
          ],
          kind: 'services',
          navigation: 'Services',
        },
        {
          durationMs: 1_650,
          heading: 'Gallery',
          id: 'gallery',
          kind: 'gallery',
          navigation: 'Gallery',
        },
      ],
    },
    title: 'Multi-page website',
  },
] as const;

const RESET_DELAY_MS = 180;
const MOBILE_ACTIVE_RATIO = 0.64;
const OFFSCREEN_RATIO = 0.05;
const STARTER_IDS = STARTER_CHOICES.map(({ id }) => id);

type PreviewCssProperties = CSSProperties & {
  '--preview-duration': string;
  '--preview-middle-distance'?: string;
  '--preview-motion-distance': string;
};

function useMediaQuery(query: string): boolean {
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

function useStarterPreviewPlayback() {
  const hasFinePointer = useMediaQuery('(any-hover: hover) and (any-pointer: fine)');
  const prefersReducedMotion = useMediaQuery('(prefers-reduced-motion: reduce)');
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

function PreviewHeader({ definition }: { definition: StarterPreviewDefinition }) {
  return (
    <span className="final-starter-preview__header">
      <span className="final-starter-preview__identity"><i>L</i><b>Luster Nail Studio</b></span>
      <span className="final-starter-preview__nav">
        {definition.navigationItems.map((item, index) => (
          <span className={index === 0 ? 'is-poster-active' : undefined} key={item}>{item}</span>
        ))}
      </span>
    </span>
  );
}

function PreviewPoster({ poster }: { poster: PreviewPoster }) {
  return (
    <span className={`final-starter-preview__poster is-${poster.kind}`} data-preview-poster={poster.kind}>
      <span className="final-starter-preview__poster-copy">
        <small>{poster.label}</small>
        <strong>{poster.heading}</strong>
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

function PreviewSceneContent({ scene }: { scene: PreviewScene }) {
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
        <span className="final-starter-preview__scene-body">{scene.body}</span>
      </>
    );
  }

  return (
    <>
      {scene.eyebrow ? <small className="final-starter-preview__scene-label">{scene.eyebrow}</small> : null}
      <strong>{scene.heading}</strong>
      {scene.body ? <span className="final-starter-preview__scene-body">{scene.body}</span> : null}
      {scene.action ? (
        <span className={`final-starter-preview__mini-cta${scene.kind === 'booking' ? ' is-booking-action' : ''}`}>
          {scene.kind === 'booking' ? <CalendarDays size={11} /> : null}{scene.action}
        </span>
      ) : null}
    </>
  );
}

function StarterPreview({
  active,
  definition,
  pageVisible,
  reducedMotion,
  starterId,
}: {
  active: boolean;
  definition: StarterPreviewDefinition;
  pageVisible: boolean;
  reducedMotion: boolean;
  starterId: OriginStarter;
}) {
  const previewStyle: PreviewCssProperties = {
    '--preview-duration': `${definition.durationMs}ms`,
    '--preview-middle-distance': definition.middleDistance,
    '--preview-motion-distance': definition.motionDistance,
  };
  const state = reducedMotion ? 'poster' : active ? (pageVisible ? 'playing' : 'paused') : 'poster';

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
      data-testid={`starter-preview-${starterId}`}
      style={previewStyle}
    >
      <PreviewHeader definition={definition} />
      <span className="final-starter-preview__viewport">
        <PreviewPoster poster={definition.poster} />
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
                <PreviewSceneContent scene={scene} />
              </span>
            ))}
          </span>
        </span>
      </span>
    </span>
  );
}

export function StarterChooser({ onChoose, onImport }: StarterChooserProps) {
  const importInputRef = useRef<HTMLInputElement>(null);
  const playback = useStarterPreviewPlayback();

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

        <div className="final-starter-grid">
          {STARTER_CHOICES.map((starter) => {
            const previewActive = playback.activeId === starter.id;
            return (
              <button
                className="final-starter-card"
                data-preview-active={previewActive ? 'true' : 'false'}
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
                  <span className="final-starter-card__identity">
                    <strong>{starter.title}</strong>
                    <small>{starter.description}</small>
                  </span>
                  <span className="final-starter-card__included">
                    <small>{starter.includesLabel}</small>
                    <span>{starter.includedItems.join(' · ')}</span>
                  </span>
                  <span className="final-starter-card__action">{starter.cta} <ArrowRight aria-hidden="true" size={18} /></span>
                </span>
                <StarterPreview
                  active={previewActive}
                  definition={starter.preview}
                  pageVisible={playback.pageVisible}
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
