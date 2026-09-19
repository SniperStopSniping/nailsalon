'use client';

import { BookOpen, CalendarClock, CreditCard, HelpCircle, Shield, SlidersHorizontal, Users } from 'lucide-react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';

import { DialogShell } from '@/components/ui/dialog-shell';
import { type OwnerManagementApp, ownerManagementView } from '@/libs/ownerNavigation';

import { BackButton, ModalHeader } from './AppModal';
import { BookingPageInformationEditor } from './BookingPageInformationEditor';
import { ChoosePlanPanel } from './ChoosePlanPanel';
import { OwnerAppHub } from './OwnerAppHub';
import { SettingsModal } from './SettingsModal';
import { UsageBillingModal } from './UsageBillingModal';

const NO_CHANGE = () => undefined;
// Hours mode does not expose Quick Book presentation switches, but the shared
// editor still needs the complete read-only draft shape.
const HOURS_EDITOR_DRAFT = {
  layout: 'quick_book' as const,
  quickBookProfile: {
    version: 1 as const,
    showTechName: false,
    showTechPhoto: false,
    showLocation: false,
    showHours: false,
    showPhone: false,
    showEmail: false,
    showBookingPolicy: false,
    showCancellationPolicy: false,
    showReviews: false,
    showInstagram: false,
    showBio: false,
  },
};

