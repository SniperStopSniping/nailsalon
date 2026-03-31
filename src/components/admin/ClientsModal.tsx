'use client';

import { AnimatePresence, motion } from 'framer-motion';
import {
  AlertCircle,
  Calendar,
  ChevronRight,
  Mail,
  Phone,
  ShieldAlert,
  Star,
  User,
} from 'lucide-react';
import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import { AdminDetailCard } from '@/components/admin/AdminDetailCard';
import { AdminSearchField } from '@/components/admin/AdminSearchField';
import { AsyncStatePanel } from '@/components/ui/async-state-panel';
import { Button } from '@/components/ui/button';
import { ListSurface } from '@/components/ui/list-surface';
import { useSalon } from '@/providers/SalonProvider';

import { BackButton, ModalHeader } from './AppModal';

type ClientSummary = {
  id: string;
  phone: string;
  fullName: string | null;
  email: string | null;
  lastVisitAt: string | null;
  totalVisits: number;
  totalSpent: number;
  noShowCount: number;
  loyaltyPoints: number;
  preferredTechnician: {
    id: string;
    name: string;
    avatarUrl: string | null;
  } | null;
  notes: string | null;
};

type ClientProfile = {
  id: string;
  phone: string;
  fullName: string | null;
  email: string | null;
  preferredTechnician: {
    id: string;
    name: string;
    avatarUrl: string | null;
  } | null;
  notes: string | null;
  lastVisitAt: string | null;
  totalVisits: number;
  totalSpent: number;
  averageSpend: number;
  noShowCount: number;
  loyaltyPoints: number;
  createdAt: string;
};

type ClientAppointment = {
  id: string;
  startTime: string;
  endTime: string;
  status: string;
  totalPrice: number;
  technician: {
    id: string;
    name: string;
    avatarUrl: string | null;
  } | null;
  services: Array<{
    name: string;
    price: number;
  }>;
  notes: string | null;
};

type ClientFlagsState = {
  adminFlags: {
    isProblemClient?: boolean;
    flagReason?: string | null;
  } | null;
  isBlocked: boolean;
  blockedReason: string | null;
  noShowCount: number;
  lateCancelCount: number;
};

type TechnicianOption = {
  id: string;
  name: string;
  avatarUrl: string | null;
};

type ModuleAvailability = {
  loaded: boolean;
  clientFlags: boolean;
  clientBlocking: boolean;
};

type ClientDetailCacheEntry = {
  profile: ClientProfile | null;
  upcomingAppointments: ClientAppointment[];
  pastAppointments: ClientAppointment[];
  recentIssues: ClientAppointment[];
  flagsState: ClientFlagsState | null;
  flagsLoaded: boolean;
};

type ClientsModalProps = {
  onClose: () => void;
};

type SortOption = 'recent' | 'visits' | 'spent' | 'name';

const SORT_OPTIONS: Array<{ value: SortOption; label: string }> = [
  { value: 'recent', label: 'Recent' },
  { value: 'visits', label: 'Visits' },
  { value: 'spent', label: 'Spent' },
  { value: 'name', label: 'A-Z' },
];

const CLIENTS_PAGE_SIZE = 50;

function formatPhone(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  if (digits.length === 10) {
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  }
  if (digits.length === 11 && digits.startsWith('1')) {
    return `(${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`;
  }
  return phone;
}

function formatCurrency(cents: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
  }).format(cents / 100);
}

function formatDate(dateString: string | null, includeWeekday = false): string {
  if (!dateString) {
    return 'Never';
  }

  return new Date(dateString).toLocaleDateString('en-US', {
    weekday: includeWeekday ? 'long' : undefined,
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function formatDateTimeRange(startTime: string, endTime: string): string {
  const start = new Date(startTime);
  const end = new Date(endTime);

  const date = start.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });

  const startDisplay = start.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
  });
  const endDisplay = end.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
  });

  return `${date} · ${startDisplay} - ${endDisplay}`;
}

function getInitials(name: string | null | undefined): string {
  const normalized = (name || 'Unknown').trim();
  const parts = normalized.split(/\s+/).filter(Boolean);
  if (parts.length === 0) {
    return 'UN';
  }
  if (parts.length === 1) {
    return parts[0]!.slice(0, 2).toUpperCase();
  }
  return parts.slice(0, 2).map(part => part[0]).join('').toUpperCase();
}

function getDisplayName(client: Pick<ClientSummary, 'fullName' | 'phone'> | Pick<ClientProfile, 'fullName' | 'phone'>): string {
  return client.fullName?.trim() || formatPhone(client.phone);
}

function groupClientsByLetter(clients: ClientSummary[]): Map<string, ClientSummary[]> {
  const groups = new Map<string, ClientSummary[]>();

  for (const client of clients) {
    const name = getDisplayName(client);
    const letter = name.charAt(0).toUpperCase();
    const existing = groups.get(letter) ?? [];
    existing.push(client);
    groups.set(letter, existing);
  }

  return new Map([...groups.entries()].sort(([a], [b]) => a.localeCompare(b)));
}

function getAppointmentStatusStyles(status: string): string {
  switch (status) {
    case 'confirmed':
      return 'bg-emerald-50 text-emerald-700';
    case 'pending':
      return 'bg-amber-50 text-amber-700';
    case 'completed':
      return 'bg-sky-50 text-sky-700';
    case 'cancelled':
      return 'bg-rose-50 text-rose-700';
    case 'no_show':
      return 'bg-rose-100 text-rose-800';
    default:
      return 'bg-neutral-100 text-neutral-700';
  }
}

