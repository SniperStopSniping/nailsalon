'use client';

import { ArrowLeft, ArrowUpRight, Check, ChevronDown, Copy, Globe2, Lock, Scissors, Settings2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { BookingPageNavigation } from '@/components/admin/BookingPageNavigation';
import OwnerAssistantLauncher from '@/components/admin/ownerAssistant/OwnerAssistantLauncher';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { completeOnboardingDashboardHandoff } from '@/features/onboarding-v1-integration/flow-storage';
import { isIslaBookingPage } from '@/libs/islaBookingPage';
import { publishSalon } from '@/libs/publishWebsiteClient';

/**
 * AG-hub-publish-08 — the owner draft preview's "Back to editor" control
 * returns here with this fragment. Focus has to land back on the control the
 * owner left from rather than at the top of a rebuilt document, and a bare
 * fragment does not move focus in every browser, so the hub places it.
 */
const PREVIEW_RETURN_HASH = '#preview-draft';

export function BookingPageHub(props: BookingPageHubProps) {
  // Do not carry a completed request or confirmation across salon switches.
  return <BookingPageHubContent {...props} key={props.salonSlug} />;
}

type BookingPageHubProps = {
  locale: string;
  salonName: string;
  salonSlug: string;
  published: boolean;
  publicUrl?: string;
  hasDraftChanges: boolean;
  setupUrl: string | null;
  onboardingHandoff?: Parameters<typeof completeOnboardingDashboardHandoff>[0];
  canPublish?: boolean;
  isFreeSolo?: boolean;
};

function BookingPageHubContent({
  locale,
  salonName,
  salonSlug,
  published,
  publicUrl,
  hasDraftChanges,
  setupUrl,
  onboardingHandoff,
  canPublish = true,
  isFreeSolo = false,
}: BookingPageHubProps) {
  useEffect(() => {
    // This is now the first owner workspace after plan claim. Retire only
    // the server-authorized matching flow so Build a site can start fresh.
    if (onboardingHandoff) {
      completeOnboardingDashboardHandoff(onboardingHandoff);
    }
  }, [onboardingHandoff]);
  const [launched, setLaunched] = useState(false);
  const [publishedDraftChanges, setPublishedDraftChanges] = useState<boolean | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [publishError, setPublishError] = useState('');
  const publishPendingRef = useRef(false);
  const isPublished = published || launched;
  const hasUnpublishedChanges = publishedDraftChanges ?? hasDraftChanges;
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

  async function publish() {
    if (publishPendingRef.current || !canPublish || isPublished) {
      return;
    }
    publishPendingRef.current = true;
    setPublishing(true);
    setPublishError('');
    try {
      const result = await publishSalon(salonSlug);
      setPublishedDraftChanges(result.hasDraftChanges ?? false);
      setLaunched(true);
      setConfirming(false);
    } catch {
      setConfirming(false);
      setPublishError('Your website could not be published. Your saved setup is safe. Please try again.');
    } finally {
      setPublishing(false);
      publishPendingRef.current = false;
    }
  }

  return (
    <main className="owner-workspace-theme min-h-screen bg-[var(--owner-ground)] px-4 pb-12 pt-6 text-[var(--owner-ink)]" data-theme-scope="owner">
      <div className="mx-auto max-w-4xl">
        <a className={actionClass} href={workspace}>
          <ArrowLeft aria-hidden="true" size={18} />
          Dashboard
        </a>
        <header className="mb-6 mt-8">
          <p className="break-words text-sm font-semibold text-[var(--owner-accent)]">{salonName}</p>
          <h1 className="owner-title mt-2 text-4xl tracking-tight">Your website</h1>
          <p className="mt-2 text-sm leading-6 text-[var(--owner-muted)]">
            {isPublished ? 'Your home for bookings. Make it yours, whenever you like.' : 'Your setup is saved. Take a look, then share it with the world.'}
          </p>
        </header>
        <section aria-labelledby="website-launch-title" className="mb-6 rounded-[28px] border border-[var(--owner-line)] bg-[var(--owner-surface)] p-5 shadow-sm sm:p-6">
          <div className="flex items-center gap-3">
            <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-[var(--owner-blush)] text-[var(--owner-accent)]"><Globe2 aria-hidden="true" size={22} /></span>
            <div className="min-w-0">
              <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--owner-accent)]">{isPublished ? 'Live website' : 'Not published yet'}</p>
              <h2 id="website-launch-title" className="owner-title mt-1 text-2xl">{isPublished ? 'Ready to share' : 'Ready when you are'}</h2>
            </div>
          </div>
          <p className="mt-4 text-sm leading-6 text-[var(--owner-muted)]">
            {isPublished ? (hasUnpublishedChanges ? 'Live · Draft changes not published' : 'Live · All changes published') : 'Preview your saved website, then publish it here. You can keep editing after it goes live.'}
          </p>
          <div className="my-5 rounded-2xl border border-[var(--owner-line)] bg-[var(--owner-ground)] p-4">
            <p className="mb-1 text-xs font-semibold text-[var(--owner-muted)]">{isPublished ? 'Your website link' : 'Your website will be at'}</p>
            <p className="break-all text-sm font-medium">{liveUrl}</p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {isPublished
              ? (
                  <>
                    <button className={`${actionClass} border-[var(--owner-accent)] text-white`} style={{ backgroundColor: 'var(--owner-accent)' }} onClick={() => void copyLink()} type="button">
                      <Copy aria-hidden="true" size={16} />
                      Copy link
                    </button>
                    <a className={actionClass} href={liveUrl} rel="noreferrer" target="_blank">
                      Open live site
                      <ArrowUpRight aria-hidden="true" size={16} />
                    </a>
                  </>
                )
              : (
                  <>
                    <a className={actionClass} id="preview-draft" ref={previewLinkRef} href={`/${locale}/admin/booking-page/preview/${encodeURIComponent(salonSlug)}`}>
                      Preview draft
                      <ArrowUpRight aria-hidden="true" size={16} />
                    </a>
                    {canPublish
                      ? <button className={`${actionClass} border-[var(--owner-accent)] text-white disabled:opacity-60`} style={{ backgroundColor: 'var(--owner-accent)' }} disabled={publishing} onClick={() => setConfirming(true)} type="button">{publishing ? 'Publishing…' : 'Publish website'}</button>
                      : (
                          <p className="flex min-h-11 items-center gap-2 text-sm text-[var(--owner-muted)]">
                            <Lock aria-hidden="true" size={16} />
                            Publishing is owner only
                          </p>
                        )}
                  </>
                )}
          </div>
          {isPublished && (
            <div className="mt-3 flex flex-wrap gap-2">
              <a className={actionClass} id="preview-draft" ref={previewLinkRef} href={`/${locale}/admin/booking-page/preview/${encodeURIComponent(salonSlug)}`}>Preview draft</a>
              {canPublish && <a className={actionClass} href={`${editor}&panel=publish`}>Review &amp; publish changes</a>}
            </div>
          )}
          {publishError && <p role="alert" className="mt-3 text-sm leading-6 text-[var(--owner-accent)]">{publishError}</p>}
          <p aria-live="polite" className="mt-3 text-sm text-[var(--owner-muted)]">
            {launched ? 'Your website is live. ' : ''}
            {copyStatus}
          </p>
        </section>
        <details className="group rounded-3xl border border-[var(--owner-line)] bg-[var(--owner-surface)] p-4 sm:p-5" open={published || !canPublish}>
          <summary className="flex min-h-11 cursor-pointer list-none items-center gap-3 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--owner-focus)] [&::-webkit-details-marker]:hidden">
            <Settings2 aria-hidden="true" className="shrink-0 text-[var(--owner-accent)]" size={20} />
            <span className="min-w-0 flex-1">
              <span className="block font-semibold">Edit website</span>
              <span className="mt-1 block text-sm text-[var(--owner-muted)]">Details, photos, services &amp; design</span>
            </span>
            <ChevronDown aria-hidden="true" className="shrink-0 transition-transform group-open:rotate-180" size={18} />
          </summary>
          <div className="mt-5">
            <BookingPageNavigation editorHref={editor} includeFlow={!isFreeSolo} customIsla={isIslaBookingPage(salonSlug)} />
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
                : isPublished
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
        </details>
        <ConfirmDialog
          isOpen={confirming}
          title="Publish your website?"
          confirmLabel="Publish website"
          cancelLabel="Keep draft"
          busy={publishing}
          onClose={() => setConfirming(false)}
          onConfirm={() => void publish()}
          description={(
            <>
              <p>Your saved website will be public at:</p>
              <p className="my-3 break-all font-medium">{liveUrl}</p>
              <p>This address becomes permanent. You can keep changing your website’s content and design.</p>
            </>
          )}
        />
      </div>
      <OwnerAssistantLauncher
        locale={locale === 'fr' ? 'fr' : 'en'}
        placement="standalone"
        salonSlug={salonSlug}
        screen="booking-page"
      />
    </main>
  );
}
