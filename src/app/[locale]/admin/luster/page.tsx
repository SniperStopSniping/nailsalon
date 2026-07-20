'use client';

/**
 * Luster brand page — promotions, products, education, and owner marketing consent.
 *
 * Approved information hierarchy: Promotions → Shop → Learn, with the owner
 * marketing-consent control after all three as a separate account setting.
 *
 * Integrations (Google Calendar, Twilio texting) live only in More →
 * Integrations — no integration controls or integration wayfinding here.
 * Legacy links that still carry ?google= / ?twilio= callback params are safely
 * redirected to the Integrations app so old bookmarks and in-flight OAuth
 * round-trips keep working.
 */

import { ArrowLeft, BookOpen, Package, ShoppingBag, Tag, UserPlus } from 'lucide-react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';

import { LusterExternalLink } from '@/components/admin/LusterExternalLink';

// Real Luster resources only — links that exist today on lusterstudio.ca.
// Do not add rewards, points, certifications, or ambassador programs here
// unless the actual program (and its URL) exists.
const SHOP_ACTIONS = [
  {
    id: 'shop-products',
    path: '/shop',
    icon: ShoppingBag,
    title: 'Shop professional products',
    description: 'Professional Luster products for the services you already offer.',
    cta: 'Shop products',
  },
  {
    id: 'wholesale-information',
    path: '/wholesale',
    icon: Package,
    title: 'Wholesale information',
    description: 'Ordering and wholesale details for working nail artists.',
    cta: 'View wholesale',
  },
  {
    id: 'join-luster',
    path: '/join',
    icon: UserPlus,
    title: 'Join Luster',
    description: 'Artist opportunities and ways to work with Luster Studio.',
    cta: 'Join Luster',
  },
] as const;

