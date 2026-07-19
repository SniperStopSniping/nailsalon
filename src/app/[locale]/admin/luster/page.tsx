'use client';

/**
 * Luster brand page — education, product resources, and owner marketing consent.
 *
 * Integrations (Google Calendar, Twilio texting) moved to More → Integrations.
 * Legacy links that still carry ?google= / ?twilio= callback params are safely
 * redirected to the Integrations app so old bookmarks and in-flight OAuth
 * round-trips keep working.
 */

import { ArrowLeft, BookOpen, ExternalLink, Plug, ShoppingBag, Sparkles } from 'lucide-react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';

const RESOURCES = [
  { id: 'builder-gel-foundations', title: 'Builder Gel Foundations', description: 'Prep, structure, apex placement, and removal fundamentals.', url: process.env.NEXT_PUBLIC_LUSTER_BUILDER_GEL_EDUCATION_URL || 'https://luster.com/pages/builder-gel-education', icon: BookOpen },
  { id: 'technique-guides', title: 'Technique Guides', description: 'Practical service guides designed for working nail techs.', url: process.env.NEXT_PUBLIC_LUSTER_TECHNIQUE_GUIDES_URL || 'https://luster.com/pages/education', icon: Sparkles },
  { id: 'wholesale-builder-gel', title: 'Shop Builder Gel', description: 'See Luster professional products and wholesale offers.', url: process.env.NEXT_PUBLIC_LUSTER_BUILDER_GEL_SHOP_URL || 'https://luster.com/collections/builder-gel', icon: ShoppingBag },
];

export default function LusterOwnerPage() {
  const router = useRouter();
  const params = useParams();
  const searchParams = useSearchParams();
  const locale = String(params?.locale || 'en');
  const [salonSlug, setSalonSlug] = useState(searchParams.get('salon') || '');
  const [marketingConsent, setMarketingConsent] = useState(false);

  const buildIntegrationsUrl = (slug: string) => {
    const qs = new URLSearchParams();
    if (slug) {
      qs.set('salon', slug);
    }
    qs.set('app', 'integrations');
    const googleParam = searchParams.get('google');
    const twilioParam = searchParams.get('twilio');
    if (googleParam) {
      qs.set('google', googleParam);
    }
    if (twilioParam) {
      qs.set('twilio', twilioParam);
    }
    return `/${locale}/admin?${qs.toString()}`;
  };

  // Legacy integration links (old OAuth callbacks, bookmarks) land here with
  // ?google= / ?twilio= params — forward them to the Integrations app.
  const hasLegacyIntegrationParams
    = searchParams.has('google') || searchParams.has('twilio');

  useEffect(() => {
    if (hasLegacyIntegrationParams) {
      router.replace(buildIntegrationsUrl(searchParams.get('salon') || ''));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasLegacyIntegrationParams]);

  useEffect(() => {
    if (hasLegacyIntegrationParams) {
      return;
    }
    async function bootstrap() {
      let slug = salonSlug;
      if (!slug) {
        const me = await fetch('/api/admin/auth/me', { cache: 'no-store' }).then(response => response.json());
        slug = me.user?.salons?.[0]?.slug || '';
        setSalonSlug(slug);
      }
      if (!slug) {
        return;
      }
      const consentPayload = await fetch(`/api/admin/luster/marketing-consent?salonSlug=${encodeURIComponent(slug)}`, { cache: 'no-store' }).then(response => response.json());
      setMarketingConsent(consentPayload.data?.consented === true);
    }
    void bootstrap();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function trackResource(resourceId: string, url: string) {
    navigator.sendBeacon?.('/api/admin/luster/resource-click', new Blob([JSON.stringify({ salonSlug, resourceId, url })], { type: 'application/json' }));
  }
  async function updateMarketingConsent(consented: boolean) {
    setMarketingConsent(consented);
    await fetch('/api/admin/luster/marketing-consent', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ salonSlug, consented }) });
  }

  if (hasLegacyIntegrationParams) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#F8F3F0]">
        <div className="size-8 animate-spin rounded-full border-2 border-rose-200 border-t-rose-700" />
      </main>
    );
  }

  const card = 'rounded-3xl border border-stone-200 bg-white p-6 shadow-sm';
  return (
    <main className="min-h-screen bg-[#F8F3F0] px-4 py-8 text-stone-900">
      <div className="mx-auto max-w-5xl">
        <button type="button" onClick={() => router.push(`/${locale}/admin${salonSlug ? `?salon=${encodeURIComponent(salonSlug)}` : ''}`)} className="inline-flex items-center gap-2 text-sm text-stone-600">
          <ArrowLeft size={16} />
          {' '}
          Dashboard
        </button>
        <div className="mt-6">
          <p className="text-xs font-semibold uppercase tracking-[0.25em] text-rose-700">Luster for nail techs</p>
          <h1 className="mt-2 text-3xl font-semibold">Builder Gel education and resources</h1>
          <p className="mt-2 text-stone-600">Your booking app stays free. Learn techniques, shop professional products, and grow your services.</p>
        </div>

        <section className="mt-8">
          <h2 className="text-2xl font-semibold">Grow your Builder Gel services</h2>
          <div className="mt-4 grid gap-4 md:grid-cols-3">
            {RESOURCES.map((resource) => {
              const Icon = resource.icon;

              return (
                <a key={resource.id} href={`${resource.url}?utm_source=luster_booking&utm_medium=owner_dashboard&utm_campaign=free_booking`} target="_blank" rel="noreferrer" onClick={() => void trackResource(resource.id, resource.url)} className={card}>
                  <Icon className="text-rose-700" />
                  <h3 className="mt-4 font-semibold">{resource.title}</h3>
                  <p className="mt-2 text-sm text-stone-600">{resource.description}</p>
                  <span className="mt-4 inline-flex items-center gap-1 text-sm font-semibold text-rose-700">
                    Open resource
                    <ExternalLink size={14} />
                  </span>
                </a>
              );
            })}
          </div>
        </section>

        <button
          type="button"
          onClick={() => router.push(buildIntegrationsUrl(salonSlug))}
          className="mt-8 flex w-full items-center gap-3 rounded-2xl border border-stone-200 bg-white p-4 text-left shadow-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-rose-400 active:bg-stone-50"
        >
          <span className="flex size-10 items-center justify-center rounded-xl bg-rose-100 text-rose-800">
            <Plug size={20} />
          </span>
          <span>
            <span className="block text-sm font-semibold text-stone-900">Looking for Google Calendar or texting setup?</span>
            <span className="block text-sm text-stone-600">Integrations moved to More → Integrations.</span>
          </span>
        </button>

        <label className="mt-8 flex items-start gap-3 rounded-2xl border border-stone-200 bg-white p-4 text-sm text-stone-600">
          <input type="checkbox" checked={marketingConsent} onChange={event => void updateMarketingConsent(event.target.checked)} className="mt-1" />
          <span>Email me Luster education, product updates, and wholesale offers. This owner consent is separate from every customer’s appointment consent.</span>
        </label>
      </div>
    </main>
  );
}
