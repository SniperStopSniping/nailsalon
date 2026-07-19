'use client';

/**
 * Luster Studio product and education area.
 *
 * External destinations are canonical URLs owned by lusterstudio.ca. The
 * public site owns guide availability and any Coming soon presentation; this
 * page never probes, hides, or replaces approved destinations.
 *
 * Integrations moved to More → Integrations. Legacy links that still carry
 * ?google= / ?twilio= callback params are safely redirected there so old
 * bookmarks and in-flight OAuth round-trips keep working.
 */

import { ArrowLeft, BookOpen, ExternalLink, Gift, GraduationCap, ShoppingBag, Sparkles, Users } from 'lucide-react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';

const LUSTER_STUDIO_URLS = {
  promotions: 'https://lusterstudio.ca/promotions',
  shop: 'https://lusterstudio.ca/shop',
  wholesale: 'https://lusterstudio.ca/wholesale',
  join: 'https://lusterstudio.ca/join',
  learn: 'https://lusterstudio.ca/learn',
  builderGelFoundations: 'https://lusterstudio.ca/learn/builder-gel-foundations',
  nailPreparationAndRetention: 'https://lusterstudio.ca/learn/nail-preparation-and-retention',
  flexVsControlBuilder: 'https://lusterstudio.ca/learn/choosing-flex-vs-control-builder',
  builderGelApplication: 'https://lusterstudio.ca/learn/builder-gel-application',
  apexAndStructure: 'https://lusterstudio.ca/learn/apex-and-structure',
  rebalancingAndFillMaintenance: 'https://lusterstudio.ca/learn/rebalancing-and-fill-maintenance',
  safeProductRemoval: 'https://lusterstudio.ca/learn/safe-product-removal',
  troubleshootingLifting: 'https://lusterstudio.ca/learn/troubleshooting-lifting',
  troubleshootingHeatSpikes: 'https://lusterstudio.ca/learn/troubleshooting-heat-spikes',
  productStorageAndHandling: 'https://lusterstudio.ca/learn/product-storage-and-handling',
} as const;

const SHOP_LINKS = [
  { id: 'professional-products', title: 'Shop professional products', description: 'Explore Luster Studio products for professional services.', url: LUSTER_STUDIO_URLS.shop, icon: ShoppingBag },
  { id: 'wholesale', title: 'Wholesale information', description: 'Learn about professional wholesale purchasing with Luster Studio.', url: LUSTER_STUDIO_URLS.wholesale, icon: Users },
  { id: 'join', title: 'Join Luster', description: 'Find out how to join the Luster Studio professional community.', url: LUSTER_STUDIO_URLS.join, icon: Gift },
] as const;