const LEARN_GUIDES = [
  { id: 'builder-gel-foundations', path: '/learn/builder-gel-foundations', title: 'Builder Gel Foundations' },
  { id: 'nail-preparation-and-retention', path: '/learn/nail-preparation-and-retention', title: 'Nail Preparation and Retention' },
  { id: 'choosing-flex-vs-control-builder', path: '/learn/choosing-flex-vs-control-builder', title: 'Choosing Flex vs Control Builder' },
  { id: 'builder-gel-application', path: '/learn/builder-gel-application', title: 'Builder Gel Application' },
  { id: 'apex-and-structure', path: '/learn/apex-and-structure', title: 'Apex and Structure' },
  { id: 'rebalancing-and-fill-maintenance', path: '/learn/rebalancing-and-fill-maintenance', title: 'Rebalancing and Fill Maintenance' },
  { id: 'safe-product-removal', path: '/learn/safe-product-removal', title: 'Safe Product Removal' },
  { id: 'troubleshooting-lifting', path: '/learn/troubleshooting-lifting', title: 'Troubleshooting Lifting' },
  { id: 'troubleshooting-heat-spikes', path: '/learn/troubleshooting-heat-spikes', title: 'Troubleshooting Heat Spikes' },
  { id: 'product-storage-and-handling', path: '/learn/product-storage-and-handling', title: 'Product Storage and Handling' },
] as const;

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

  function trackResource(resourceId: string, url: string) {
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
  const pill = 'inline-flex items-center rounded-full border border-rose-200 bg-rose-50 px-4 py-2 text-sm font-semibold text-rose-700 transition-colors active:bg-rose-100';
  const pillCta = 'inline-flex items-center gap-1';

  return (
    <main className="min-h-screen bg-[#F8F3F0] px-4 py-8 text-stone-900">
      <div className="mx-auto max-w-5xl">
        <button type="button" onClick={() => router.push(`/${locale}/admin${salonSlug ? `?salon=${encodeURIComponent(salonSlug)}` : ''}`)} className="inline-flex items-center gap-2 text-sm text-stone-600">
          <ArrowLeft size={16} />
          {' '}
          Dashboard
        </button>
        <div className="mt-6">
          <p className="text-xs font-semibold uppercase tracking-[0.25em] text-rose-700">Luster Studio</p>
          <h1 className="mt-2 text-3xl font-semibold">Luster for Nail Artists</h1>
          <p className="mt-2 text-stone-600">Discover professional products, artist offers and practical education from Luster Studio.</p>
        </div>

        <section className="mt-8" aria-label="Promotions">
          <h2 className="text-2xl font-semibold">Promotions</h2>
          <p className="mt-1 text-sm text-stone-600">Current offers and campaigns from Luster Studio.</p>
          {/* Honest empty state: there is no live promotion feed, so nothing is
              claimed here beyond where to look on the Luster Studio site. */}
          <div className={`mt-4 ${card}`}>
            <Tag className="text-rose-700" />
            <p className="mt-4 font-semibold">New Luster offers will appear here.</p>
            <p className="mt-2 text-sm text-stone-600">Nothing is running right now. The Luster Studio site always has the latest.</p>
            <div className="mt-4 flex flex-wrap gap-3">
              <LusterExternalLink
                path="/promotions"
                cta="View promotions"
                className={pill}
                ctaClassName={pillCta}
                onNavigate={() => trackResource('promotions', 'https://lusterstudio.ca/promotions')}
              />
              <LusterExternalLink
                path="/shop"
                cta="Shop products"
                className={pill}
                ctaClassName={pillCta}
                onNavigate={() => trackResource('promotions-shop', 'https://lusterstudio.ca/shop')}
              />
            </div>
          </div>
        </section>

        <section className="mt-8" aria-label="Shop">
          <h2 className="text-2xl font-semibold">Shop</h2>
          <p className="mt-1 text-sm text-stone-600">Products, wholesale, and artist opportunities.</p>
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            {SHOP_ACTIONS.map((action) => {
              const Icon = action.icon;

              return (
                <LusterExternalLink
                  key={action.id}
                  path={action.path}
                  cta={action.cta}
                  className={card}
                  onNavigate={() => trackResource(action.id, `https://lusterstudio.ca${action.path}`)}
                >
                  <Icon className="text-rose-700" />
                  <h3 className="mt-4 font-semibold">{action.title}</h3>
                  <p className="mt-2 text-sm text-stone-600">{action.description}</p>
                </LusterExternalLink>
              );
            })}
          </div>
        </section>

        <section className="mt-8" aria-label="Learn">
          <h2 className="text-2xl font-semibold">Learn</h2>
          <p className="mt-1 text-sm text-stone-600">Practical education from Luster Studio.</p>
          <LusterExternalLink
            path="/learn"
            cta="Browse learning"
            className={`mt-4 block ${card}`}
            onNavigate={() => trackResource('learn-overview', 'https://lusterstudio.ca/learn')}
          >
            <BookOpen className="text-rose-700" />
            <h3 className="mt-4 font-semibold">Learn overview</h3>
            <p className="mt-2 text-sm text-stone-600">Every Luster Studio guide in one place.</p>
          </LusterExternalLink>
          <ul className="mt-4 divide-y divide-stone-200 overflow-hidden rounded-3xl border border-stone-200 bg-white shadow-sm">
            {LEARN_GUIDES.map(guide => (
              <li key={guide.id}>
                <LusterExternalLink
                  path={guide.path}
                  cta="View guide"
                  className="flex items-center justify-between gap-3 p-4 outline-none transition-colors focus-visible:ring-2 focus-visible:ring-rose-400 active:bg-stone-50"
                  ctaClassName="inline-flex shrink-0 items-center gap-1 text-sm font-semibold text-rose-700"
                  onNavigate={() => trackResource(guide.id, `https://lusterstudio.ca${guide.path}`)}
                >
                  <span className="min-w-0 break-words text-sm font-medium text-stone-900">{guide.title}</span>
                </LusterExternalLink>
              </li>
            ))}
          </ul>
        </section>

        <hr className="mt-10 border-stone-200" />

        <label className="mt-6 flex items-start gap-3 rounded-2xl border border-stone-200 bg-white p-4 text-sm text-stone-600">
          <input type="checkbox" checked={marketingConsent} onChange={event => void updateMarketingConsent(event.target.checked)} className="mt-1" />
          <span>Email me Luster education, product updates, and wholesale offers. This owner consent is separate from every customer’s appointment consent.</span>
        </label>
      </div>
    </main>
  );
}
