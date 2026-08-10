/**
 * Persistent owner-preview banner (Luster UI/UX plan rev 3, PR 3).
 *
 * Purely presentational — no auth logic lives here. The caller
 * (`[locale]/[slug]/layout.tsx`) only renders this component after
 * `resolveDraftSalonAccess`/`resolveOwnerPreviewContext` has already
 * confirmed the current request is one of the two authorized actor types
 * (owner or an impersonating super admin). This component itself does not
 * gate anything — it must never be rendered unconditionally.
 *
 * Server component (no 'use client'): the copy is static per variant and
 * needs no interactivity, so it renders for free on every gated request.
 */

export type PreviewBannerVariant = 'draft-salon' | 'draft-config';

export type PreviewBannerProps = {
  /**
   * 'draft-salon': the whole salon is unpublished — "Draft — only you can
   * see this". 'draft-config': the salon is published but the owner (or an
   * impersonating super admin) is looking at unpublished `bookingPage.draft`
   * changes on top of an otherwise-live page — "Previewing unpublished
   * changes".
   */
  variant: PreviewBannerVariant;
};

const COPY: Record<PreviewBannerVariant, string> = {
  'draft-salon': 'Draft — only you can see this',
  'draft-config': 'Previewing unpublished changes',
};

export function PreviewBanner({ variant }: PreviewBannerProps) {
  return (
    <div
      data-testid="owner-preview-banner"
      data-preview-variant={variant}
      role="status"
      className="sticky top-0 z-50 w-full border-b border-amber-500/40 bg-amber-400 px-4 py-2 text-center text-sm font-semibold text-amber-950 shadow-sm"
    >
      {COPY[variant]}
    </div>
  );
}