export function OwnerManagementModal({ app, salonSlug, salonId, isFreeSolo, teamAvailable, onClose, onOpenApp, registerClose }: {
  app: OwnerManagementApp;
  salonSlug: string | null;
  salonId?: string | null;
  isFreeSolo: boolean;
  teamAvailable: boolean;
  onClose: () => void;
  onOpenApp?: (app: string) => void;
  registerClose?: (handler: (() => void) | null) => void;
}) {
  const router = useRouter();
  const params = useParams<{ locale?: string }>();
  const search = useSearchParams();
  const pushedDepth = useRef(0);
  const [hoursDirty, setHoursDirty] = useState(false);
  const [pendingLeave, setPendingLeave] = useState<(() => void) | null>(null);
  const leave = useCallback((action: () => void) => {
    if (hoursDirty) {
      setPendingLeave(() => action);
    } else {
      action();
    }
  }, [hoursDirty]);
  useEffect(() => {
    registerClose?.(() => leave(onClose));
    return () => registerClose?.(null);
  }, [leave, onClose, registerClose]);
  useEffect(() => {
    if (!hoursDirty) {
      return;
    }
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [hoursDirty]);
  const locale = params?.locale === 'fr' ? 'fr' : 'en';
  const view = ownerManagementView(app, search?.get('view') ?? null);
  const href = (next: string) => {
    const query = new URLSearchParams(search?.toString());
    if (salonSlug) {
      query.set('salon', salonSlug);
    }
    query.set('app', app);
    query.delete('view');
    if (next !== 'home') {
      query.set('view', next);
    }
    return `/${locale}/admin?${query.toString()}`;
  };
  const open = (next: string) => {
    pushedDepth.current += 1;
    router.push(href(next), { scroll: false });
  };
  const back = () => {
    if (pushedDepth.current > 0) {
      pushedDepth.current -= 1;
      router.back();
    } else {
      router.replace(href('home'), { scroll: false });
    }
  };

  if (app === 'booking-rules') {
    if (view === 'rules' || view === 'policies') {
      return <SettingsModal key={view} initialView={view === 'rules' ? 'booking' : 'booking-policy'} leafOnly leafBackLabel="Booking Rules & Policies" onClose={back} salonSlug={salonSlug} salonId={salonId} isFreeSolo={isFreeSolo} onOpenApp={onOpenApp} />;
    }
    return (
      <OwnerAppHub
        title="Booking Rules & Policies"
        subtitle="Booking rules and client-facing terms"
        onBack={onClose}
        onOpen={open}
        items={[
          { id: 'rules', title: 'Booking rules', description: 'Minimum notice, buffers, time slots, confirmation and changes', icon: SlidersHorizontal },
          { id: 'policies', title: 'Client policies', description: 'Cancellation wording, acknowledgements and where policies appear', icon: Shield },
        ]}
      />
    );
  }

  if (app === 'hours') {
    return (
      <div className="min-h-full bg-[var(--owner-ground)] pb-10 text-[var(--owner-ink)]">
        <ModalHeader title="Hours & Availability" subtitle="Regular hours and exceptions to your schedule" leftAction={<BackButton onClick={() => leave(onClose)} label="More" />} />
        <div className="space-y-4 px-4">
          {salonSlug ? <BookingPageInformationEditor locale={locale} salonSlug={salonSlug} mode="hours" onDirtyChange={setHoursDirty} disabled={false} draft={HOURS_EDITOR_DRAFT} addressPrivacy="city_only" liveAddressPrivacy="city_only" onAddressPrivacyChange={NO_CHANGE} onConfigPatch={NO_CHANGE} /> : <p>Select a salon to manage hours.</p>}
          <p className="text-sm text-[var(--owner-muted)]">Bookable times also depend on working schedules, time off, existing appointments and booking rules.</p>
          {teamAvailable && <button type="button" className="min-h-11 w-full rounded-xl border border-[var(--owner-line)] p-3 text-left" onClick={() => leave(() => onOpenApp?.('team'))}>Working schedules &amp; time off</button>}
          <button type="button" className="min-h-11 w-full rounded-xl border border-[var(--owner-line)] p-3 text-left" onClick={() => leave(() => onOpenApp?.('schedule'))}>View calendar</button>
          <button type="button" className="min-h-11 w-full rounded-xl border border-[var(--owner-line)] p-3 text-left" onClick={() => leave(() => onOpenApp?.('booking-rules'))}>Booking rules</button>
        </div>
        <DialogShell isOpen={pendingLeave !== null} onClose={() => setPendingLeave(null)} maxWidthClassName="max-w-sm">
          <div className="rounded-2xl bg-white p-5" role="dialog" aria-label="Unsaved hours">
            <h2 className="font-semibold">Discard unsaved hours?</h2>
            <p className="mt-2 text-sm">Your changes have not been saved.</p>
            <div className="mt-4 flex gap-3">
              <button type="button" className="min-h-11 rounded-xl border px-3" onClick={() => setPendingLeave(null)}>Keep editing</button>
              <button
                type="button"
                className="min-h-11 rounded-xl border px-3"
                onClick={() => {
                  const action = pendingLeave;
                  setPendingLeave(null);
                  setHoursDirty(false);
                  action?.();
                }}
              >
                Discard changes
              </button>
            </div>
          </div>
        </DialogShell>
      </div>
    );
  }

  if (app === 'plan-usage') {
    return (
      <>
        <OwnerAppHub
          title="Plan & Usage"
          subtitle="Your Luster subscription and message usage"
          onBack={onClose}
          onOpen={open}
          items={[
            { id: 'usage', title: 'Usage & billing', description: 'SMS credits, delivery history and billing management', icon: CreditCard, disabled: !salonSlug },
            ...(!isFreeSolo ? [{ id: 'plans', title: 'Compare plans', description: 'Current Luster plans and available options', icon: CalendarClock, disabled: !salonSlug }] : []),
          ]}
        />
        {view === 'usage' && salonSlug && <UsageBillingModal salonSlug={salonSlug} onClose={back} />}
        {view === 'plans' && !isFreeSolo && salonSlug && <ChoosePlanPanel salonSlug={salonSlug} onClose={back} />}
      </>
    );
  }

  return (
    <OwnerAppHub
      title="Help & Resources"
      subtitle="Guidance for running your workspace"
      onBack={onClose}
      onOpen={id => onOpenApp?.(id)}
      items={[
        { id: 'workspace-tour', title: 'Workspace tour', description: 'Replay the guide to Today, Calendar, Clients and Services', icon: HelpCircle },
        { id: 'luster', title: 'Luster resources', description: 'Products, offers, education and email preferences', icon: BookOpen },
        { id: 'settings', title: 'Account & settings', description: 'Owner account, workspace preferences and legal information', icon: Users },
      ]}
    />
  );
}
