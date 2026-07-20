'use client';

import { ExternalLink } from 'lucide-react';
import type { ReactNode } from 'react';

import { buildLusterUrl, type LusterPath } from '@/libs/lusterLinks';

type LusterExternalLinkProps = {
  /** Approved lusterstudio.ca path. The type makes an off-allowlist link a build error. */
  path: LusterPath;
  /** Descriptive action label, e.g. "View guide" — never a generic "Open resource". */
  cta: string;
  className?: string;
  ctaClassName?: string;
  onNavigate?: () => void;
  children?: ReactNode;
};

/**
 * The one way the Luster page links out. Guarantees the approved origin,
 * `noopener noreferrer`, and a screen-reader announcement that the link leaves
 * the app for the Luster Studio website.
 */
export function LusterExternalLink({
  path,
  cta,
  className,
  ctaClassName = 'mt-4 inline-flex items-center gap-1 text-sm font-semibold text-rose-700',
  onNavigate,
  children,
}: LusterExternalLinkProps) {
  return (
    <a
      href={buildLusterUrl(path)}
      target="_blank"
      rel="noopener noreferrer"
      onClick={onNavigate}
      className={className}
    >
      {children}
      <span className={ctaClassName}>
        {cta}
        <ExternalLink size={14} aria-hidden="true" />
      </span>
      <span className="sr-only">Opens lusterstudio.ca in a new tab</span>
    </a>
  );
}
