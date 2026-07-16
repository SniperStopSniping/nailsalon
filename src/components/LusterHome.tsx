import { CalendarCheck2, Mail, Sparkles } from 'lucide-react';
import Link from 'next/link';

export function LusterHome({ locale = 'en' }: { locale?: string }) {
  const prefix = locale === 'en' ? '/en' : `/${locale}`;

  return (
    <main className="min-h-screen bg-[#fffaf7] text-stone-950">
      <header className="mx-auto flex max-w-6xl items-center justify-between p-5 sm:px-8">
        <Link href="/" className="text-xl font-black tracking-[0.18em] text-[#a70f3c]">LUSTER</Link>
        <Link href={`${prefix}/owner-sign-in`} className="rounded-full border border-stone-300 bg-white px-5 py-2.5 text-sm font-semibold shadow-sm">
          Salon owner sign in
        </Link>
      </header>

      <section className="mx-auto grid max-w-6xl gap-10 px-5 pb-16 pt-12 sm:px-8 lg:grid-cols-[1.1fr_0.9fr] lg:items-center lg:py-24">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.28em] text-[#a70f3c]">Luster for nail techs</p>
          <h1 className="mt-4 max-w-3xl text-5xl font-black leading-[0.98] tracking-[-0.04em] sm:text-7xl">
            Free booking tools built for better nail businesses.
          </h1>
          <p className="mt-6 max-w-2xl text-lg leading-8 text-stone-600">
            Manage appointments, clients, services, Google Calendar, and optional reminders in one polished workspace—powered by Luster Builder Gel.
          </p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <Link href={`${prefix}/owner-sign-in`} className="rounded-full bg-[#b80f43] px-6 py-3.5 text-center font-bold text-white shadow-lg shadow-rose-900/15">
              Open owner dashboard
            </Link>
            <a href="mailto:support@islanailsalon.com?subject=Luster%20booking%20invite" className="rounded-full border border-stone-300 bg-white px-6 py-3.5 text-center font-bold">
              Request an invite
            </a>
          </div>
          <p className="mt-4 text-sm text-stone-500">Already booked with a salon? Use the private link in your confirmation email or the salon’s “Find my booking” page.</p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-1">
          {[
            { icon: CalendarCheck2, title: 'Smarter scheduling', copy: 'Services, buffers, availability, and Google busy time work together to prevent double-booking.' },
            { icon: Mail, title: 'Guest-friendly booking', copy: 'Clients book without an account and manage appointments through secure email links.' },
            { icon: Sparkles, title: 'Built to help nail techs grow', copy: 'A simple CRM, polished booking page, and Luster education live in the same free workspace.' },
          ].map(item => (
            <article key={item.title} className="rounded-[1.75rem] border border-rose-100 bg-white p-6 shadow-[0_18px_50px_rgba(70,35,35,0.07)]">
              <item.icon className="size-6 text-[#b80f43]" />
              <h2 className="mt-4 text-xl font-bold">{item.title}</h2>
              <p className="mt-2 leading-7 text-stone-600">{item.copy}</p>
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}