function formatAppointmentStatus(status: string): string {
  return status.replace(/_/g, ' ');
}

function SectionHeader({ letter }: { letter: string }) {
  return (
    <div className="sticky top-0 z-10 bg-[#F2F2F7] px-4 py-1">
      <span className="text-[13px] font-semibold text-[#8E8E93]">{letter}</span>
    </div>
  );
}

function EmptyState({ searchQuery }: { searchQuery: string }) {
  return (
    <AsyncStatePanel
      icon={<User className="mx-auto size-8 text-[#8E8E93]" />}
      title={searchQuery ? 'No Results' : 'No Clients Yet'}
      description={searchQuery
        ? `No clients match "${searchQuery}"`
        : 'Clients will appear here after their first booking.'}
      className="mx-4 my-8"
    />
  );
}

function ClientRow({
  client,
  isLast,
  onClick,
}: {
  client: ClientSummary;
  isLast: boolean;
  onClick: () => void;
}) {
  const name = getDisplayName(client);

  return (
    <motion.button
      type="button"
      initial={{ opacity: 0, x: -10 }}
      animate={{ opacity: 1, x: 0 }}
      className="flex min-h-[60px] w-full items-center pl-4 text-left transition-colors active:bg-gray-50"
      onClick={onClick}
    >
      <div className="mr-3 flex size-10 items-center justify-center rounded-full bg-gradient-to-br from-[#4facfe] to-[#00f2fe] text-[13px] font-bold text-white shadow-sm">
        {getInitials(client.fullName)}
      </div>

      <div className={`flex flex-1 items-center justify-between py-3 pr-4 ${!isLast ? 'border-b border-gray-100' : ''}`}>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5 text-[16px] font-medium text-[#1C1C1E]">
            <span className="truncate">{name}</span>
            {client.noShowCount > 0 && (
              <span className="rounded-full bg-red-100 px-1.5 py-0.5 text-[10px] font-medium text-red-600">
                {client.noShowCount}
                {' '}
                no-show
                {client.noShowCount > 1 ? 's' : ''}
              </span>
            )}
          </div>
          <div className="mt-0.5 flex items-center gap-1 text-[13px] text-[#8E8E93]">
            <Phone className="size-3" />
            {formatPhone(client.phone)}
          </div>
        </div>

        <div className="ml-3 flex items-center gap-2">
          <div className="mr-2 text-right">
            <div className="text-[13px] text-[#8E8E93]">
              {client.totalVisits}
              {' '}
              visit
              {client.totalVisits !== 1 ? 's' : ''}
            </div>
            <div className="text-[12px] font-medium text-[#34C759]">
              {formatCurrency(client.totalSpent)}
            </div>
          </div>
          <ChevronRight className="size-4 text-[#C7C7CC]" />
        </div>
      </div>
    </motion.button>
  );
}

function SortPills({
  sortBy,
  onChange,
}: {
  sortBy: SortOption;
  onChange: (value: SortOption) => void;
}) {
  return (
    <div className="-mx-4 overflow-x-auto overflow-y-hidden px-4 pb-1 scrollbar-hide">
      <div className="flex min-w-max gap-2">
        {SORT_OPTIONS.map(option => {
          const active = option.value === sortBy;
          return (
            <button
              key={option.value}
              type="button"
              onClick={() => onChange(option.value)}
              className="rounded-full px-4 py-2 text-[13px] font-semibold transition-all duration-200"
              style={{
                backgroundColor: active ? '#1C1C1E' : 'white',
                color: active ? 'white' : '#525252',
                borderWidth: active ? 0 : '1px',
                borderStyle: 'solid',
                borderColor: active ? 'transparent' : '#E5E7EB',
                boxShadow: active ? '0 6px 18px rgba(0,0,0,0.08)' : '0 2px 8px rgba(0,0,0,0.03)',
              }}
            >
              {option.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function StatCard({
  label,
  value,
  accent,
  icon,
}: {
  label: string;
  value: string;
  accent?: string;
  icon?: ReactNode;
}) {
  return (
    <AdminDetailCard>
      <div className="flex items-center gap-1 text-[12px] font-medium uppercase text-[#8E8E93]">
        {icon}
        {label}
      </div>
      <div className={`mt-1 text-[24px] font-bold ${accent ?? 'text-[#1C1C1E]'}`}>
        {value}
      </div>
    </AdminDetailCard>
  );
}

function AppointmentCard({ appointment }: { appointment: ClientAppointment }) {
  return (
    <div className="rounded-[14px] border border-neutral-100 bg-white p-3 shadow-[0_2px_10px_rgba(0,0,0,0.03)]">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[15px] font-semibold text-[#1C1C1E]">
            {appointment.services.length > 0
              ? appointment.services.map(service => service.name).join(' · ')
              : 'Appointment'}
          </div>
          <div className="mt-1 text-[13px] text-[#6B7280]">
            {formatDateTimeRange(appointment.startTime, appointment.endTime)}
          </div>
          <div className="mt-1 text-[13px] text-[#6B7280]">
            {appointment.technician ? `Artist: ${appointment.technician.name}` : 'Artist: Unassigned'}
          </div>
        </div>
        <div className="shrink-0 text-right">
          <div className="text-[15px] font-semibold text-[#1C1C1E]">
            {formatCurrency(appointment.totalPrice)}
          </div>
          <span className={`mt-1 inline-flex rounded-full px-2 py-1 text-[11px] font-semibold capitalize ${getAppointmentStatusStyles(appointment.status)}`}>
            {formatAppointmentStatus(appointment.status)}
          </span>
        </div>
      </div>
      {appointment.notes && (
        <div className="mt-2 rounded-xl bg-neutral-50 px-3 py-2 text-[12px] text-[#6B7280]">
          {appointment.notes}
        </div>
      )}
    </div>
  );
}

function AppointmentsSection({
  title,
  appointments,
  emptyMessage,
}: {
  title: string;
  appointments: ClientAppointment[];
  emptyMessage: string;
}) {
  return (
    <AdminDetailCard className="mb-4">
      <div className="mb-3 flex items-center gap-2 text-[12px] font-medium uppercase text-[#8E8E93]">
        <Calendar className="size-3.5" />
        {title}
      </div>
      {appointments.length === 0
        ? (
            <div className="rounded-[14px] border border-dashed border-neutral-200 bg-neutral-50 px-4 py-5 text-[14px] text-[#8E8E93]">
              {emptyMessage}
            </div>
          )
        : (
            <div className="space-y-2.5">
              {appointments.map(appointment => (
                <AppointmentCard key={appointment.id} appointment={appointment} />
              ))}
            </div>
          )}
    </AdminDetailCard>
  );
}

function ClientDetail({
  clientSummary,
  salonSlug,
  moduleAvailability,
  technicians,
  techniciansLoading,
  techniciansError,
  initialCachedDetail,
  onCacheUpdate,
  onRefreshTechnicians,
  onBack,
}: {
  clientSummary: ClientSummary;
  salonSlug: string;
  moduleAvailability: ModuleAvailability;
  technicians: TechnicianOption[];
  techniciansLoading: boolean;
  techniciansError: string | null;
  initialCachedDetail: ClientDetailCacheEntry | null;
  onCacheUpdate: (clientId: string, updates: Partial<ClientDetailCacheEntry>) => void;
  onRefreshTechnicians: () => Promise<void> | void;
  onBack: () => void;
}) {
  const [profile, setProfile] = useState<ClientProfile | null>(initialCachedDetail?.profile ?? null);
  const [upcomingAppointments, setUpcomingAppointments] = useState<ClientAppointment[]>(initialCachedDetail?.upcomingAppointments ?? []);
  const [pastAppointments, setPastAppointments] = useState<ClientAppointment[]>(initialCachedDetail?.pastAppointments ?? []);
  const [recentIssues, setRecentIssues] = useState<ClientAppointment[]>(initialCachedDetail?.recentIssues ?? []);
  const [detailLoading, setDetailLoading] = useState(initialCachedDetail?.profile ? false : true);
  const [detailError, setDetailError] = useState<string | null>(null);

  const [flagsState, setFlagsState] = useState<ClientFlagsState | null>(initialCachedDetail?.flagsState ?? null);
  const [flagsError, setFlagsError] = useState<string | null>(null);
  const [flagsLoading, setFlagsLoading] = useState(
    moduleAvailability.clientFlags || moduleAvailability.clientBlocking
      ? !(initialCachedDetail?.flagsLoaded ?? false)
      : false,
  );

  const [notesDraft, setNotesDraft] = useState(initialCachedDetail?.profile?.notes ?? clientSummary.notes ?? '');
  const [preferredTechnicianIdDraft, setPreferredTechnicianIdDraft] = useState(initialCachedDetail?.profile?.preferredTechnician?.id ?? clientSummary.preferredTechnician?.id ?? '');
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileSaveError, setProfileSaveError] = useState<string | null>(null);

  const [problemClientDraft, setProblemClientDraft] = useState(Boolean(initialCachedDetail?.flagsState?.adminFlags?.isProblemClient));
  const [problemClientReasonDraft, setProblemClientReasonDraft] = useState(initialCachedDetail?.flagsState?.adminFlags?.flagReason ?? '');
  const [blockedDraft, setBlockedDraft] = useState(Boolean(initialCachedDetail?.flagsState?.isBlocked));
  const [blockedReasonDraft, setBlockedReasonDraft] = useState(initialCachedDetail?.flagsState?.blockedReason ?? '');
  const [flagsSaving, setFlagsSaving] = useState(false);
  const [flagsSaveError, setFlagsSaveError] = useState<string | null>(null);

  const canManageFlags = moduleAvailability.clientFlags || moduleAvailability.clientBlocking;
  const statsSource = profile ?? clientSummary;

  const applyDetailPayload = useCallback((payload: {
    client: ClientProfile;
    upcomingAppointments: ClientAppointment[];
    pastAppointments: ClientAppointment[];
    recentIssues?: ClientAppointment[];
  }) => {
    const nextUpcoming = payload.upcomingAppointments ?? [];
    const nextPast = payload.pastAppointments ?? [];
    const nextIssues = payload.recentIssues ?? [];

    setProfile(payload.client);
    setUpcomingAppointments(nextUpcoming);
    setPastAppointments(nextPast);
    setRecentIssues(nextIssues);
    setNotesDraft(payload.client.notes ?? '');
    setPreferredTechnicianIdDraft(payload.client.preferredTechnician?.id ?? '');

    onCacheUpdate(clientSummary.id, {
      profile: payload.client,
      upcomingAppointments: nextUpcoming,
      pastAppointments: nextPast,
      recentIssues: nextIssues,
    });
  }, [clientSummary.id, onCacheUpdate]);

  const fetchClientDetail = useCallback(async (force = false) => {
    if (!force && (initialCachedDetail?.profile || profile)) {
      return;
    }

    try {
      if (!profile) {
        setDetailLoading(true);
      }
      setDetailError(null);
      const response = await fetch(`/api/admin/clients/${clientSummary.id}?salonSlug=${encodeURIComponent(salonSlug)}`);
      if (!response.ok) {
        throw new Error('Failed to fetch client profile');
      }
      const result = await response.json();
      applyDetailPayload(result.data);
    } catch (error) {
      console.error('Failed to fetch client profile:', error);
      if (!profile) {
        setDetailError('Failed to load client profile');
      }
    } finally {
      setDetailLoading(false);
    }
  }, [applyDetailPayload, clientSummary.id, initialCachedDetail?.profile, profile, salonSlug]);

  const fetchFlags = useCallback(async (force = false) => {
    if (!canManageFlags) {
      setFlagsState(null);
      setFlagsLoading(false);
      return;
    }

    if (!force && (initialCachedDetail?.flagsLoaded || flagsState)) {
      return;
    }

    try {
      if (!flagsState) {
        setFlagsLoading(true);
      }
      setFlagsError(null);
      const response = await fetch(`/api/admin/clients/${clientSummary.id}/flag?salonSlug=${encodeURIComponent(salonSlug)}`);
      if (!response.ok) {
        throw new Error('Failed to fetch client status');
      }
      const result = await response.json();
      const client = result.data?.client;
      const nextState: ClientFlagsState = {
        adminFlags: client?.adminFlags ?? null,
        isBlocked: Boolean(client?.isBlocked),
        blockedReason: client?.blockedReason ?? null,
        noShowCount: client?.noShowCount ?? 0,
        lateCancelCount: client?.lateCancelCount ?? 0,
      };
      setFlagsState(nextState);
      setProblemClientDraft(Boolean(nextState.adminFlags?.isProblemClient));
      setProblemClientReasonDraft(nextState.adminFlags?.flagReason ?? '');
      setBlockedDraft(Boolean(nextState.isBlocked));
      setBlockedReasonDraft(nextState.blockedReason ?? '');
      onCacheUpdate(clientSummary.id, {
        flagsState: nextState,
        flagsLoaded: true,
      });
    } catch (error) {
      console.error('Failed to fetch client flags:', error);
      if (!flagsState) {
        setFlagsError('Could not load client status');
      }
    } finally {
      setFlagsLoading(false);
    }
  }, [
    canManageFlags,
    clientSummary.id,
    flagsState,
    initialCachedDetail?.flagsLoaded,
    onCacheUpdate,
    salonSlug,
  ]);

  useEffect(() => {
    fetchClientDetail();
    fetchFlags();
  }, [fetchClientDetail, fetchFlags]);

  const profileDirty
    = notesDraft !== (profile?.notes ?? '')
      || preferredTechnicianIdDraft !== (profile?.preferredTechnician?.id ?? '');

  const flagsDirty = useMemo(() => {
    if (!flagsState) {
      return false;
    }

    const problemChanged = moduleAvailability.clientFlags
      && (
        problemClientDraft !== Boolean(flagsState.adminFlags?.isProblemClient)
        || problemClientReasonDraft !== (flagsState.adminFlags?.flagReason ?? '')
      );
    const blockedChanged = moduleAvailability.clientBlocking
      && (
        blockedDraft !== Boolean(flagsState.isBlocked)
        || blockedReasonDraft !== (flagsState.blockedReason ?? '')
      );

    return problemChanged || blockedChanged;
  }, [
    blockedDraft,
    blockedReasonDraft,
    flagsState,
    moduleAvailability.clientBlocking,
    moduleAvailability.clientFlags,
    problemClientDraft,
    problemClientReasonDraft,
  ]);

  const saveProfile = async () => {
    if (!profileDirty) {
      return;
    }

    try {
      setProfileSaving(true);
      setProfileSaveError(null);
      const response = await fetch(`/api/admin/clients/${clientSummary.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          salonSlug,
          notes: notesDraft.trim() || null,
          preferredTechnicianId: preferredTechnicianIdDraft || null,
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to save client profile');
      }

      await fetchClientDetail(true);
    } catch (error) {
      console.error('Failed to save client profile:', error);
      setProfileSaveError('Could not save client details');
    } finally {
      setProfileSaving(false);
    }
  };

  const saveFlags = async () => {
    if (!flagsDirty) {
      return;
    }

    try {
      setFlagsSaving(true);
      setFlagsSaveError(null);
      const body: Record<string, unknown> = {
        salonSlug,
      };

      if (moduleAvailability.clientFlags) {
        body.isProblemClient = problemClientDraft;
        body.flagReason = problemClientReasonDraft.trim();
      }

      if (moduleAvailability.clientBlocking) {
        body.isBlocked = blockedDraft;
        body.blockedReason = blockedReasonDraft.trim();
      }

      const response = await fetch(`/api/admin/clients/${clientSummary.id}/flag`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        throw new Error('Failed to save client status');
      }

      await fetchFlags(true);
    } catch (error) {
      console.error('Failed to save client status:', error);
      setFlagsSaveError('Could not save client status');
    } finally {
      setFlagsSaving(false);
    }
  };

  const detailName = getDisplayName(profile ?? clientSummary);

  return (
    <motion.div
      initial={{ x: '100%' }}
      animate={{ x: 0 }}
      exit={{ x: '100%' }}
      transition={{ type: 'spring', stiffness: 300, damping: 30 }}
      className="fixed inset-0 top-12 z-50 overflow-y-auto rounded-t-[20px] bg-[#F2F2F7]"
    >
      <ModalHeader
        title={detailName}
        leftAction={<BackButton onClick={onBack} label="Clients" />}
      />

      <div className="p-4 pb-10">
        <AdminDetailCard className="mb-4 rounded-[22px]">
          <div className="flex flex-col items-center text-center">
            <div className="mb-3 flex size-20 items-center justify-center rounded-full bg-gradient-to-br from-[#4facfe] to-[#00f2fe] text-2xl font-bold text-white shadow-lg">
              {getInitials(statsSource.fullName)}
            </div>
            <h2 className="text-[22px] font-semibold text-[#1C1C1E]">{detailName}</h2>
            <div className="mt-1 flex items-center gap-1 text-[15px] text-[#8E8E93]">
              <Phone className="size-3.5" />
              {formatPhone(statsSource.phone)}
            </div>
            {(profile?.email ?? clientSummary.email) && (
              <div className="mt-0.5 flex items-center gap-1 text-[15px] text-[#8E8E93]">
                <Mail className="size-3.5" />
                {profile?.email ?? clientSummary.email}
              </div>
            )}
            <div className="mt-3 text-[13px] text-[#8E8E93]">
              {profile?.createdAt
                ? (
                    <>
                      Client since
                      {' '}
                      {formatDate(profile.createdAt)}
                      {profile.lastVisitAt ? ` · Last visit ${formatDate(profile.lastVisitAt)}` : ''}
                    </>
                  )
                : (
                    <>
                      {clientSummary.lastVisitAt ? `Last visit ${formatDate(clientSummary.lastVisitAt)}` : 'Loading client history...'}
                    </>
                  )}
            </div>
            <div className="mt-4 flex flex-wrap justify-center gap-2">
              <Button asChild type="button" variant="brandSoft" size="pillSm">
                <a href={`tel:${statsSource.phone}`}>Call</a>
              </Button>
              <Button asChild type="button" variant="brandSoft" size="pillSm">
                <a href={`sms:${statsSource.phone}`}>Text</a>
              </Button>
            </div>
          </div>
        </AdminDetailCard>

        <div className="mb-4 grid grid-cols-2 gap-3">
          <StatCard label="Total Visits" value={String(statsSource.totalVisits)} />
          <StatCard label="Total Spent" value={formatCurrency(statsSource.totalSpent)} accent="text-[#34C759]" />
          <StatCard label="Rewards" value={statsSource.loyaltyPoints.toLocaleString()} accent="text-[#FF9500]" icon={<Star className="size-3" />} />
          <StatCard label="No-Shows" value={String(statsSource.noShowCount)} accent={statsSource.noShowCount > 0 ? 'text-[#FF3B30]' : undefined} icon={<AlertCircle className="size-3" />} />
        </div>

        {detailLoading && !profile
          ? (
              <AsyncStatePanel
                loading
                title="Loading client details"
                description="Fetching notes, preferred artist, and appointment history."
                className="mb-4"
              />
            )
          : detailError && !profile
            ? (
                <AsyncStatePanel
                  tone="error"
                  title="Unable to load client"
                  description={detailError}
                  className="mb-4"
                  action={(
                    <Button type="button" variant="brandSoft" size="pillSm" onClick={() => fetchClientDetail(true)}>
                      Try again
                    </Button>
                  )}
                />
              )
            : (
                <>
                  <AdminDetailCard className="mb-4">
                    <div className="mb-3 flex items-center justify-between gap-3">
                      <div>
                        <div className="text-[12px] font-medium uppercase text-[#8E8E93]">Client details</div>
                        <div className="mt-1 text-[15px] font-semibold text-[#1C1C1E]">
                          Avg spend
                          {' '}
                          {profile ? formatCurrency(profile.averageSpend) : '...'}
                        </div>
                      </div>
                      <div className="rounded-full bg-[#F2F2F7] px-3 py-1 text-[12px] font-medium text-[#6B7280]">
                        {techniciansLoading ? 'Loading artists...' : techniciansError ?? `${technicians.length} artists`}
                      </div>
                    </div>

                    <label className="mb-3 block">
                      <span className="mb-1.5 block text-[12px] font-medium uppercase text-[#8E8E93]">Preferred artist</span>
                      <select
                        aria-label="Preferred artist"
                        value={preferredTechnicianIdDraft}
                        onChange={event => setPreferredTechnicianIdDraft(event.target.value)}
                        className="w-full rounded-xl border border-[#E5E7EB] bg-white px-3 py-2.5 text-[15px] text-[#1C1C1E] focus:outline-none focus:ring-2 focus:ring-[#007AFF]/30"
                        disabled={techniciansLoading}
                      >
                        <option value="">No preference</option>
                        {technicians.map(technician => (
                          <option key={technician.id} value={technician.id}>
                            {technician.name}
                          </option>
                        ))}
                      </select>
                      {techniciansError && (
                        <div className="mt-2 text-[13px] text-[#FF3B30]">
                          {techniciansError}
                          {' '}
                          <button type="button" className="font-semibold text-[#007AFF]" onClick={() => void onRefreshTechnicians()}>
                            Retry
                          </button>
                        </div>
                      )}
                    </label>

                    <label className="block">
                      <span className="mb-1.5 block text-[12px] font-medium uppercase text-[#8E8E93]">Private notes</span>
                      <textarea
                        aria-label="Private notes"
                        value={notesDraft}
                        onChange={event => setNotesDraft(event.target.value)}
                        rows={4}
                        placeholder="Add private client notes..."
                        className="w-full rounded-xl border border-[#E5E7EB] bg-white px-3 py-2.5 text-[15px] text-[#1C1C1E] placeholder-[#8E8E93] focus:outline-none focus:ring-2 focus:ring-[#007AFF]/30"
                      />
                    </label>

                    {profileSaveError && (
                      <div className="mt-3 text-[13px] text-[#FF3B30]">{profileSaveError}</div>
                    )}

                    <div className="mt-4 flex flex-wrap justify-end gap-2">
                      <Button
                        type="button"
                        variant="brandSoft"
                        size="pillSm"
                        disabled={!profileDirty || profileSaving}
                        onClick={() => {
                          setNotesDraft(profile?.notes ?? '');
                          setPreferredTechnicianIdDraft(profile?.preferredTechnician?.id ?? '');
                          setProfileSaveError(null);
                        }}
                      >
                        Cancel
                      </Button>
                      <Button
                        type="button"
                        variant="brand"
                        size="pillSm"
                        disabled={!profileDirty || profileSaving}
                        onClick={saveProfile}
                      >
                        {profileSaving ? 'Saving...' : 'Save details'}
                      </Button>
                    </div>
                  </AdminDetailCard>

                  {canManageFlags && (
                    <AdminDetailCard className="mb-4">
                      <div className="mb-3 flex items-center gap-2 text-[12px] font-medium uppercase text-[#8E8E93]">
                        <ShieldAlert className="size-3.5" />
                        Client status
                      </div>

                      {flagsLoading && !flagsState
                        ? (
                            <AsyncStatePanel
                              loading
                              title="Loading client status"
                              description="Checking flag and booking controls."
                            />
                          )
                        : flagsError && !flagsState
                          ? (
                              <AsyncStatePanel
                                tone="error"
                                title="Unable to load client status"
                                description={flagsError}
                                action={(
                                  <Button type="button" variant="brandSoft" size="pillSm" onClick={() => fetchFlags(true)}>
                                    Try again
                                  </Button>
                                )}
                              />
                            )
                          : (
                              <>
                                <div className="mb-3 rounded-xl bg-[#F8FAFC] px-3 py-2 text-[13px] text-[#6B7280]">
                                  No-shows:
                                  {' '}
                                  <span className="font-semibold text-[#1C1C1E]">{flagsState?.noShowCount ?? statsSource.noShowCount}</span>
                                  {' '}
                                  · Late cancels:
                                  {' '}
                                  <span className="font-semibold text-[#1C1C1E]">{flagsState?.lateCancelCount ?? 0}</span>
                                </div>

                                {moduleAvailability.clientFlags && (
                                  <div className="mb-4 rounded-[14px] border border-neutral-100 bg-neutral-50 p-3">
                                    <label className="flex items-center justify-between gap-3">
                                      <div>
                                        <div className="text-[15px] font-semibold text-[#1C1C1E]">Problem client flag</div>
                                        <div className="text-[13px] text-[#6B7280]">Marks the client for internal visibility.</div>
                                      </div>
                                      <input
                                        aria-label="Problem client flag"
                                        type="checkbox"
                                        checked={problemClientDraft}
                                        onChange={event => setProblemClientDraft(event.target.checked)}
                                        className="size-5 accent-[#FF9500]"
                                      />
                                    </label>
                                    {(problemClientDraft || problemClientReasonDraft) && (
                                      <textarea
                                        aria-label="Problem client reason"
                                        value={problemClientReasonDraft}
                                        onChange={event => setProblemClientReasonDraft(event.target.value)}
                                        rows={3}
                                        placeholder="Why is this client flagged?"
                                        className="mt-3 w-full rounded-xl border border-[#E5E7EB] bg-white px-3 py-2.5 text-[14px] text-[#1C1C1E] placeholder-[#8E8E93] focus:outline-none focus:ring-2 focus:ring-[#007AFF]/30"
                                      />
                                    )}
                                  </div>
                                )}

                                {moduleAvailability.clientBlocking && (
                                  <div className="rounded-[14px] border border-neutral-100 bg-neutral-50 p-3">
                                    <label className="flex items-center justify-between gap-3">
                                      <div>
                                        <div className="text-[15px] font-semibold text-[#1C1C1E]">Block future booking</div>
                                        <div className="text-[13px] text-[#6B7280]">Prevents the client from booking online.</div>
                                      </div>
                                      <input
                                        aria-label="Block future booking"
                                        type="checkbox"
                                        checked={blockedDraft}
                                        onChange={event => setBlockedDraft(event.target.checked)}
                                        className="size-5 accent-[#FF3B30]"
                                      />
                                    </label>
                                    {(blockedDraft || blockedReasonDraft) && (
                                      <textarea
                                        aria-label="Blocked booking reason"
                                        value={blockedReasonDraft}
                                        onChange={event => setBlockedReasonDraft(event.target.value)}
                                        rows={3}
                                        placeholder="Why is this client blocked?"
                                        className="mt-3 w-full rounded-xl border border-[#E5E7EB] bg-white px-3 py-2.5 text-[14px] text-[#1C1C1E] placeholder-[#8E8E93] focus:outline-none focus:ring-2 focus:ring-[#007AFF]/30"
                                      />
                                    )}
                                  </div>
                                )}

                                {flagsSaveError && (
                                  <div className="mt-3 text-[13px] text-[#FF3B30]">{flagsSaveError}</div>
                                )}

                                <div className="mt-4 flex justify-end">
                                  <Button
                                    type="button"
                                    variant="brand"
                                    size="pillSm"
                                    disabled={!flagsDirty || flagsSaving}
                                    onClick={saveFlags}
                                  >
                                    {flagsSaving ? 'Saving...' : 'Save status'}
                                  </Button>
                                </div>
                              </>
                            )}
                    </AdminDetailCard>
                  )}

                  <AppointmentsSection
                    title="Upcoming appointments"
                    appointments={upcomingAppointments}
                    emptyMessage="No upcoming appointments booked."
                  />

                  <AppointmentsSection
                    title="Completed appointments"
                    appointments={pastAppointments}
                    emptyMessage="No completed appointments yet."
                  />

                  {recentIssues.length > 0 && (
                    <AppointmentsSection
                      title="Recent issues"
                      appointments={recentIssues}
                      emptyMessage=""
                    />
                  )}
                </>
              )}
      </div>
    </motion.div>
  );
}

export function ClientsModal({ onClose }: ClientsModalProps) {
  const { salonSlug } = useSalon();
  const [clients, setClients] = useState<ClientSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState<SortOption>('recent');
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [totalClients, setTotalClients] = useState(0);
  const [selectedClient, setSelectedClient] = useState<ClientSummary | null>(null);

  const [moduleAvailability, setModuleAvailability] = useState<ModuleAvailability>({
    loaded: false,
    clientFlags: false,
    clientBlocking: false,
  });

  const [technicians, setTechnicians] = useState<TechnicianOption[]>([]);
  const [techniciansLoading, setTechniciansLoading] = useState(false);
  const [techniciansError, setTechniciansError] = useState<string | null>(null);

  const clientDetailCacheRef = useRef<Record<string, ClientDetailCacheEntry>>({});
  const lastFetchedPageRef = useRef(1);

  const fetchClients = useCallback(async (targetPage: number, resetPage = false) => {
    if (!salonSlug) {
      return;
    }

    try {
      setLoading(true);
      setError(null);

      const params = new URLSearchParams({
        salonSlug,
        sortBy,
        sortOrder: sortBy === 'name' ? 'asc' : 'desc',
        page: String(targetPage),
        limit: String(CLIENTS_PAGE_SIZE),
      });
      if (debouncedSearchQuery) {
        params.set('search', debouncedSearchQuery);
      }

      const response = await fetch(`/api/admin/clients?${params}`);
      if (!response.ok) {
        throw new Error('Failed to fetch clients');
      }

      const result = await response.json();
      const fetchedClients = result.data?.clients ?? [];
      const pagination = result.data?.pagination ?? {};

      if (resetPage) {
        setClients(fetchedClients);
      } else {
        setClients(prev => [...prev, ...fetchedClients]);
      }

      setTotalClients(pagination.total ?? fetchedClients.length);
      setHasMore(targetPage < (pagination.totalPages ?? 1));
    } catch (fetchError) {
      console.error('Failed to fetch clients:', fetchError);
      setError('Failed to load clients');
    } finally {
      setLoading(false);
    }
  }, [debouncedSearchQuery, salonSlug, sortBy]);

  const fetchModuleAvailability = useCallback(async () => {
    if (!salonSlug) {
      return;
    }

    try {
      const response = await fetch(`/api/admin/settings/modules?salonSlug=${encodeURIComponent(salonSlug)}`);
      if (!response.ok) {
        throw new Error('Failed to fetch module availability');
      }
      const result = await response.json();
      const moduleReasons = result.data?.moduleReasons ?? {};
      setModuleAvailability({
        loaded: true,
        clientFlags: moduleReasons.clientFlags === 'ENABLED',
        clientBlocking: moduleReasons.clientBlocking === 'ENABLED',
      });
    } catch (moduleError) {
      console.error('Failed to fetch client module availability:', moduleError);
      setModuleAvailability({
        loaded: true,
        clientFlags: false,
        clientBlocking: false,
      });
    }
  }, [salonSlug]);

  const fetchTechnicians = useCallback(async () => {
    if (!salonSlug) {
      return;
    }

    try {
      setTechniciansLoading(true);
      setTechniciansError(null);
      const response = await fetch(`/api/admin/technicians?salonSlug=${encodeURIComponent(salonSlug)}&limit=100`);
      if (!response.ok) {
        throw new Error('Failed to fetch technicians');
      }
      const result = await response.json();
      setTechnicians((result.data?.technicians ?? []).filter((technician: { id: string; name: string; avatarUrl: string | null; isActive?: boolean }) => technician.isActive !== false));
    } catch (technicianError) {
      console.error('Failed to fetch technicians:', technicianError);
      setTechniciansError('Could not load technician choices');
    } finally {
      setTechniciansLoading(false);
    }
  }, [salonSlug]);

  const updateClientDetailCache = useCallback((clientId: string, updates: Partial<ClientDetailCacheEntry>) => {
    const existing = clientDetailCacheRef.current[clientId] ?? {
      profile: null,
      upcomingAppointments: [],
      pastAppointments: [],
      recentIssues: [],
      flagsState: null,
      flagsLoaded: false,
    };

    clientDetailCacheRef.current[clientId] = {
      ...existing,
      ...updates,
    };
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedSearchQuery(searchQuery.trim());
    }, 300);

    return () => window.clearTimeout(timer);
  }, [searchQuery]);

  useEffect(() => {
    fetchModuleAvailability();
    fetchTechnicians();
  }, [fetchModuleAvailability, fetchTechnicians]);

  useEffect(() => {
    if (!salonSlug || page === 1 || page === lastFetchedPageRef.current) {
      return;
    }
    lastFetchedPageRef.current = page;
    fetchClients(page, false);
  }, [fetchClients, page, salonSlug]);

  useEffect(() => {
    if (!salonSlug) {
      return;
    }
    lastFetchedPageRef.current = 1;
    setPage(1);
    fetchClients(1, true);
  }, [debouncedSearchQuery, fetchClients, salonSlug, sortBy]);

  const groupedClients = useMemo(() => (
    sortBy === 'name' ? groupClientsByLetter(clients) : null
  ), [clients, sortBy]);

  const loadMore = () => {
    if (!hasMore || loading) {
      return;
    }
    setPage(prev => prev + 1);
  };

  return (
    <div className="relative flex min-h-full w-full flex-col bg-[#F2F2F7] font-sans text-black">
      <div className="sticky top-0 z-20 bg-[#F2F2F7]/80 backdrop-blur-md">
        <ModalHeader
          title="Clients"
          subtitle={`${totalClients} total`}
          leftAction={<BackButton onClick={onClose} label="Back" />}
        />
        <div className="space-y-3 px-4 pb-3">
          <AdminSearchField
            value={searchQuery}
            onChange={setSearchQuery}
            placeholder="Search clients"
            inputClassName="rounded-[10px] bg-[#767680]/12 py-2 text-[16px] shadow-none focus:ring-1 focus:ring-[#007AFF]/30"
          />
          <SortPills sortBy={sortBy} onChange={setSortBy} />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto pb-10">
        {loading && clients.length === 0
          ? (
              <div className="px-4 py-4">
                <AsyncStatePanel
                  loading
                  title="Loading clients"
                  description="Fetching the latest client list and spend history."
                />
              </div>
            )
          : error
            ? (
                <AsyncStatePanel
                  tone="error"
                  title="Unable to load clients"
                  description={error}
                  className="mx-4 my-8"
                  action={(
                    <Button type="button" variant="brandSoft" size="pillSm" onClick={() => fetchClients(1, true)}>
                      Try again
                    </Button>
                  )}
                />
              )
            : clients.length === 0
              ? (
                  <EmptyState searchQuery={searchQuery} />
                )
              : (
                  <>
                    {groupedClients
                      ? (
                          Array.from(groupedClients.entries()).map(([letter, letterClients]) => (
                            <div key={letter}>
                              <SectionHeader letter={letter} />
                              <ListSurface className="mx-4 mb-2 rounded-[10px]">
                                {letterClients.map((client, index) => (
                                  <ClientRow
                                    key={client.id}
                                    client={client}
                                    isLast={index === letterClients.length - 1}
                                    onClick={() => setSelectedClient(client)}
                                  />
                                ))}
                              </ListSurface>
                            </div>
                          ))
                        )
                      : (
                          <ListSurface className="mx-4 rounded-[10px]">
                            {clients.map((client, index) => (
                              <ClientRow
                                key={client.id}
                                client={client}
                                isLast={index === clients.length - 1}
                                onClick={() => setSelectedClient(client)}
                              />
                            ))}
                          </ListSurface>
                        )}

                    {hasMore && (
                      <div className="px-4 pt-3">
                        <Button
                          type="button"
                          variant="brandSoft"
                          size="pillSm"
                          onClick={loadMore}
                          disabled={loading}
                          className="w-full"
                        >
                          {loading ? 'Loading...' : 'Load More Clients'}
                        </Button>
                      </div>
                    )}
                  </>
                )}
      </div>

      <AnimatePresence>
        {selectedClient && (
          <ClientDetail
            key={selectedClient.id}
            clientSummary={selectedClient}
            salonSlug={salonSlug}
            moduleAvailability={moduleAvailability}
            technicians={technicians}
            techniciansLoading={techniciansLoading}
            techniciansError={techniciansError}
            initialCachedDetail={clientDetailCacheRef.current[selectedClient.id] ?? null}
            onCacheUpdate={updateClientDetailCache}
            onRefreshTechnicians={fetchTechnicians}
            onBack={() => setSelectedClient(null)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
