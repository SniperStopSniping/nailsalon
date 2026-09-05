'use client';

import { ArrowLeft, Check, Copy, Images, LayoutTemplate, Palette, Scissors, ShieldCheck, Type, UserRound } from 'lucide-react';
import { useState } from 'react';

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
  hasDraftChanges,
  setupUrl,
}: {
  locale: string;
  salonName: string;
  salonSlug: string;
  published: boolean;
  hasDraftChanges: boolean;
  setupUrl: string | null;
}) {
  const [copyStatus, setCopyStatus] = useState('');
  const query = `salon=${encodeURIComponent(salonSlug)}`;
  const workspace = `/${locale}/admin?${query}`;
  const editor = `/${locale}/admin/booking-page?${query}`;
  const publicPath = `/${locale}/${encodeURIComponent(salonSlug)}`;
  const actionClass = 'inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-stone-300 bg-white px-4 py-3 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-700';

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(new URL(publicPath, window.location.origin).href);
      setCopyStatus('Link copied');
    } catch {
      setCopyStatus('Could not copy. Open your live site and copy its address.');
    }
  }

  return (
    <main className="min-h-screen bg-[#F8F3F0] px-4 pb-12 pt-6 text-stone-950">
      <div className="mx-auto max-w-3xl">
        <a className={actionClass} href={`${workspace}&tab=more`}>
          <ArrowLeft aria-hidden="true" size={18} />
          More apps
        </a>
        <header className="my-6">
          <p className="break-words text-sm font-semibold text-rose-800">{salonName}</p>
          <h1 className="mt-1 text-3xl font-semibold">Booking Page</h1>
          <p className="mt-2 text-sm text-stone-600">
            {!published ? 'Not published yet' : hasDraftChanges ? 'Live · Draft changes not published' : 'Live · All changes published'}
          </p>
          <p className="mt-3 break-all text-sm text-stone-600">{salonSlug}</p>
          <div className="mt-4 flex flex-wrap gap-2">
            <a className={`${actionClass} border-rose-800 text-white`} style={{ backgroundColor: '#8b3151' }} href={`/${locale}/admin/booking-page/preview/${encodeURIComponent(salonSlug)}`}>Preview draft</a>
            {published && <a className={actionClass} href={publicPath} rel="noreferrer" target="_blank">Open live site</a>}
            {published && (
              <button className={actionClass} onClick={() => void copyLink()} type="button">
                <Copy aria-hidden="true" size={16} />
                Copy link
              </button>
            )}
            <a className={actionClass} href={`${editor}&panel=publish`}>{published ? 'Review & publish changes' : 'Publish website'}</a>
          </div>
          <p aria-live="polite" className="mt-2 text-sm text-stone-600">{copyStatus}</p>
        </header>
        <nav aria-label="Booking Page editors" className="grid grid-cols-2 gap-3">
          {EDITORS.map(({ id, title, description, icon: Icon }) => (
            <a
              className="min-w-0 rounded-2xl border border-stone-200 bg-white p-4 shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-700"
              href={id === 'gallery' ? `${workspace}&app=portfolio` : `${editor}&panel=${id}`}
              key={id}
            >
              <span className="mb-3 inline-flex size-11 items-center justify-center rounded-xl bg-rose-100 text-rose-800"><Icon aria-hidden="true" size={22} /></span>
              <span className="block text-base font-semibold leading-snug">{title}</span>
              <span className="mt-1 block text-sm leading-snug text-stone-600">{description}</span>
            </a>
          ))}
        </nav>
        <a className={`${actionClass} mt-4 w-full`} href={`${workspace}&app=services`}>
          <Scissors aria-hidden="true" size={18} />
          Services & Add-ons
        </a>
        <section className="mt-6 rounded-2xl border border-stone-200 p-4">
          <h2 className="font-semibold">Review setup step by step</h2>
          <p className="mt-1 text-sm text-stone-600">Review your existing setup using the guided flow. Nothing is reset.</p>
          {setupUrl
            ? (
                <a className={`${actionClass} mt-3`} href={setupUrl}>
                  <Check aria-hidden="true" size={16} />
                  Review saved setup
                </a>
              )
            : <p className="mt-3 text-sm text-stone-600">Use the editors above for your current website. Guided review is available for unpublished onboarding drafts.</p>}
        </section>
      </div>
    </main>
  );
}
