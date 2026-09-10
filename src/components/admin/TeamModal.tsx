'use client';

import { Banknote, CalendarClock, Clock3, KeyRound, Scissors, Users } from 'lucide-react';
import { useState } from 'react';

import { OwnerAppHub, type OwnerAppHubItem } from './OwnerAppHub';
import { SettingsModal } from './SettingsModal';
import { StaffModal } from './StaffModal';
import { StaffOpsModal } from './StaffOpsModal';

type TeamView = 'home' | 'members' | 'schedules' | 'time-off' | 'requests' | 'blocked-time' | 'services' | 'permissions' | 'earnings';

const TEAM_ITEMS: ReadonlyArray<OwnerAppHubItem<Exclude<TeamView, 'home' | 'blocked-time'>>> = [
  { id: 'members', title: 'Team Members', description: 'People, roles, contact details and employment status', icon: Users },
  { id: 'schedules', title: 'Schedules', description: 'Weekly working days and hours for each team member', icon: CalendarClock },
  { id: 'time-off', title: 'Time Off', description: 'Team requests and owner-created blocked time', icon: Clock3 },
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

  if (view === 'home') {
    return (
      <OwnerAppHub
        title="Team"
        subtitle="People, schedules, skills and access"
        items={TEAM_ITEMS}
        onBack={onClose}
        onOpen={setView}
      />
    );
  }

  if (view === 'time-off') {
    return (
      <OwnerAppHub
        title="Time Off"
        subtitle="Requests stay separate from time you add"
        items={[
          { id: 'requests', title: 'Requests', description: 'Pending, approved and denied team requests', icon: Clock3 },
          { id: 'blocked-time', title: 'Blocked Time', description: 'Add vacation, sick, personal, training or other time', icon: CalendarClock },
        ]}
        onBack={() => setView('home')}
        onOpen={id => setView(id)}
      />
    );
  }

  if (view === 'requests') {
    return <StaffOpsModal onClose={() => setView('time-off')} salonSlug={salonSlug} />;
  }

  if (view === 'blocked-time') {
    return <StaffModal onClose={() => setView('time-off')} salonSlug={salonSlug} initialTab="schedule" title="Blocked Time" />;
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

  const initialTab = view === 'schedules' ? 'schedule' : view === 'services' ? 'services' : 'earnings';
  const title = view === 'schedules' ? 'Schedules' : view === 'services' ? 'Services & Skills' : 'Earnings';
  return <StaffModal onClose={() => setView('home')} salonSlug={salonSlug} initialTab={initialTab} title={title} />;
}
