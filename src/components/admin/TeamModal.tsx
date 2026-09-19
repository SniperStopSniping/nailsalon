'use client';

import { Banknote, CalendarClock, Clock3, KeyRound, Scissors, Users } from 'lucide-react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';

import { OwnerAppHub, type OwnerAppHubItem } from './OwnerAppHub';
import { SettingsModal } from './SettingsModal';
import { StaffModal } from './StaffModal';

type TeamView = 'home' | 'members' | 'schedules' | 'time-off' | 'requests' | 'blocked-time' | 'services' | 'permissions' | 'earnings';

const TEAM_ITEMS: ReadonlyArray<OwnerAppHubItem<Exclude<TeamView, 'home' | 'blocked-time'>>> = [
  { id: 'members', title: 'Team Members', description: 'People, roles, contact details and employment status', icon: Users },
  { id: 'schedules', title: 'Team schedules', description: 'Open Hours & Availability to manage weekly working hours', icon: CalendarClock },
  { id: 'time-off', title: 'Time Off', description: 'Open Hours & Availability to add time away from work', icon: Clock3 },
  { id: 'requests', title: 'Time-off requests', description: 'Review pending, approved and denied team requests', icon: Clock3 },
  { id: 'services', title: 'Services & Skills', description: 'Choose which services each technician can perform', icon: Scissors },
  { id: 'permissions', title: 'Permissions', description: 'Choose what staff can see in their workspace', icon: KeyRound },
  { id: 'earnings', title: 'Earnings', description: 'Commission, appointments and salon share', icon: Banknote },
];

export function TeamModal({
  onClose,
  salonSlug,
  salonId,
  isFreeSolo,
  initialView = 'home',
}: {
  onClose: () => void;
  salonSlug: string | null;
  salonId?: string | null;
  isFreeSolo?: boolean;
  initialView?: TeamView;
}) {
  const [view, setView] = useState<TeamView>(initialView);
  const router = useRouter();
  const params = useParams<{ locale?: string }>();
  const search = useSearchParams();
  const locale = params?.locale === 'fr' ? 'fr' : 'en';
  const hoursHref = useCallback((hoursView: 'working-hours' | 'time-off' | 'requests') => {
    const query = new URLSearchParams(search?.toString());
    if (salonSlug) {
      query.set('salon', salonSlug);
    }
    query.set('app', 'hours');
    query.set('view', hoursView);
    query.delete('technician');
    return `/${locale}/admin?${query.toString()}`;
  }, [locale, salonSlug, search]);
  const openHours = useCallback((hoursView: 'working-hours' | 'time-off' | 'requests') => {
    router.push(hoursHref(hoursView), { scroll: false });
  }, [hoursHref, router]);
  const legacyHoursView = initialView === 'schedules'
    ? 'working-hours'
    : initialView === 'time-off' || initialView === 'blocked-time'
      ? 'time-off'
      : initialView === 'requests'
        ? 'requests'
        : null;

  useEffect(() => {
    if (legacyHoursView) {
      router.replace(hoursHref(legacyHoursView), { scroll: false });
    }
  }, [hoursHref, legacyHoursView, router]);

  if (legacyHoursView) {
    return null;
  }

  if (view === 'home') {
    return (
      <OwnerAppHub
        title="Team"
        subtitle="People, schedules, skills and access"
        items={TEAM_ITEMS}
        onBack={onClose}
        onOpen={(id) => {
          if (id === 'schedules') {
            openHours('working-hours');
          } else if (id === 'time-off') {
            openHours('time-off');
          } else if (id === 'requests') {
            openHours('requests');
          } else {
            setView(id);
          }
        }}
      />
    );
  }

  if (view === 'permissions') {
    return (
      <SettingsModal
        initialView="visibility"
        leafOnly
        leafBackLabel="Team"
        onClose={() => setView('home')}
        salonId={salonId}
        salonSlug={salonSlug}
        isFreeSolo={isFreeSolo}
      />
    );
  }

  if (view === 'members') {
    return <StaffModal onClose={() => setView('home')} salonSlug={salonSlug} title="Team Members" />;
  }

  const initialTab = view === 'services' ? 'services' : 'earnings';
  const title = view === 'services' ? 'Services & Skills' : 'Earnings';
  return <StaffModal onClose={() => setView('home')} salonSlug={salonSlug} initialTab={initialTab} title={title} />;
}
