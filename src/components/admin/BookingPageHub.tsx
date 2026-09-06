'use client';

import { ArrowLeft, Check, Copy, Images, LayoutTemplate, Lock, Palette, Scissors, ShieldCheck, Type, UserRound } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

/**
 * AG-hub-publish-08 — the owner draft preview's "Back to editor" control
 * returns here with this fragment. Focus has to land back on the control the
 * owner left from rather than at the top of a rebuilt document, and a bare
 * fragment does not move focus in every browser, so the hub places it.
 */
const PREVIEW_RETURN_HASH = '#preview-draft';

const EDITORS = [
  { id: 'layouts', title: 'Layouts', description: 'Site layout and booking menu', icon: LayoutTemplate },
  { id: 'appearance', title: 'Style & Colours', description: 'The look you chose during setup', icon: Palette },
  { id: 'information', title: 'Your Information', description: 'Business details and public visibility', icon: UserRound },
  { id: 'text', title: 'About & Website Text', description: 'Your introduction and bio', icon: Type },
  { id: 'policies', title: 'Policies & Booking Rules', description: 'Client policies and booking settings', icon: ShieldCheck },
  { id: 'gallery', title: 'Photos & Gallery', description: 'Your shared portfolio library', icon: Images },
] as const;

export function BookingPageHub({
  locale,
  salonName,
  salonSlug,
  published,
  publicUrl,
  hasDraftChanges,
  setupUrl,
  canPublish = true,
}: {
  locale: string;
  salonName: string;
  salonSlug: string;
  published: boolean;
  publicUrl?: string;
  hasDraftChanges: boolean;
  setupUrl: string | null;
  /**
   * Publishing locks the public address for good, so it is the owner's call:
   * `POST /api/admin/salon/publish` answers a collaborator 403 OWNER_REQUIRED
   * and this hides the control that would walk them into it. The server is the
   * authority; this is the explanation.
   */
  canPublish?: boolean;
}) {
  const [copyStatus, setCopyStatus] = useState('');
  const previewLinkRef = useRef<HTMLAnchorElement>(null);
  useEffect(() => {
    if (window.location.hash === PREVIEW_RETURN_HASH) {
      previewLinkRef.current?.focus();
    }
  }, []);
  const query = `salon=${encodeURIComponent(salonSlug)}`;
  const workspace = `/${locale}/admin?${query}`;
  const editor = `/${locale}/admin/booking-page?${query}`;
  const publicPath = `/${locale}/${encodeURIComponent(salonSlug)}`;
  const liveUrl = publicUrl || publicPath;
  const actionClass = 'inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-[var(--owner-line-strong)] bg-[var(--owner-surface)] px-4 py-3 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--owner-focus)]';

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(new URL(liveUrl, window.location.origin).href);
      setCopyStatus('Link copied');
    } catch {
      setCopyStatus('Could not copy. Open your live site and copy its address.');
    }
  }

  return (
    <main className="owner-workspace-theme min-h-screen bg-[var(--owner-ground)] px-4 pb-12 pt-6 text-[var(--owner-ink)]" data-theme-scope="owner">
      <div className="mx-auto max-w-3xl">
        <a className={actionClass} href={`${workspace}&tab=more`}>
          <ArrowLeft aria-hidden="true" size={18} />
          More apps
        </a>
        <header className="my-6">
          <p className="break-words text-sm font-semibold text-[var(--owner-accent)]">{salonName}</p>
          <h1 className="mt-1 text-3xl font-semibold">Booking Page</h1>
          <p className="mt-2 text-sm text-[var(--owner-muted)]">
            {!published ? 'Not published yet' : hasDraftChanges ? 'Live · Draft changes not published' : 'Live · All changes published'}
          </p>
          <p className="mt-3 break-all text-sm text-[var(--owner-muted)]">{liveUrl}</p>
          <div className="mt-4 flex flex-wrap gap-2">
            <a className={`${actionClass} border-[var(--owner-accent)] text-white`} id="preview-draft" ref={previewLinkRef} style={{ backgroundColor: 'var(--owner-accent)' }} href={`/${locale}/admin/booking-page/preview/${encodeURIComponent(salonSlug)}`}>Preview draft</a>
            {published && <a className={actionClass} href={liveUrl} rel="noreferrer" target="_blank">Open live site</a>}
            {published && (
              <button className={actionClass} onClick={() => void copyLink()} type="button">
                <Copy aria-hidden="true" size={16} />
                Copy link
              </button>
            )}
            {canPublish
              ? <a className={actionClass} href={`${editor}&panel=publish`}>{published ? 'Review & publish changes' : 'Publish website'}</a>
              : (
                  <p className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-[var(--owner-line)] bg-[var(--owner-ground)] px-4 py-3 text-sm font-semibold text-[var(--owner-muted)]">
                    <Lock aria-hidden="true" size={16} />
                    Publishing is owner only
                  </p>
                )}
          </div>
          <p aria-live="polite" className="mt-2 text-sm text-[var(--owner-muted)]">{copyStatus}</p>
        </header>
        <nav aria-label="Booking Page editors" className="grid grid-cols-2 gap-3">
          {EDITORS.map(({ id, title, description, icon: Icon }) => (
            <a
              className="min-w-0 rounded-2xl border border-[var(--owner-line)] bg-[var(--owner-surface)] p-4 shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--owner-focus)]"
              href={id === 'gallery' ? `${workspace}&app=portfolio` : `${editor}&panel=${id}`}
              key={id}
            >
              <span className="mb-3 inline-flex size-11 items-center justify-center rounded-xl bg-[var(--owner-blush)] text-[var(--owner-accent)]"><Icon aria-hidden="true" size={22} /></span>
              <span className="block text-base font-semibold leading-snug">{title}</span>
              <span className="mt-1 block text-sm leading-snug text-[var(--owner-muted)]">{description}</span>
            </a>
          ))}
        </nav>
        <a className={`${actionClass} mt-4 w-full`} href={`${workspace}&app=services`}>
          <Scissors aria-hidden="true" size={18} />
          Services & Add-ons
        </a>
        {/*
          The step-by-step setup flow only exists for a salon that has not gone
          live: `WebsiteHubPage` asks for the handoff exclusively while
          `publicationStatus === 'draft'`, so `setupUrl` is null for every
          published salon. Saying "Review saved setup" and then not offering it
          reads as a broken promise, so a published salon is told why and sent
          to the editors above, which hold the same choices in the same order.
        */}
        <section className="mt-6 rounded-2xl border border-[var(--owner-line)] p-4">
          <h2 className="font-semibold">Review setup step by step</h2>
          {setupUrl
            ? (
                <>
                  <p className="mt-1 text-sm text-[var(--owner-muted)]">Review your existing setup using the guided flow. Nothing is reset.</p>
                  <a className={`${actionClass} mt-3`} href={setupUrl}>
                    <Check aria-hidden="true" size={16} />
                    Review saved setup
                  </a>
                </>
              )
            : published
              ? (
                  <>
                    <p className="mt-1 text-sm text-[var(--owner-muted)]" data-testid="hub-setup-published-note">
                      Your site is live, so the setup flow that builds a new site is closed. Every choice it
                      made is in the editors above — this walks you through them in the same order, and
                      nothing is reset.
                    </p>
                    <a className={`${actionClass} mt-3`} href={`${editor}&panel=information&guided=1`}>
                      <Check aria-hidden="true" size={16} />
                      Review setup in the editors
                    </a>
                  </>
                )
              : (
                  <>
                    <p className="mt-1 text-sm text-[var(--owner-muted)]">Review your existing setup using the guided flow. Nothing is reset.</p>
                    <a className={`${actionClass} mt-3`} href={`${editor}&panel=information&guided=1`}>
                      <Check aria-hidden="true" size={16} />
                      Review current setup
                    </a>
                  </>
                )}
        </section>
      </div>
    </main>
  );
}
