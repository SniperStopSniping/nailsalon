'use client';

/**
 * Choose plan — P7 self-serve subscription checkout surface.
 *
 * Governing contract: docs/luster-billing-communications-rev-2-2.md §3.9,
 * §8.5, §12. Plan/Gap register: docs/luster-billing-remaining-work-plan.md
 * §3 G19/G21, §5 P7, §6 D4/D5.
 *
 * Replaces the informational-only `ComparePlansModal` (§15 C2 said delete;
 * D5 ratified the deletion). Renders the catalogue straight from the
 * usage/billing-status response (`GET
 * /api/admin/salon/communications/usage`) — never a client-side mirror of
 * plan prices — so a server-side repricing is visible here with no client
 * change. No feature-matrix copy beyond SMS credits and included email
 * (§12) — Claude MUST NOT invent staff/location/feature differences.
 *
 * While `capabilities.subscriptions` is false (billing stays dark) the
 * cards are informational only, exactly what the owner saw before this
 * surface existed. Once true, each card starts a real Stripe Checkout via
 * `POST /api/billing/checkout` and shows the server's disclosure (amount
 * charged now, renewal amount, rate-protection term, and — for the
 * founding promotion — that it applies to the first annual term only)
 * before redirecting (§8.5, §3.9). A live subscription is handed off to
 * the existing Billing Portal flow (`ACTIVE_SUBSCRIPTION_EXISTS`).
 */
import { X } from 'lucide-react';
import { useEffect, useState } from 'react';

import { DialogShell } from '@/components/ui/dialog-shell';

type PublicPlanProjection = {
  key: string;
  family: string;
  displayName: string;
  monthlySmsCredits: number;
  starterCreditsOneTime: number;
  transactionalEmailIncluded: true;
};

type BillingCadence = 'monthly' | 'annual';

type PublicBillingOfferProjection = {
  key: string;
  planDefinitionKey: string;
  cadence: BillingCadence;
  priceCents: number;
  currency: 'cad';
};

type FoundingProjection = {
  key: string;
  percentOff: number;
  rateProtectionMonths: number;
  eligibleOfferKeys: string[];
  endsAt: string | null;
};

type Capabilities = {
  subscriptions: boolean;
  topups: boolean;
  pricingPublic: boolean;
};

type Catalog = {
  plans: PublicPlanProjection[];
  offers: PublicBillingOfferProjection[];
  founding: FoundingProjection | null;
};

type Disclosure = {
  billingOfferKey: string;
  planDefinitionKey: string;
  cadence: BillingCadence;
  currency: 'cad';
  firstTermCents: number;
  renewalCents: number;
  promotionKey?: string;
  rateProtectionMonths?: number;
};

type CheckoutResult = {
  url: string;
  disclosure: Disclosure;
};

type ChoosePlanPanelProps = {
  salonSlug: string;
  onClose: () => void;
};

function formatCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

