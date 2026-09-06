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

  /*
    Back goes to the More grid the Luster tile was tapped from, not to Today.
    The workspace reads ?tab=more on mount, so this restores the same screen
    whether the owner arrived by tap or by a bookmarked Luster URL.
  */
  const buildMoreTabUrl = (slug: string) => {
    const qs = new URLSearchParams();
    if (slug) {
      qs.set('salon', slug);
    }
    qs.set('tab', 'more');
    return `/${locale}/admin?${qs.toString()}`;
  };

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
      <main className="owner-workspace-theme flex min-h-screen items-center justify-center bg-[var(--owner-ground)]" data-theme-scope="owner">
        <div aria-label="Opening Integrations" className="size-8 animate-spin rounded-full border-2 border-[var(--owner-line)] border-t-[var(--owner-accent)]" role="status" />
      </main>
    );
  }

  const card = 'rounded-owner-card border border-[var(--owner-line)] bg-[var(--owner-surface)] p-6 shadow-owner-card';
  const pill = 'inline-flex min-h-11 items-center rounded-full border border-[var(--owner-line-strong)] bg-[var(--owner-blush)] px-4 py-2 text-sm font-semibold text-[var(--owner-accent-strong)] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-[var(--owner-focus)] active:bg-[var(--owner-line)]';
  const pillCta = 'inline-flex items-center gap-1';
  // LusterExternalLink defaults its call-to-action to text-rose-700; the owner
  // workspace paints links from the token layer instead.
  const cardCta = 'mt-4 inline-flex items-center gap-1 text-sm font-semibold text-[var(--owner-accent)]';

  return (
    <main className="owner-workspace-theme min-h-screen bg-[var(--owner-ground)] px-4 py-8 text-[var(--owner-ink)]" data-theme-scope="owner">
      <div className="mx-auto max-w-5xl">
        <button type="button" onClick={() => router.push(buildMoreTabUrl(salonSlug))} className="-ml-1 inline-flex min-h-11 items-center gap-2 rounded-full px-1 text-sm font-semibold text-[var(--owner-accent)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--owner-focus)]">
          <ArrowLeft aria-hidden="true" size={16} />
          {' '}
          More apps
        </button>
        <div className="mt-6">
          <p className="text-xs font-semibold uppercase tracking-[0.25em] text-[var(--owner-accent)]">Luster Studio</p>
          <h1 className="mt-2 text-3xl font-semibold">Luster for Nail Artists</h1>
          <p className="mt-2 text-[var(--owner-muted)]">Discover professional products, artist offers and practical education from Luster Studio.</p>
        </div>

        <section className="mt-8" aria-label="Promotions">
          <h2 className="text-2xl font-semibold">Promotions</h2>
          <p className="mt-1 text-sm text-[var(--owner-muted)]">Current offers and campaigns from Luster Studio.</p>
          {/* Honest empty state: there is no live promotion feed, so nothing is
              claimed here beyond where to look on the Luster Studio site. */}
          <div className={`mt-4 ${card}`}>
            <Tag aria-hidden="true" className="text-[var(--owner-accent)]" />
            <p className="mt-4 font-semibold">New Luster offers will appear here.</p>
            <p className="mt-2 text-sm text-[var(--owner-muted)]">Nothing is running right now. The Luster Studio site always has the latest.</p>
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
          <p className="mt-1 text-sm text-[var(--owner-muted)]">Products, wholesale, and artist opportunities.</p>
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            {SHOP_ACTIONS.map((action) => {
              const Icon = action.icon;

              return (
                <LusterExternalLink
                  key={action.id}
                  path={action.path}
                  cta={action.cta}
                  className={card}
                  ctaClassName={cardCta}
                  onNavigate={() => trackResource(action.id, `https://lusterstudio.ca${action.path}`)}
                >
                  <Icon aria-hidden="true" className="text-[var(--owner-accent)]" />
                  <h3 className="mt-4 font-semibold">{action.title}</h3>
                  <p className="mt-2 text-sm text-[var(--owner-muted)]">{action.description}</p>
                </LusterExternalLink>
              );
            })}
          </div>
        </section>

        <section className="mt-8" aria-label="Learn">
          <h2 className="text-2xl font-semibold">Learn</h2>
          <p className="mt-1 text-sm text-[var(--owner-muted)]">Practical education from Luster Studio.</p>
          <LusterExternalLink
            path="/learn"
            cta="Browse learning"
            className={`mt-4 block ${card}`}
            ctaClassName={cardCta}
            onNavigate={() => trackResource('learn-overview', 'https://lusterstudio.ca/learn')}
          >
            <BookOpen aria-hidden="true" className="text-[var(--owner-accent)]" />
            <h3 className="mt-4 font-semibold">Learn overview</h3>
            <p className="mt-2 text-sm text-[var(--owner-muted)]">Every Luster Studio guide in one place.</p>
          </LusterExternalLink>
          <ul className="mt-4 divide-y divide-[var(--owner-line)] overflow-hidden rounded-owner-card border border-[var(--owner-line)] bg-[var(--owner-surface)] shadow-owner-card">
            {LEARN_GUIDES.map(guide => (
              <li key={guide.id}>
                <LusterExternalLink
                  path={guide.path}
                  cta="View guide"
                  className="flex min-h-11 items-center justify-between gap-3 p-4 outline-none transition-colors focus-visible:ring-2 focus-visible:ring-[var(--owner-focus)] active:bg-[var(--owner-ground)]"
                  ctaClassName="inline-flex shrink-0 items-center gap-1 text-sm font-semibold text-[var(--owner-accent)]"
                  onNavigate={() => trackResource(guide.id, `https://lusterstudio.ca${guide.path}`)}
                >
                  <span className="min-w-0 break-words text-sm font-medium text-[var(--owner-ink)]">{guide.title}</span>
                </LusterExternalLink>
              </li>
            ))}
          </ul>
        </section>

        <hr className="mt-10 border-[var(--owner-line)]" />

        <label className="mt-6 flex items-start gap-3 rounded-2xl border border-[var(--owner-line)] bg-[var(--owner-surface)] p-4 text-sm text-[var(--owner-muted)]">
          <input type="checkbox" checked={marketingConsent} onChange={event => void updateMarketingConsent(event.target.checked)} className="mt-1" />
          <span>Email me Luster education, product updates, and wholesale offers. This owner consent is separate from every customer’s appointment consent.</span>
        </label>
      </div>
    </main>
  );
}
