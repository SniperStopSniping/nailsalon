'use client';

import {
  CalendarCheck,
  Check,
  Circle,
  CircleAlert,
  CreditCard,
  ExternalLink,
  Link2,
  LoaderCircle,
  MonitorSmartphone,
  Settings2,
  Sparkles,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

export type HandoffSetupStatus = 'complete' | 'needs_attention' | 'not_started';
export type OnboardingHandoffResolution = 'absent' | 'available' | 'error';

export type OnboardingSiteHandoff = {
  handoff: {
    planIntent: 'founding_interest' | 'free' | 'monthly_interest' | null;
    showWelcome: boolean;
    tourCompleted: boolean;
  };
  setup: {
    googleCalendar: HandoffSetupStatus;
    payments: HandoffSetupStatus;
    servicesAdded: boolean;
    shareLink: HandoffSetupStatus;
  };
  site: {
    hasVisibleBookingSection: boolean;
    id: string;
    previewUrl: string;
    revision: number;
    setupAvailable: boolean;
    setupUrl: string;
  };
};

type ChecklistItem = {
  href?: string;
  label: string;
  status: HandoffSetupStatus;
  statusLabel: string;
};

const integrationPresentation = (
  kind: 'google' | 'payments' | 'share',
  status: HandoffSetupStatus,
): Pick<ChecklistItem, 'statusLabel'> => {
  if (status === 'complete') {
    return { statusLabel: kind === 'share' ? 'Shared' : 'Connected' };
  }
  if (status === 'needs_attention') {
    return { statusLabel: 'Needs attention' };
  }
  return { statusLabel: kind === 'share' ? 'Not shared yet' : 'Not connected' };
};

function ChecklistRow({ icon: Icon, item }: {
  icon: typeof MonitorSmartphone;
  item: ChecklistItem;
}) {
  const content = (
    <>
      <span className={`flex size-10 shrink-0 items-center justify-center rounded-full ${
        item.status === 'complete'
          ? 'bg-emerald-50 text-emerald-700'
          : item.status === 'needs_attention'
            ? 'bg-amber-50 text-amber-700'
            : 'bg-[var(--owner-ground)] text-[var(--owner-muted)]'
      }`}
      >
        <Icon aria-hidden="true" size={20} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold text-[var(--owner-ink)]">{item.label}</span>
        <span className="mt-0.5 block text-xs text-[var(--owner-muted)]">{item.statusLabel}</span>
      </span>
      {item.status === 'complete'
        ? <Check aria-hidden="true" className="shrink-0 text-emerald-700" size={19} />
        : item.status === 'needs_attention'
          ? <CircleAlert aria-hidden="true" className="shrink-0 text-amber-700" size={19} />
          : <Circle aria-hidden="true" className="shrink-0 text-stone-300" size={19} />}
      {item.href ? <ExternalLink aria-hidden="true" className="shrink-0 text-[var(--owner-muted)]" size={16} /> : null}
    </>
  );

  return item.href
    ? (
        <a
          className="flex min-h-14 items-center gap-3 rounded-2xl p-2 transition-colors hover:bg-[var(--owner-ground)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--owner-focus)]"
          href={item.href}
        >
          {content}
        </a>
      )
    : (
        <div className="flex min-h-14 items-center gap-3 rounded-2xl p-2">
          {content}
        </div>
      );
}

export function OnboardingWorkspaceHandoff({
  focusWelcome = false,
  locale,
  onAvailabilityChange,
  onHandoffChange,
  onResolutionChange,
  onTakeTour,
  salonSlug,
}: {
  focusWelcome?: boolean;
  locale: string;
  onAvailabilityChange?: (available: boolean) => void;
  onHandoffChange?: (handoff: OnboardingSiteHandoff | null) => void;
  onResolutionChange?: (resolution: OnboardingHandoffResolution) => void;
  onTakeTour: () => void;
  salonSlug: string;
}) {
  const [handoff, setHandoff] = useState<OnboardingSiteHandoff | null>(null);
  const [handoffSalonSlug, setHandoffSalonSlug] = useState<string | null>(null);
  const [canChangeSetup, setCanChangeSetup] = useState(false);
  const [dismissStatus, setDismissStatus] = useState<'idle' | 'saving' | 'error'>('idle');
  const welcomeHeadingRef = useRef<HTMLHeadingElement>(null);
  const bookingPageUrl = `/${locale}/admin/booking-page?salon=${encodeURIComponent(salonSlug)}`;

  const loadHandoff = useCallback(async (signal?: AbortSignal) => {
    if (!salonSlug) {
      return;
    }
    const response = await fetch(
      `/api/admin/onboarding-site?salonSlug=${encodeURIComponent(salonSlug)}&locale=${encodeURIComponent(locale)}`,
      { cache: 'no-store', signal },
    );
    if (signal?.aborted) {
      return;
    }
    if (response.status === 404 || response.status === 403) {
      setHandoff(null);
      setCanChangeSetup(false);
      onAvailabilityChange?.(false);
      onHandoffChange?.(null);
      onResolutionChange?.('absent');
      return;
    }
    if (!response.ok) {
      throw new Error(`Failed to load onboarding site handoff (${response.status})`);
    }
    const payload = await response.json() as { data?: OnboardingSiteHandoff } & Partial<OnboardingSiteHandoff>;
    if (signal?.aborted) {
      return;
    }
    const next = payload.data ?? (payload as OnboardingSiteHandoff);
    if (!next?.site?.id) {
      setHandoff(null);
      setCanChangeSetup(false);
      onAvailabilityChange?.(false);
      onHandoffChange?.(null);
      onResolutionChange?.('error');
      return;
    }
    setHandoff(next);
    setHandoffSalonSlug(salonSlug);
    // Setup loads the authorized saved revision from the server, including
    // when the owner signs in on a new device with no local draft.
    setCanChangeSetup(next.site.setupAvailable);
    onHandoffChange?.(next);
    onAvailabilityChange?.(true);
    onResolutionChange?.('available');
  }, [locale, onAvailabilityChange, onHandoffChange, onResolutionChange, salonSlug]);

  useEffect(() => {
    const controller = new AbortController();
    onHandoffChange?.(null);
    onAvailabilityChange?.(false);
    void loadHandoff(controller.signal).catch((error: unknown) => {
      if (controller.signal.aborted || (error instanceof DOMException && error.name === 'AbortError')) {
        return;
      }
      setHandoff(null);
      setCanChangeSetup(false);
      onHandoffChange?.(null);
      onResolutionChange?.('error');
    });
    return () => controller.abort();
  }, [loadHandoff, onAvailabilityChange, onHandoffChange, onResolutionChange]);

  useEffect(() => {
    if (!focusWelcome || !handoff?.handoff.showWelcome) {
      return;
    }
    welcomeHeadingRef.current?.focus({ preventScroll: true });
  }, [focusWelcome, handoff?.handoff.showWelcome]);

  const checklist = useMemo(() => {
    if (!handoff) {
      return { done: [] as ChecklistItem[], next: [] as ChecklistItem[] };
    }
    const core: ChecklistItem[] = [
      {
        label: 'Website created',
        status: 'complete',
        statusLabel: 'Ready',
      },
      {
        href: handoff.site.hasVisibleBookingSection
          ? handoff.site.previewUrl
          : canChangeSetup
            ? handoff.site.setupUrl
            : undefined,
        label: 'Booking page ready',
        status: handoff.site.hasVisibleBookingSection ? 'complete' : 'needs_attention',
        statusLabel: handoff.site.hasVisibleBookingSection ? 'Ready' : 'Needs attention',
      },
      {
        href: handoff.setup.servicesAdded ? undefined : `/${locale}/admin?salon=${encodeURIComponent(salonSlug)}&app=services`,
        label: 'Services added',
        status: handoff.setup.servicesAdded ? 'complete' : 'not_started',
        statusLabel: handoff.setup.servicesAdded ? 'Ready' : 'Add services',
      },
    ];
    const next: ChecklistItem[] = [
      {
        href: `/${locale}/admin?salon=${encodeURIComponent(salonSlug)}&app=integrations&focus=google`,
        label: 'Connect Google Calendar',
        status: handoff.setup.googleCalendar,
        ...integrationPresentation('google', handoff.setup.googleCalendar),
      },
      {
        href: `/${locale}/admin?salon=${encodeURIComponent(salonSlug)}&app=integrations&focus=payments`,
        label: 'Set up payments',
        status: handoff.setup.payments,
        ...integrationPresentation('payments', handoff.setup.payments),
      },
      {
        href: handoff.setup.shareLink === 'complete'
          ? handoff.site.previewUrl
          : undefined,
        label: 'Share booking link',
        status: handoff.setup.shareLink,
        ...integrationPresentation('share', handoff.setup.shareLink),
      },
    ];
    return {
      done: core.filter(item => item.status === 'complete'),
      next: [...core.filter(item => item.status !== 'complete'), ...next],
    };
  }, [canChangeSetup, handoff, locale, salonSlug]);

  if (!handoff || handoffSalonSlug !== salonSlug) {
    return null;
  }

  const dismissWelcome = async () => {
    if (dismissStatus === 'saving') {
      return;
    }
    setDismissStatus('saving');
    setHandoff(current => current
      ? { ...current, handoff: { ...current.handoff, showWelcome: false } }
      : current);
    try {
      const response = await fetch(
        `/api/admin/onboarding-site?salonSlug=${encodeURIComponent(salonSlug)}`,
        {
          body: JSON.stringify({ action: 'dismiss_welcome', siteId: handoff.site.id }),
          headers: { 'Content-Type': 'application/json' },
          method: 'PATCH',
        },
      );
      if (!response.ok) {
        throw new Error('Dismiss failed');
      }
      setDismissStatus('idle');
    } catch {
      setHandoff(current => current
        ? { ...current, handoff: { ...current.handoff, showWelcome: true } }
        : current);
      setDismissStatus('error');
    }
  };

  return (
    <div className="mx-auto w-full max-w-2xl px-4 pb-2" data-testid="onboarding-workspace-handoff">
      {handoff.handoff.showWelcome
        ? (
            <section
              aria-labelledby="onboarding-welcome-title"
              className="owner-surface relative overflow-hidden rounded-[28px] border border-[var(--owner-line)] bg-[linear-gradient(135deg,var(--owner-surface),var(--owner-blush))] p-5 shadow-[0_16px_40px_rgba(91,34,58,0.10)] sm:p-6"
            >
              <Sparkles aria-hidden="true" className="absolute -right-2 -top-2 text-[var(--owner-accent)] opacity-20" size={88} strokeWidth={1.2} />
              <button
                aria-label="Dismiss welcome"
                className="absolute right-3 top-3 flex size-11 items-center justify-center rounded-full text-[var(--owner-muted)] transition-colors hover:bg-white/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--owner-focus)]"
                disabled={dismissStatus === 'saving'}
                onClick={() => void dismissWelcome()}
                type="button"
              >
                {dismissStatus === 'saving'
                  ? <LoaderCircle aria-hidden="true" className="animate-spin" size={19} />
                  : <X aria-hidden="true" size={19} />}
              </button>
              <div className="relative pr-10">
                <p className="text-xs font-semibold uppercase tracking-[0.19em] text-[var(--owner-accent)]">Saved to your account</p>
                <h2
                  className="mt-2 text-2xl font-semibold tracking-tight text-[var(--owner-ink)] sm:text-[28px]"
                  id="onboarding-welcome-title"
                  ref={welcomeHeadingRef}
                  tabIndex={-1}
                >
                  Your Luster site is ready
                </h2>
                <p className="mt-2 max-w-xl text-[15px] leading-6 text-[var(--owner-muted)]">
                  Your website, booking page and service menu are set up.
                </p>
                {handoff.handoff.planIntent === 'founding_interest'
                || handoff.handoff.planIntent === 'monthly_interest'
                  ? (
                      <p className="mt-3 rounded-2xl border border-[var(--owner-line)] bg-white/75 px-4 py-3 text-sm font-semibold text-[var(--owner-ink)]" role="status">
                        {handoff.handoff.planIntent === 'founding_interest'
                          ? 'Founding offer reserved.'
                          : 'Monthly interest saved.'}
                        {' '}
                        <span className="font-normal text-[var(--owner-muted)]">Nothing was charged today.</span>
                      </p>
                    )
                  : null}
                <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
                  <a
                    className="flex min-h-11 items-center justify-center gap-2 rounded-full bg-[var(--owner-accent)] px-5 text-sm font-semibold text-white transition-colors hover:bg-[var(--owner-accent-strong)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--owner-focus)] focus-visible:ring-offset-2"
                    href={handoff.site.previewUrl}
                  >
                    <MonitorSmartphone aria-hidden="true" size={18} />
                    Preview website
                  </a>
                  <a
                    className="flex min-h-11 items-center justify-center gap-2 rounded-full border border-[var(--owner-line-strong)] bg-white px-5 text-sm font-semibold text-[var(--owner-ink)] transition-colors hover:bg-[var(--owner-ground)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--owner-focus)]"
                    href={bookingPageUrl}
                  >
                    <CalendarCheck aria-hidden="true" size={18} />
                    Manage &amp; publish Booking Page
                  </a>
                  {canChangeSetup
                    ? (
                        <a
                          className="flex min-h-11 items-center justify-center gap-2 rounded-full border border-[var(--owner-line-strong)] bg-white px-5 text-sm font-semibold text-[var(--owner-ink)] transition-colors hover:bg-[var(--owner-ground)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--owner-focus)]"
                          href={handoff.site.setupUrl}
                        >
                          <Settings2 aria-hidden="true" size={18} />
                          Change website setup
                        </a>
                      )
                    : null}
                  <button
                    className="flex min-h-11 items-center justify-center gap-2 rounded-full px-5 text-sm font-semibold text-[var(--owner-accent)] transition-colors hover:bg-white/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--owner-focus)]"
                    onClick={onTakeTour}
                    type="button"
                  >
                    <Sparkles aria-hidden="true" size={18} />
                    Take a quick tour
                  </button>
                </div>
              </div>
              {dismissStatus === 'error'
                ? (
                    <p className="mt-3 text-sm text-red-700" role="alert">The welcome could not be dismissed. Try again.</p>
                  )
                : null}
            </section>
          )
        : null}

      <section
        aria-labelledby="onboarding-checklist-title"
        className="owner-surface mt-4 rounded-[28px] border border-[var(--owner-line)] bg-[var(--owner-surface)] p-5 shadow-sm sm:p-6"
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--owner-accent)]">Your setup</p>
            <h2 className="mt-1 text-xl font-semibold text-[var(--owner-ink)]" id="onboarding-checklist-title">What’s next</h2>
          </div>
          <button
            className="min-h-11 rounded-full px-3 text-sm font-semibold text-[var(--owner-accent)] hover:bg-[var(--owner-ground)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--owner-focus)]"
            onClick={onTakeTour}
            type="button"
          >
            Take tour
          </button>
        </div>

        <a
          className="mt-4 flex min-h-12 items-center gap-3 rounded-2xl border border-[var(--owner-line)] bg-[var(--owner-ground)] px-4 py-2 text-sm font-semibold text-[var(--owner-ink)] transition-colors hover:border-[var(--owner-line-strong)] hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--owner-focus)]"
          href={bookingPageUrl}
        >
          <CalendarCheck aria-hidden="true" className="text-[var(--owner-accent)]" size={20} />
          <span className="flex-1">Manage &amp; publish Booking Page</span>
          <ExternalLink aria-hidden="true" className="text-[var(--owner-muted)]" size={16} />
        </a>

        {checklist.done.length > 0
          ? (
              <div className="mt-5">
                <h3 className="text-sm font-semibold text-[var(--owner-ink)]">Done</h3>
                <div className="mt-1 divide-y divide-[var(--owner-line)]">
                  {checklist.done.map(item => (
                    <ChecklistRow icon={MonitorSmartphone} item={item} key={item.label} />
                  ))}
                </div>
              </div>
            )
          : null}

        <div className="mt-5 border-t border-[var(--owner-line)] pt-5">
          <h3 className="text-sm font-semibold text-[var(--owner-ink)]">Whenever you’re ready</h3>
          <div className="mt-1 divide-y divide-[var(--owner-line)]">
            {checklist.next.map((item) => {
              const icon = item.label.includes('Calendar')
                ? CalendarCheck
                : item.label.includes('payment')
                  ? CreditCard
                  : item.label.includes('link')
                    ? Link2
                    : item.label.includes('Service')
                      ? Settings2
                      : MonitorSmartphone;
              return <ChecklistRow icon={icon} item={item} key={item.label} />;
            })}
          </div>
        </div>
      </section>
    </div>
  );
}
