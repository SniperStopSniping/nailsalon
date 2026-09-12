'use client';

import { Check, Heart, Play, RotateCcw, Sparkles } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import { cn } from '@/utils/Helpers';

import styles from './LuckyCharmLab.module.css';

type Material = 'pearl' | 'chrome' | 'jelly';
type Speed = 'fast' | 'normal' | 'long';
type View = Material | 'current';

const MATERIALS: Array<{ id: Material; label: string; note: string }> = [
  { id: 'pearl', label: 'A · Glazed pearl', note: 'Soft, luminous, beauty-first' },
  { id: 'chrome', label: 'B · Liquid chrome', note: 'Sharper, editorial, high contrast' },
  { id: 'jelly', label: 'C · Jelly glass', note: 'Translucent, playful, airy' },
];

const SPEEDS: Record<Speed, { duration: number; label: string }> = {
  fast: { duration: 500, label: 'Fast · 0.5s' },
  normal: { duration: 3000, label: 'Normal · 3s' },
  long: { duration: 10000, label: 'Long · 10s' },
};

function LusterMark() {
  return (
    <div className={styles.charmAssembly} aria-hidden="true">
      <div className={styles.charmLoop} />
      <div className={styles.charm}>
        <div className={styles.charmDepth} />
        <div className={styles.charmFace}>
          <span className={styles.mark}>
            <span>Luster</span>
            <small>Gel</small>
          </span>
          <span className={styles.charmGlint} />
        </div>
      </div>
      <div className={styles.charmShadow} />
    </div>
  );
}

function RewardStory({ reducedMotion }: { reducedMotion: boolean }) {
  return (
    <div className={cn(styles.story, reducedMotion && styles.reduced)}>
      <div className={styles.orbit} aria-hidden="true" />
      <LusterMark />

      <div className={styles.bookingCard} aria-hidden="true">
        <div className={styles.cardTopline}>
          <span>New booking</span>
          <span className={styles.cardDot} />
        </div>
        <strong>Gel Manicure</strong>
        <span className={styles.cardTime}>2:30 PM</span>
        <div className={styles.bookedStamp}>
          <Check size={13} strokeWidth={3} />
          {' '}
          Booked
        </div>
      </div>

      <div className={styles.valueToken} aria-label="Illustrative booking value, not live account data">
        <span>+$65</span>
        <small>sample</small>
      </div>

      <div className={styles.heart} aria-hidden="true"><Heart size={24} fill="currentColor" /></div>
      <div className={styles.sparkleOne} aria-hidden="true"><Sparkles size={22} /></div>
      <div className={styles.sparkleTwo} aria-hidden="true">✦</div>
    </div>
  );
}

function CurrentSpinner() {
  return (
    <div className={styles.currentSpinner}>
      <div className={styles.spinner} aria-hidden="true" />
      <p>Checking your session...</p>
    </div>
  );
}

function AppReadyPreview() {
  return (
    <div className={styles.appReady} aria-label="Example application ready state">
      <div className={styles.appHeader}>
        <div>
          <small>Saturday, September 12</small>
          <strong>Good morning, Mia</strong>
        </div>
        <span className={styles.avatar}>M</span>
      </div>
      <div className={styles.todayCard}>
        <small>Today</small>
        <strong>4 appointments</strong>
        <span>Next · Gel Manicure at 2:30 PM</span>
      </div>
      <div className={styles.appRows}>
        <span />
        <span />
        <span />
      </div>
    </div>
  );
}

export function LuckyCharmLab() {
  const [view, setView] = useState<View>('pearl');
  const [speed, setSpeed] = useState<Speed>('normal');
  const [reducedMotion, setReducedMotion] = useState(false);
  const [run, setRun] = useState(0);
  const [ready, setReady] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const replay = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
    }
    setReady(false);
    setRun(value => value + 1);
  }, []);

  useEffect(() => {
    timerRef.current = setTimeout(() => setReady(true), SPEEDS[speed].duration);
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
    };
  }, [run, speed, view, reducedMotion]);

  const chooseView = (nextView: View) => {
    setView(nextView);
    replay();
  };

  const chooseSpeed = (nextSpeed: Speed) => {
    setSpeed(nextSpeed);
    replay();
  };

  return (
    <main className={styles.lab}>
      <section className={styles.previewColumn}>
        <div className={styles.mobileLabel}>
          <span>375</span>
          {' '}
          mobile preview
        </div>
        <div
          className={cn(styles.phone, view !== 'current' && styles[view], ready && styles.isReady)}
          data-material={view}
          data-ready={ready}
          data-testid="lucky-charm-preview"
        >
          <div className={styles.ambient} />
          <div className={styles.loader} key={`${view}-${run}-${reducedMotion}`}>
            {view === 'current' ? <CurrentSpinner /> : <RewardStory reducedMotion={reducedMotion} />}
            <div className={styles.loadingCopy}>
              <strong>{view === 'current' ? 'Luster' : 'Booked & busy'}</strong>
              <span>{view === 'current' ? 'Checking your session...' : 'Getting your studio ready…'}</span>
              {speed === 'long' && view !== 'current' ? <small>One last polish</small> : null}
            </div>
          </div>
          <AppReadyPreview />
        </div>
      </section>

      <aside className={styles.controlPanel}>
        <div className={styles.eyebrow}>Luster motion lab · 01</div>
        <h1>Lucky Charm</h1>
        <p className={styles.intro}>One choreography, three finishes. The booking value is intentionally marked as a sample, never live account data.</p>

        <fieldset className={styles.controlGroup}>
          <legend>Material</legend>
          <div className={styles.materialGrid}>
            {MATERIALS.map(material => (
              <button
                type="button"
                key={material.id}
                className={cn(styles.materialButton, view === material.id && styles.active)}
                onClick={() => chooseView(material.id)}
                aria-pressed={view === material.id}
              >
                <span className={cn(styles.swatch, styles[material.id])} />
                <span>
                  <strong>{material.label}</strong>
                  <small>{material.note}</small>
                </span>
              </button>
            ))}
          </div>
        </fieldset>

        <fieldset className={styles.controlGroup}>
          <legend>Loading time</legend>
          <div className={styles.segmented}>
            {(Object.keys(SPEEDS) as Speed[]).map(option => (
              <button type="button" key={option} onClick={() => chooseSpeed(option)} aria-pressed={speed === option}>
                {SPEEDS[option].label}
              </button>
            ))}
          </div>
        </fieldset>

        <div className={styles.actions}>
          <Button type="button" onClick={replay} className={styles.replayButton}>
            <RotateCcw size={16} />
            {' '}
            Replay
          </Button>
          <button
            type="button"
            className={styles.motionToggle}
            aria-pressed={reducedMotion}
            onClick={() => {
              setReducedMotion(value => !value);
              replay();
            }}
          >
            <span className={styles.switchTrack}><span /></span>
            Reduced motion
          </button>
        </div>

        <button type="button" className={cn(styles.compareButton, view === 'current' && styles.active)} onClick={() => chooseView('current')}>
          <Play size={15} />
          {' '}
          Compare with current spinner
        </button>

        <div className={styles.timelineNote}>
          <span>0.5s</span>
          <i />
          <span>3s</span>
          <i />
          <span>10s</span>
          <p>Fast exits immediately. Normal completes the reward. Long settles into one calm idle—no fake repeat bookings.</p>
        </div>
      </aside>
    </main>
  );
}