const LEARN_LINKS = [
  { id: 'builder-gel-foundations', title: 'Builder Gel Foundations', url: LUSTER_STUDIO_URLS.builderGelFoundations, icon: BookOpen },
  { id: 'nail-preparation-and-retention', title: 'Nail Preparation and Retention', url: LUSTER_STUDIO_URLS.nailPreparationAndRetention, icon: Sparkles },
  { id: 'choosing-flex-vs-control-builder', title: 'Product Selection', url: LUSTER_STUDIO_URLS.flexVsControlBuilder, icon: ShoppingBag },
  { id: 'builder-gel-application', title: 'Application Technique Guides', url: LUSTER_STUDIO_URLS.builderGelApplication, icon: GraduationCap },
  { id: 'apex-and-structure', title: 'Apex and Structure', url: LUSTER_STUDIO_URLS.apexAndStructure, icon: Sparkles },
  { id: 'rebalancing-and-fill-maintenance', title: 'Rebalancing and Fill Maintenance', url: LUSTER_STUDIO_URLS.rebalancingAndFillMaintenance, icon: BookOpen },
  { id: 'safe-product-removal', title: 'Safe Product Removal', url: LUSTER_STUDIO_URLS.safeProductRemoval, icon: BookOpen },
  { id: 'troubleshooting-lifting', title: 'Troubleshooting: Lifting', url: LUSTER_STUDIO_URLS.troubleshootingLifting, icon: Sparkles },
  { id: 'troubleshooting-heat-spikes', title: 'Troubleshooting: Heat Spikes', url: LUSTER_STUDIO_URLS.troubleshootingHeatSpikes, icon: Sparkles },
  { id: 'product-storage-and-handling', title: 'Product Storage and Handling', url: LUSTER_STUDIO_URLS.productStorageAndHandling, icon: ShoppingBag },
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

  const hasLegacyIntegrationParams = searchParams.has('google') || searchParams.has('twilio');

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
  const externalLinkProps = { target: '_blank', rel: 'noopener noreferrer' } as const;

  return (
    <main className="min-h-screen bg-[#F8F3F0] px-4 py-8 text-stone-900">
      <div className="mx-auto max-w-5xl">
        <button type="button" onClick={() => router.push(`/${locale}/admin${salonSlug ? `?salon=${encodeURIComponent(salonSlug)}` : ''}`)} className="inline-flex items-center gap-2 text-sm text-stone-600">
          <ArrowLeft size={16} />
          {' '}
          Dashboard
        </button>

        <header className="mt-6">
          <p className="text-xs font-semibold uppercase tracking-[0.25em] text-rose-700">Luster Studio</p>
          <h1 className="mt-2 text-3xl font-semibold">Luster</h1>
          <p className="mt-2 text-stone-600">Discover professional gel products, artist offers and education from Luster Studio.</p>
        </header>

        <section data-testid="luster-promos" aria-label="Promos" className="mt-8">
          <h2 className="text-2xl font-semibold">Promos</h2>
          <div className="mt-4 rounded-3xl border border-rose-100 bg-white p-6 shadow-sm">
            <Gift className="text-rose-700" />
            <h3 className="mt-4 font-semibold">New Luster offers will appear here.</h3>
            <p className="mt-2 text-sm text-stone-600">Visit Luster Studio to explore the latest offers and professional updates.</p>
            <a href={LUSTER_STUDIO_URLS.promotions} {...externalLinkProps} className="mt-4 inline-flex items-center gap-2 text-sm font-semibold text-rose-700">
              View Luster Studio promotions
              <ExternalLink size={14} />
            </a>
            <a href={LUSTER_STUDIO_URLS.shop} {...externalLinkProps} className="ml-4 mt-4 inline-flex items-center gap-2 text-sm font-semibold text-rose-700">
              Shop Luster Studio
              <ExternalLink size={14} />
            </a>
          </div>
        </section>

        <section data-testid="luster-shop" aria-label="Shop" className="mt-8">
          <h2 className="text-2xl font-semibold">Shop</h2>
          <p className="mt-1 text-sm text-stone-600">Shop professional products, wholesale options, and artist information from Luster Studio.</p>
          <div className="mt-4 grid gap-4 md:grid-cols-3">
            {SHOP_LINKS.map((resource) => {
              const Icon = resource.icon;
              return (
                <a key={resource.id} href={resource.url} {...externalLinkProps} onClick={() => trackResource(resource.id, resource.url)} className={card}>
                  <Icon className="text-rose-700" />
                  <h3 className="mt-4 font-semibold">{resource.title}</h3>
                  <p className="mt-2 text-sm text-stone-600">{resource.description}</p>
                  <span className="mt-4 inline-flex items-center gap-1 text-sm font-semibold text-rose-700">
                    Open Luster Studio website
                    <ExternalLink size={14} />
                  </span>
                </a>
              );
            })}
          </div>
        </section>

        <section data-testid="luster-learn" aria-label="Learn" className="mt-8">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 className="text-2xl font-semibold">Learn</h2>
              <p className="mt-1 text-sm text-stone-600">Explore professional resources and guides from Luster Studio.</p>
            </div>
            <a href={LUSTER_STUDIO_URLS.learn} {...externalLinkProps} className="inline-flex items-center gap-2 text-sm font-semibold text-rose-700">
              Browse all learning
              <ExternalLink size={14} />
            </a>
          </div>
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            {LEARN_LINKS.map((resource) => {
              const Icon = resource.icon;
              return (
                <a key={resource.id} href={resource.url} {...externalLinkProps} onClick={() => trackResource(resource.id, resource.url)} className={card}>
                  <Icon className="text-rose-700" />
                  <h3 className="mt-4 font-semibold">{resource.title}</h3>
                  <span className="mt-4 inline-flex items-center gap-1 text-sm font-semibold text-rose-700">
                    Open guide on Luster Studio
                    <ExternalLink size={14} />
                  </span>
                </a>
              );
            })}
          </div>
        </section>

        <label className="mt-8 flex items-start gap-3 rounded-2xl border border-stone-200 bg-white p-4 text-sm text-stone-600">
          <input type="checkbox" checked={marketingConsent} onChange={event => void updateMarketingConsent(event.target.checked)} className="mt-1" />
          <span>Email me Luster education, product updates, and wholesale offers. This owner consent is separate from every customer’s appointment consent.</span>
        </label>
      </div>
    </main>
  );
}
