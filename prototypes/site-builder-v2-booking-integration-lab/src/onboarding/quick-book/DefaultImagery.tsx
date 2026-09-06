/**
 * App-authored default imagery for composition-essential image areas.
 *
 * Both illustrations are deliberate decorative vector compositions, not
 * photographs: no stranger's face is ever placed beside the owner's name and
 * no other technician's work is ever shown as this owner's. They pick up the
 * salon's palette through the `--qb-*` variables set by the presentation
 * wrapper, so they look intentional in every colour scheme, and they are
 * deterministic — nothing changes between renders, reloads or layouts.
 *
 * They are decorative (`aria-hidden`), so a default is never described as a
 * portrait of the technician or as portfolio work.
 */
import { useId } from 'react';

const ACCENT = 'var(--qb-accent, #8a3b5c)';
const SECONDARY = 'var(--qb-secondary, #e7c2cf)';
const SURFACE = 'var(--qb-surface, #fff8f6)';
const INK = 'var(--qb-ink, #2b1a22)';

export function DefaultPortraitIllustration({ className }: { className?: string }) {
  const id = useId().replace(/:/g, '');
  const ground = `qb-portrait-ground-${id}`;
  const figure = `qb-portrait-figure-${id}`;
  return (
    <svg
      aria-hidden="true"
      className={className}
      data-default-image="portrait"
      focusable="false"
      preserveAspectRatio="xMidYMid slice"
      viewBox="0 0 200 240"
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <linearGradient id={ground} x1="0" x2="1" y1="0" y2="1">
          <stop offset="0" stopColor={SECONDARY} />
          <stop offset="1" stopColor={SURFACE} />
        </linearGradient>
        <linearGradient id={figure} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor={ACCENT} stopOpacity="0.92" />
          <stop offset="1" stopColor={ACCENT} stopOpacity="0.62" />
        </linearGradient>
      </defs>
      <rect fill={`url(#${ground})`} height="240" width="200" />
      <circle cx="152" cy="46" fill={SURFACE} opacity="0.55" r="34" />
      <circle cx="34" cy="196" fill={ACCENT} opacity="0.12" r="42" />
      <path
        d="M52 214c0-38 22-62 48-62s48 24 48 62v26H52z"
        fill={`url(#${figure})`}
      />
      <circle cx="100" cy="106" fill={`url(#${figure})`} r="36" />
      <path
        d="M70 88c8-22 52-24 60-2-4-12-14-20-30-20s-26 8-30 22z"
        fill={INK}
        opacity="0.18"
      />
      <path
        d="M128 178c10 6 15 16 15 30"
        fill="none"
        opacity="0.35"
        stroke={SURFACE}
        strokeLinecap="round"
        strokeWidth="4"
      />
      <path
        d="M22 62c14-10 26-10 40 0M20 74c12-8 24-8 36 0"
        fill="none"
        opacity="0.5"
        stroke={ACCENT}
        strokeLinecap="round"
        strokeWidth="3"
      />
    </svg>
  );
}

export function DefaultCoverIllustration({ className }: { className?: string }) {
  const id = useId().replace(/:/g, '');
  const ground = `qb-cover-ground-${id}`;
  const glow = `qb-cover-glow-${id}`;
  return (
    <svg
      aria-hidden="true"
      className={className}
      data-default-image="cover"
      focusable="false"
      preserveAspectRatio="xMidYMid slice"
      viewBox="0 0 800 450"
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <linearGradient id={ground} x1="0" x2="1" y1="0" y2="1">
          <stop offset="0" stopColor={SURFACE} />
          <stop offset="0.55" stopColor={SECONDARY} />
          <stop offset="1" stopColor={ACCENT} stopOpacity="0.55" />
        </linearGradient>
        <radialGradient id={glow} cx="0.72" cy="0.3" r="0.6">
          <stop offset="0" stopColor={SURFACE} stopOpacity="0.9" />
          <stop offset="1" stopColor={SURFACE} stopOpacity="0" />
        </radialGradient>
      </defs>
      <rect fill={`url(#${ground})`} height="450" width="800" />
      <rect fill={`url(#${glow})`} height="450" width="800" />
      <ellipse cx="640" cy="370" fill={ACCENT} opacity="0.28" rx="260" ry="150" />
      <ellipse cx="150" cy="90" fill={SECONDARY} opacity="0.7" rx="210" ry="120" />
      <circle cx="560" cy="120" fill={SURFACE} opacity="0.45" r="70" />
      <path
        d="M90 380c60-70 120-110 210-120 80-9 140 20 200 62"
        fill="none"
        opacity="0.55"
        stroke={ACCENT}
        strokeLinecap="round"
        strokeWidth="6"
      />
      <path
        d="M170 330c-10-26-2-52 14-66M230 288c-4-24 6-44 22-56M300 262c2-22 14-40 30-48"
        fill="none"
        opacity="0.6"
        stroke={ACCENT}
        strokeLinecap="round"
        strokeWidth="4"
      />
      <path
        d="M184 264c-16 4-30 16-34 32 16 2 30-8 34-32zM254 232c-16 2-32 12-38 28 16 4 32-6 38-28zM324 214c-16 0-32 8-42 22 14 6 32 0 42-22z"
        fill={ACCENT}
        opacity="0.42"
      />
      <circle cx="700" cy="80" fill={ACCENT} opacity="0.22" r="26" />
      <circle cx="740" cy="140" fill={SURFACE} opacity="0.6" r="12" />
    </svg>
  );
}
