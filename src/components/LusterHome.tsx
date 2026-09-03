import { CalendarCheck2, Mail, Sparkles } from 'lucide-react';
import Link from 'next/link';

import en from '@/locales/en.json';
import fr from '@/locales/fr.json';

export function LusterHome({
  locale = 'en',
  websiteSetupEnabled = false,
}: {
  locale?: string;
  websiteSetupEnabled?: boolean;
}) {
  const prefix = locale === 'fr' ? '/fr' : '/en';
  const copy = locale === 'fr' ? fr.LusterHome : en.LusterHome;

  return (
    <main className="min-h-screen bg-[#fffaf7] text-stone-950">
      <header className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 p-5 sm:px-8">
        <Link href="/" className="inline-flex min-h-11 items-center text-xl font-black tracking-[0.18em] text-[#a70f3c]">LUSTER</Link>
        <Link href={`${prefix}/owner-sign-in`} className="inline-flex min-h-11 items-center rounded-full border border-stone-300 bg-white px-5 py-2.5 text-sm font-semibold shadow-sm">
          {copy.owner_sign_in}
        </Link>
      </header>

      <section className="mx-auto grid max-w-6xl gap-10 px-5 pb-16 pt-12 sm:px-8 lg:grid-cols-[1.1fr_0.9fr] lg:items-center lg:py-24">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.28em] text-[#a70f3c]">{copy.eyebrow}</p>
          <h1 className="mt-4 max-w-3xl text-5xl font-black leading-[0.98] tracking-[-0.04em] sm:text-7xl">
            {websiteSetupEnabled ? copy.headline : copy.legacy_headline}
          </h1>
          <p className="mt-6 max-w-2xl text-lg leading-8 text-stone-600">
            {websiteSetupEnabled ? copy.description : copy.legacy_description}
          </p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <Link href={`${prefix}/${websiteSetupEnabled ? 'onboarding-v1' : 'owner-sign-in'}`} className="inline-flex min-h-12 items-center justify-center rounded-full bg-[#b80f43] px-6 py-3.5 text-center font-bold text-white shadow-lg shadow-rose-900/15">
              {websiteSetupEnabled ? copy.build_website : copy.open_dashboard}
            </Link>
            {websiteSetupEnabled
              ? (
                  <Link href={`${prefix}/owner-sign-in`} className="inline-flex min-h-12 items-center justify-center rounded-full border border-stone-300 bg-white px-6 py-3.5 text-center font-bold">
                    {copy.open_dashboard}
                  </Link>
                )
              : (
                  <a href="mailto:support@islanailsalon.com?subject=Luster%20booking%20invite" className="inline-flex min-h-12 items-center justify-center rounded-full border border-stone-300 bg-white px-6 py-3.5 text-center font-bold">
                    {copy.request_invite}
                  </a>
                )}
          </div>
          {websiteSetupEnabled ? <p className="mt-4 text-sm leading-6 text-stone-600">{copy.preview_reassurance}</p> : null}
          <p className="mt-4 text-sm leading-6 text-stone-500">{copy.customer_help}</p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-1">
          {[
            { icon: CalendarCheck2, title: copy.scheduling_title, copy: copy.scheduling_copy },
            { icon: Mail, title: copy.booking_title, copy: copy.booking_copy },
            { icon: Sparkles, title: websiteSetupEnabled ? copy.website_title : copy.growth_title, copy: websiteSetupEnabled ? copy.website_copy : copy.growth_copy },
          ].map(item => (
            <article key={item.title} className="rounded-[1.75rem] border border-rose-100 bg-white p-6 shadow-[0_18px_50px_rgba(70,35,35,0.07)]">
              <item.icon aria-hidden="true" className="size-6 text-[#b80f43]" />
              <h2 className="mt-4 text-xl font-bold">{item.title}</h2>
              <p className="mt-2 leading-7 text-stone-600">{item.copy}</p>
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}
