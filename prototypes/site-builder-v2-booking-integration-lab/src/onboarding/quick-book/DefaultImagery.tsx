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
  const halo = `qb-portrait-halo-${id}`;
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
        {/* A centred glow instead of corner blobs: an off-centre shape at this
            size read as a second head once the art was cropped to a circle. */}
        <radialGradient id={halo} cx="0.5" cy="0.44" r="0.62">
          <stop offset="0" stopColor={SURFACE} stopOpacity="0.85" />
          <stop offset="1" stopColor={SURFACE} stopOpacity="0" />
        </radialGradient>
        <linearGradient id={figure} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor={ACCENT} stopOpacity="0.9" />
          <stop offset="1" stopColor={ACCENT} stopOpacity="0.6" />
        </linearGradient>
      </defs>
      <rect fill={`url(#${ground})`} height="240" width="200" />
      <rect fill={`url(#${halo})`} height="240" width="200" />
      {/* Head and shoulders only, centred on x=100. The head sits inside
          x 66–134, well within the narrowest crop in use — the portrait rail
          shows roughly the middle two thirds of the width — and the shoulders
          run off the bottom in every crop and off the sides in the rail. No
          neck: at this size a column between head and shoulders read as a
          stalk rather than a person. */}
      <path d="M40 240c0-56 27-96 60-96s60 40 60 96z" fill={`url(#${figure})`} />
      <ellipse cx="100" cy="150" fill={INK} opacity="0.08" rx="26" ry="8" />
      <circle cx="100" cy="98" fill={`url(#${figure})`} r="34" />
      <circle cx="89" cy="87" fill={SURFACE} opacity="0.16" r="10" />
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