export function ChoosePlanPanel({ salonSlug, onClose }: ChoosePlanPanelProps) {
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [salonId, setSalonId] = useState<string | null>(null);
  const [capabilities, setCapabilities] = useState<Capabilities | null>(null);
  const [catalog, setCatalog] = useState<Catalog | null>(null);

  const [pendingOfferKey, setPendingOfferKey] = useState<string | null>(null);
  const [checkoutError, setCheckoutError] = useState<string | null>(null);
  const [activeSubscriptionMessage, setActiveSubscriptionMessage] = useState<string | null>(null);
  const [checkoutResult, setCheckoutResult] = useState<CheckoutResult | null>(null);
  const [portalLoading, setPortalLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch(`/api/admin/salon/communications/usage?salonSlug=${salonSlug}`);
        if (!response.ok) {
          throw new Error('usage fetch failed');
        }
        const body = await response.json();
        if (!cancelled) {
          setSalonId(body.data.salonId);
          setCapabilities(body.data.capabilities);
          setCatalog(body.data.catalog);
        }
      } catch {
        if (!cancelled) {
          setLoadError('Could not load plans. Please try again.');
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [salonSlug]);

  const chooseOffer = async (offer: PublicBillingOfferProjection) => {
    if (salonId === null || pendingOfferKey !== null) {
      return;
    }
    setPendingOfferKey(offer.key);
    setCheckoutError(null);
    setActiveSubscriptionMessage(null);
    try {
      const founding = catalog?.founding ?? null;
      const promotionKey
        = offer.cadence === 'annual' && founding !== null && founding.eligibleOfferKeys.includes(offer.key)
          ? founding.key
          : undefined;
      const response = await fetch('/api/billing/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          salonId,
          billingOfferKey: offer.key,
          ...(promotionKey !== undefined ? { promotionKey } : {}),
        }),
      });
      const body = await response.json().catch(() => null);
      if (response.ok && body?.data?.url) {
        setCheckoutResult({ url: body.data.url, disclosure: body.data.disclosure });
        return;
      }
      if (body?.error?.code === 'ACTIVE_SUBSCRIPTION_EXISTS') {
        setActiveSubscriptionMessage(body.error.message);
        return;
      }
      setCheckoutError(body?.error?.message ?? 'Could not start checkout. Please try again.');
    } catch {
      setCheckoutError('Could not start checkout. Please try again.');
    } finally {
      setPendingOfferKey(null);
    }
  };

  const openManageBilling = async () => {
    if (salonId === null || portalLoading) {
      return;
    }
    setPortalLoading(true);
    try {
      const response = await fetch('/api/billing/portal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ salonId }),
      });
      const body = await response.json().catch(() => null);
      if (response.ok && body?.url) {
        window.location.assign(body.url);
        return;
      }
      setCheckoutError(body?.error?.message ?? 'The billing portal could not be opened.');
    } catch {
      setCheckoutError('The billing portal could not be opened.');
    } finally {
      setPortalLoading(false);
    }
  };

  const offersByPlan = new Map<string, PublicBillingOfferProjection[]>();
  (catalog?.offers ?? []).forEach((offer) => {
    const list = offersByPlan.get(offer.planDefinitionKey) ?? [];
    list.push(offer);
    offersByPlan.set(offer.planDefinitionKey, list);
  });
  const cards = (catalog?.plans ?? [])
    .filter(plan => offersByPlan.has(plan.key))
    .map(plan => ({
      plan,
      monthly: offersByPlan.get(plan.key)!.find(offer => offer.cadence === 'monthly') ?? null,
      annual: offersByPlan.get(plan.key)!.find(offer => offer.cadence === 'annual') ?? null,
    }));
  const showCards = !loading && !loadError && catalog !== null && capabilities !== null
    && checkoutResult === null && activeSubscriptionMessage === null;

  return (
    <DialogShell
      isOpen
      onClose={onClose}
      alignClassName="items-end justify-center p-0 sm:items-center sm:p-4"
      maxWidthClassName="max-w-2xl"
      contentClassName="max-h-[90vh] overflow-hidden rounded-t-[20px] bg-[var(--owner-surface)] shadow-xl supports-[height:100dvh]:max-h-[90dvh] sm:rounded-[20px]"
    >
      <div role="dialog" aria-modal="true" aria-labelledby="choose-plan-title" data-testid="choose-plan-panel">
        <div className="flex items-center justify-between border-b border-[var(--owner-line)] px-5 py-4">
          <h2 id="choose-plan-title" className="text-lg font-semibold text-[var(--owner-ink)]">
            {checkoutResult !== null ? 'Confirm your plan' : 'Choose plan'}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close choose plan"
            className="flex size-11 items-center justify-center rounded-full bg-[var(--owner-ground)] transition-colors hover:bg-gray-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-950"
          >
            <X className="size-4 text-[var(--owner-muted)]" />
          </button>
        </div>

        <div className="max-h-[calc(90vh-120px)] touch-pan-y overflow-y-auto overscroll-contain p-5 supports-[height:100dvh]:max-h-[calc(90dvh-120px)]">
          {loading && (
            <p role="status" aria-live="polite" className="text-sm text-[var(--owner-muted)]">Loading plans…</p>
          )}
          {loadError !== null && <p className="text-sm text-red-600">{loadError}</p>}

          {showCards && (
            <>
              {/* Content mirrors the CANONICAL catalogue only (§12); feature
                  access is unchanged by these plans until the separately
                  approved feature matrix lands — plans differ only in
                  monthly SMS credits. */}
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                {cards.map(({ plan, monthly, annual }) => (
                  <div
                    key={plan.key}
                    data-testid={`choose-plan-card-${plan.family}`}
                    className="rounded-xl border-2 border-[var(--owner-line)] bg-[var(--owner-surface)] p-4"
                  >
                    <div className="mb-3 text-center">
                      <h3 className="text-lg font-semibold text-[var(--owner-ink)]">{plan.displayName}</h3>
                      {monthly !== null && (
                        <div className="mt-1 text-2xl font-bold text-[var(--owner-ink)]">
                          {formatCents(monthly.priceCents)}
                          <span className="text-sm font-normal"> / month</span>
                        </div>
                      )}
                    </div>
                    <ul className="space-y-2 text-sm text-[var(--owner-muted)]">
                      <li>
                        {plan.monthlySmsCredits}
                        {' '}
                        SMS credits / month
                      </li>
                      <li>Email confirmations and reminders included</li>
                      {annual !== null && (
                        <li>
                          {formatCents(annual.priceCents)}
                          {' '}
                          / year (10 monthly payments)
                        </li>
                      )}
                    </ul>
                    {capabilities!.subscriptions && (
                      <div className="mt-3 flex gap-2">
                        {monthly !== null && (
                          <button
                            type="button"
                            data-testid={`choose-plan-monthly-${plan.family}`}
                            onClick={() => void chooseOffer(monthly)}
                            disabled={pendingOfferKey !== null}
                            className="flex-1 rounded-[10px] bg-[var(--owner-accent)] px-3 py-2 text-sm font-semibold text-white outline-none transition-colors hover:bg-[var(--owner-accent-strong)] disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            {pendingOfferKey === monthly.key ? 'Starting…' : 'Choose monthly'}
                          </button>
                        )}
                        {annual !== null && (
                          <button
                            type="button"
                            data-testid={`choose-plan-annual-${plan.family}`}
                            onClick={() => void chooseOffer(annual)}
                            disabled={pendingOfferKey !== null}
                            className="flex-1 rounded-[10px] border border-[var(--owner-line)] px-3 py-2 text-sm font-semibold text-[var(--owner-ink)] outline-none transition-colors hover:bg-[var(--owner-ground)] disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            {pendingOfferKey === annual.key ? 'Starting…' : 'Choose annual'}
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>

              {checkoutError !== null && (
                <p
                  role="status"
                  aria-live="polite"
                  data-testid="choose-plan-error"
                  className="mt-4 text-center text-sm text-red-600"
                >
                  {checkoutError}
                </p>
              )}

              <p className="mt-4 text-center text-xs text-[var(--owner-muted)]">
                Prices in CAD, plus applicable taxes. Annual plans renew at the
                standard annual price. Your current feature access does not
                change with these plans.
              </p>

              {!capabilities!.subscriptions && (
                <p className="mt-6 text-center text-xs text-[var(--owner-muted)]">
                  To change plans, contact Luster at support@lustergel.app
                </p>
              )}
            </>
          )}

          {activeSubscriptionMessage !== null && (
            <div className="space-y-4 text-center" data-testid="choose-plan-active-subscription">
              <p className="text-sm text-[var(--owner-ink)]">{activeSubscriptionMessage}</p>
              <div className="flex justify-center gap-3">
                <button
                  type="button"
                  data-testid="choose-plan-active-back"
                  onClick={() => setActiveSubscriptionMessage(null)}
                  className="rounded-[10px] border border-[var(--owner-line)] px-4 py-2.5 text-sm font-medium text-[var(--owner-ink)] outline-none transition-colors hover:bg-[var(--owner-ground)]"
                >
                  Back
                </button>
                <button
                  type="button"
                  data-testid="choose-plan-manage-billing"
                  onClick={() => void openManageBilling()}
                  disabled={portalLoading}
                  className="rounded-[10px] bg-[var(--owner-accent)] px-4 py-2.5 text-sm font-semibold text-white outline-none transition-colors hover:bg-[var(--owner-accent-strong)] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {portalLoading ? 'Opening…' : 'Manage billing'}
                </button>
              </div>
            </div>
          )}

          {checkoutResult !== null && (
            <div className="space-y-4" data-testid="choose-plan-confirmation">
              <p className="text-sm text-[var(--owner-ink)]">
                You will be charged
                {' '}
                <strong>{formatCents(checkoutResult.disclosure.firstTermCents)}</strong>
                {' '}
                now.
              </p>
              <p className="text-sm text-[var(--owner-ink)]">
                Renews at
                {' '}
                <strong>{formatCents(checkoutResult.disclosure.renewalCents)}</strong>
                {' '}
                per
                {' '}
                {checkoutResult.disclosure.cadence === 'annual' ? 'year' : 'month'}
                .
              </p>
              {checkoutResult.disclosure.rateProtectionMonths !== undefined && (
                <p className="text-sm text-[var(--owner-ink)]">
                  Your base rate is protected for
                  {' '}
                  {checkoutResult.disclosure.rateProtectionMonths}
                  {' '}
                  months.
                </p>
              )}
              {checkoutResult.disclosure.promotionKey !== undefined && (
                <p className="text-sm text-[var(--owner-muted)]">
                  This discount applies to your first annual term only — you
                  will renew at the standard annual price after.
                </p>
              )}
              <div className="flex justify-center gap-3">
                <button
                  type="button"
                  data-testid="choose-plan-back"
                  onClick={() => setCheckoutResult(null)}
                  className="rounded-[10px] border border-[var(--owner-line)] px-4 py-2.5 text-sm font-medium text-[var(--owner-ink)] outline-none transition-colors hover:bg-[var(--owner-ground)]"
                >
                  Back
                </button>
                <button
                  type="button"
                  data-testid="choose-plan-continue"
                  onClick={() => window.location.assign(checkoutResult.url)}
                  className="rounded-[10px] bg-[var(--owner-accent)] px-4 py-2.5 text-sm font-semibold text-white outline-none transition-colors hover:bg-[var(--owner-accent-strong)]"
                >
                  Continue to secure checkout
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </DialogShell>
  );
}
