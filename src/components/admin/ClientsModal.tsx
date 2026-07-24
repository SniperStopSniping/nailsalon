'use client';

import { AnimatePresence, motion } from 'framer-motion';
import {
  Calendar,
  ChevronRight,
  Mail,
  Phone,
  ShieldAlert,
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
import { ClientCommunicationActions } from '@/components/admin/ClientCommunicationActions';
import { ClientInsightsPanel } from '@/components/admin/ClientHubPanel';
import {
  type ClientProfileControlProfile,
  ClientProfileControls,
} from '@/components/admin/ClientProfileControls';
import { AppointmentQuickEditSheet } from '@/components/appointments/AppointmentQuickEditSheet';
import { CheckoutSheet } from '@/components/appointments/CheckoutSheet';
import { AsyncStatePanel } from '@/components/ui/async-state-panel';
import { Button } from '@/components/ui/button';
import { ListSurface } from '@/components/ui/list-surface';
import { type CancelArgs, type RebookPrefill, useAppointmentActions } from '@/hooks/useAppointmentActions';
import { formatMoney } from '@/libs/formatMoney';
import { useSalon } from '@/providers/SalonProvider';
import {
  CLIENT_INSIGHT_SEGMENT_LABELS,
  type ClientInsightAttentionItem,
  type ClientInsightSegmentId,
} from '@/types/clientInsights';
import type { RetentionStage } from '@/types/retention';

import { BackButton, ModalHeader } from './AppModal';
import { NewAppointmentModal } from './NewAppointmentModal';

type ClientSummary = {
  id: string;
  phone: string;
  fullName: string | null;
  email: string | null;
  birthday?: string | null;
  archivedAt?: string | null;
  mergedIntoClientId?: string | null;
  updatedAt?: string;
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
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  birthday: string | null;
  preferredTechnician: {
    id: string;
    name: string;
    avatarUrl: string | null;
  } | null;
  notes: string | null;
  sensitivities: string | null;
  nailPreferences: {
    shape?: string;
    length?: string;
    favoriteColors?: string;
    productsUsed?: string;
  };
  tags: string[];
  rebookIntervalDays: number | null;
  nextRebookDueAt: string | null;
  lastContactAt: string | null;
  lastVisitAt: string | null;
  totalVisits: number;
  totalSpent: number;
  averageSpend: number;
  noShowCount: number;
  loyaltyPoints: number;
  hasGoogleReview: boolean;
  googleReviewMarkedAt: string | null;
  archivedAt: string | null;
  mergedIntoClientId: string | null;
  updatedAt: string;
  createdAt: string;
};

type ClientManagement = {
  resolvedFromClientId: string | null;
  canManageLifecycle: boolean;
  canPermanentlyDelete: boolean;
  authenticationIdentityDeferred: boolean;
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
  location: {
    id: string;
    name: string;
    address: string | null;
    city: string | null;
    state: string | null;
    zipCode: string | null;
  } | null;
  services: Array<{
    id: string;
    name: string;
    price: number;
  }>;
  addOns?: Array<{
    id: string;
    name: string;
    quantity: number;
    lineTotalCents: number;
  }>;
  finalItems?: Array<{
    id: string;
    kind: string;
    name: string;
    quantity: number;
    lineTotalCents: number;
  }>;
  financial?: {
    completedValueCents: number | null;
    source: 'excluded' | 'finalized' | 'legacy' | 'unresolved';
    discountCents: number;
    taxCents: number;
    tipsCents: number;
    paymentsReceivedCents: number;
    payments: Array<{
      id: string;
      amountCents: number;
      method: string | null;
      recordedAt: string;
    }>;
    paymentStatus: string | null;
    completedOutstandingCents: number | null;
    balanceState: string;
  };
  notes: string | null;
};

type FinancialProvenance = {
  mode: 'empty' | 'finalized' | 'legacy' | 'mixed';
  unresolvedAppointmentCount: number;
  isEstimated: boolean;
};

type ClientProfileSummary = {
  currency: string;
  timeZone: string;
  lifetimeSpendCents: number;
  spendThisMonthCents: number;
  completedOutstandingCents: number;
  completedVisits: number;
  mostBookedService: {
    id: string;
    name: string;
    count: number;
  } | null;
  rebooking: {
    status: 'booked' | 'new_client' | 'not_set' | 'overdue' | 'due_later';
    dueAt: string | null;
  };
  provenance: {
    lifetimeSpend: FinancialProvenance;
    spendThisMonth: FinancialProvenance;
    completedOutstanding: FinancialProvenance;
  };
};

type SubmittedPreferences = {
  favoriteTechnician: {
    id: string;
    name: string;
    avatarUrl: string | null;
  } | null;
  favoriteServices: string[] | null;
  nailShape: string | null;
  nailLength: string | null;
  finishes: string[] | null;
  colorFamilies: string[] | null;
  preferredBrands: string[] | null;
  sensitivities: string[] | null;
  musicPreference: string | null;
  conversationLevel: string | null;
  beveragePreference: string[] | null;
  techNotes: string | null;
  appointmentNotes: string | null;
  updatedAt: string;
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
  management: ClientManagement | null;
  summary: ClientProfileSummary | null;
  submittedPreferences: SubmittedPreferences | null;
  upcomingAppointments: ClientAppointment[];
  pastAppointments: ClientAppointment[];
  recentIssues: ClientAppointment[];
  photos: ClientPhoto[];
  notesHistory: ClientNoteHistory[];
  flagsState: ClientFlagsState | null;
  flagsLoaded: boolean;
};

type ClientPhoto = {
  id: string;
  imageUrl: string;
  thumbnailUrl: string | null;
  photoType: string;
  caption: string | null;
  createdAt: string;
};

type ClientNoteHistory = {
  id: string;
  body: string;
  sourceClientId: string | null;
  createdAt: string;
};

type ClientsModalProps = {
  onClose: () => void;
  initialClientId?: string | null;
  onOpenPromotionSettings?: (
    stage: PromotionSettingsStage,
    clientId: string,
  ) => void;
};

type PromotionSettingsStage = Extract<
  RetentionStage,
  'promo_6w' | 'promo_8w'
>;

type SortOption = 'recent' | 'visits' | 'spent' | 'name';
type ClientDirectoryScope = 'active' | 'archived';
type DirectoryStateSnapshot = {
  clients: ClientSummary[];
  searchQuery: string;
  debouncedSearchQuery: string;
  sortBy: SortOption;
  directoryScope: ClientDirectoryScope;
  page: number;
  hasMore: boolean;
  totalClients: number;
  scrollTop: number;
};
type ProfileSection =
  | 'overview'
  | 'activity'
  | 'appointments'
  | 'preferences'
  | 'payments'
  | 'notes'
  | 'details';

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

function formatCurrency(cents: number, currency = 'CAD'): string {
  return formatMoney(cents, currency);
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
    <div className="scrollbar-hide -mx-4 overflow-x-auto overflow-y-hidden px-4 pb-1">
      <div className="flex min-w-max gap-2">
        {SORT_OPTIONS.map((option) => {
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

function HistoryQualityBadge({ provenance }: { provenance?: FinancialProvenance | null }) {
  if (!provenance || (!provenance.isEstimated && provenance.unresolvedAppointmentCount === 0)) {
    return null;
  }
  const incomplete = provenance.unresolvedAppointmentCount > 0;
  return (
    <span
      className={`mt-2 inline-flex rounded-full px-2 py-1 text-[10px] font-semibold ${
        incomplete ? 'bg-amber-100 text-amber-900' : 'bg-stone-100 text-stone-700'
      }`}
      title={incomplete
        ? 'Some historical appointments could not be included because their financial details are unavailable.'
        : 'Some historical appointments use their original booked value.'}
    >
      {incomplete ? 'Incomplete history' : 'Estimated history'}
    </span>
  );
}

function ProfileNavigation({
  activeSection,
  onChange,
}: {
  activeSection: ProfileSection;
  onChange: (section: ProfileSection) => void;
}) {
  const desktopSections: Array<{ id: ProfileSection; label: string }> = [
    { id: 'overview', label: 'Overview' },
    { id: 'activity', label: 'Activity' },
    { id: 'appointments', label: 'Appointments' },
    { id: 'preferences', label: 'Preferences' },
    { id: 'payments', label: 'Payments' },
    { id: 'notes', label: 'Notes & Photos' },
  ];
  const mobileSections: Array<{ id: ProfileSection; label: string }> = [
    { id: 'overview', label: 'Overview' },
    { id: 'activity', label: 'Activity' },
    { id: 'details', label: 'Details' },
  ];
  const renderButton = ({ id, label }: { id: ProfileSection; label: string }) => {
    const active = activeSection === id;
    return (
      <button
        key={id}
        type="button"
        aria-current={active ? 'page' : undefined}
        onClick={() => onChange(id)}
        className={`min-h-11 whitespace-nowrap rounded-full px-4 text-sm font-semibold transition ${
          active
            ? 'bg-[#6f1d3b] text-white shadow-sm'
            : 'bg-white text-stone-600 hover:bg-rose-50'
        }`}
      >
        {label}
      </button>
    );
  };
  return (
    <nav aria-label="Client profile sections" className="sticky top-[3.75rem] z-30 -mx-4 mb-4 border-y border-rose-100 bg-[#fffaf5]/95 px-4 py-2 backdrop-blur">
      <div className="grid grid-cols-3 gap-2 lg:hidden">
        {mobileSections.map(renderButton)}
      </div>
      <div className="hidden gap-2 overflow-x-auto lg:flex">
        {desktopSections.map(renderButton)}
      </div>
    </nav>
  );
}

function AppointmentCard({
  appointment,
  onManage,
  onCancel,
  currency = 'CAD',
}: {
  appointment: ClientAppointment;
  /** Opens the shared manage sheet. When provided the whole card is tappable. */
  onManage?: (appointmentId: string) => void;
  /** Opens the manage sheet with the cancel confirmation already up. */
  onCancel?: (appointmentId: string) => void;
  currency?: string;
}) {
  const interactive = Boolean(onManage);
  return (
    <div
      data-testid={`client-appointment-card-${appointment.id}`}
      role={interactive ? 'button' : undefined}
      tabIndex={interactive ? 0 : undefined}
      onClick={interactive ? () => onManage!(appointment.id) : undefined}
      onKeyDown={interactive
        ? (event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              onManage!(appointment.id);
            }
          }
        : undefined}
      className={`rounded-[14px] border border-neutral-100 bg-white p-3 shadow-[0_2px_10px_rgba(0,0,0,0.03)] ${interactive ? 'cursor-pointer text-left transition-transform active:scale-[0.99]' : ''}`}
    >
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
            {formatCurrency(
              appointment.financial?.completedValueCents ?? appointment.totalPrice,
              currency,
            )}
          </div>
          <span className={`mt-1 inline-flex rounded-full px-2 py-1 text-[11px] font-semibold capitalize ${getAppointmentStatusStyles(appointment.status)}`}>
            {formatAppointmentStatus(appointment.status)}
          </span>
        </div>
      </div>
      {appointment.addOns && appointment.addOns.length > 0 && (
        <div className="mt-2 text-[12px] text-[#6B7280]">
          Add-ons:
          {' '}
          {appointment.addOns.map(addOn => (
            `${addOn.name}${addOn.quantity > 1 ? ` ×${addOn.quantity}` : ''}`
          )).join(', ')}
        </div>
      )}
      {appointment.financial && appointment.status === 'completed' && (
        <div className="mt-2 flex flex-wrap gap-2 text-[11px] text-stone-600">
          <span className="rounded-full bg-stone-100 px-2 py-1">
            {appointment.financial.paymentStatus?.replaceAll('_', ' ') ?? 'Payment not recorded'}
          </span>
          {appointment.financial.completedOutstandingCents != null
          && appointment.financial.completedOutstandingCents > 0 && (
            <span className="rounded-full bg-amber-100 px-2 py-1 font-semibold text-amber-900">
              {formatCurrency(appointment.financial.completedOutstandingCents, currency)}
              {' '}
              outstanding
            </span>
          )}
        </div>
      )}
      {appointment.notes && (
        <div className="mt-2 rounded-xl bg-neutral-50 px-3 py-2 text-[12px] text-[#6B7280]">
          {appointment.notes}
        </div>
      )}
      {(onManage || onCancel) && (
        <div className="mt-3 flex gap-2">
          {onManage && (
            <button
              type="button"
              data-testid={`client-appointment-change-${appointment.id}`}
              onClick={(event) => {
                event.stopPropagation();
                onManage(appointment.id);
              }}
              className="min-h-10 flex-1 rounded-xl border border-neutral-200 px-3 py-2 text-[13px] font-semibold text-[#1C1C1E]"
            >
              Change
            </button>
          )}
          {onCancel && (
            <button
              type="button"
              data-testid={`client-appointment-cancel-${appointment.id}`}
              onClick={(event) => {
                event.stopPropagation();
                onCancel(appointment.id);
              }}
              className="min-h-10 flex-1 rounded-xl border border-red-200 px-3 py-2 text-[13px] font-semibold text-red-600"
            >
              Cancel
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function AppointmentsSection({
  title,
  appointments,
  emptyMessage,
  onManage,
  onCancel,
  currency = 'CAD',
}: {
  title: string;
  appointments: ClientAppointment[];
  emptyMessage: string;
  onManage?: (appointmentId: string) => void;
  onCancel?: (appointmentId: string) => void;
  currency?: string;
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
                <AppointmentCard
                  key={appointment.id}
                  appointment={appointment}
                  onManage={onManage}
                  onCancel={onCancel}
                  currency={currency}
                />
              ))}
            </div>
          )}
    </AdminDetailCard>
  );
}

function ClientDetail({
  clientSummary,
  salonSlug,
  salonName,
  moduleAvailability,
  technicians,
  techniciansLoading,
  techniciansError,
  initialCachedDetail,
  onCacheUpdate,
  onRefreshTechnicians,
  onOpenPromotionSettings,
  onDirectoryChanged,
  onOpenClient,
  onBack,
}: {
  clientSummary: ClientSummary;
  salonSlug: string;
  salonName: string;
  moduleAvailability: ModuleAvailability;
  technicians: TechnicianOption[];
  techniciansLoading: boolean;
  techniciansError: string | null;
  initialCachedDetail: ClientDetailCacheEntry | null;
  onCacheUpdate: (clientId: string, updates: Partial<ClientDetailCacheEntry>) => void;
  onRefreshTechnicians: () => Promise<void> | void;
  onOpenPromotionSettings?: (stage: PromotionSettingsStage) => void;
  onDirectoryChanged: () => Promise<void> | void;
  onOpenClient: (clientId: string) => Promise<void> | void;
  onBack: () => void;
}) {
  const [profile, setProfile] = useState<ClientProfile | null>(initialCachedDetail?.profile ?? null);
  const [management, setManagement] = useState<ClientManagement | null>(
    initialCachedDetail?.management ?? null,
  );
  const [summary, setSummary] = useState<ClientProfileSummary | null>(initialCachedDetail?.summary ?? null);
  const [submittedPreferences, setSubmittedPreferences] = useState<SubmittedPreferences | null>(
    initialCachedDetail?.submittedPreferences ?? null,
  );
  const [upcomingAppointments, setUpcomingAppointments] = useState<ClientAppointment[]>(initialCachedDetail?.upcomingAppointments ?? []);
  const [pastAppointments, setPastAppointments] = useState<ClientAppointment[]>(initialCachedDetail?.pastAppointments ?? []);
  const [recentIssues, setRecentIssues] = useState<ClientAppointment[]>(initialCachedDetail?.recentIssues ?? []);
  const [photos, setPhotos] = useState<ClientPhoto[]>(initialCachedDetail?.photos ?? []);
  const [notesHistory, setNotesHistory] = useState<ClientNoteHistory[]>(
    initialCachedDetail?.notesHistory ?? [],
  );
  const [detailLoading, setDetailLoading] = useState(!initialCachedDetail?.profile);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [cancelIntent, setCancelIntent] = useState(false);
  const [showBookingModal, setShowBookingModal] = useState(false);
  const [bookingPrefill, setBookingPrefill] = useState<RebookPrefill | null>(null);
  const [activeSection, setActiveSection] = useState<ProfileSection>('overview');

  const [flagsState, setFlagsState] = useState<ClientFlagsState | null>(initialCachedDetail?.flagsState ?? null);
  const [flagsError, setFlagsError] = useState<string | null>(null);
  const [flagsLoading, setFlagsLoading] = useState(
    moduleAvailability.clientFlags || moduleAvailability.clientBlocking
      ? !(initialCachedDetail?.flagsLoaded ?? false)
      : false,
  );

  const [notesDraft, setNotesDraft] = useState(initialCachedDetail?.profile?.notes ?? clientSummary.notes ?? '');
  const [preferredTechnicianIdDraft, setPreferredTechnicianIdDraft] = useState(initialCachedDetail?.profile?.preferredTechnician?.id ?? clientSummary.preferredTechnician?.id ?? '');
  const [sensitivitiesDraft, setSensitivitiesDraft] = useState(initialCachedDetail?.profile?.sensitivities ?? '');
  const [shapeDraft, setShapeDraft] = useState(initialCachedDetail?.profile?.nailPreferences?.shape ?? '');
  const [lengthDraft, setLengthDraft] = useState(initialCachedDetail?.profile?.nailPreferences?.length ?? '');
  const [colorsDraft, setColorsDraft] = useState(initialCachedDetail?.profile?.nailPreferences?.favoriteColors ?? '');
  const [productsDraft, setProductsDraft] = useState(initialCachedDetail?.profile?.nailPreferences?.productsUsed ?? '');
  const [tagsDraft, setTagsDraft] = useState(initialCachedDetail?.profile?.tags?.join(', ') ?? '');
  const [rebookDaysDraft, setRebookDaysDraft] = useState(initialCachedDetail?.profile?.rebookIntervalDays?.toString() ?? '');
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
    management?: ClientManagement;
    summary?: ClientProfileSummary;
    submittedPreferences?: SubmittedPreferences | null;
    upcomingAppointments: ClientAppointment[];
    pastAppointments: ClientAppointment[];
    recentIssues?: ClientAppointment[];
    photos?: ClientPhoto[];
    notesHistory?: ClientNoteHistory[];
  }) => {
    const nextUpcoming = payload.upcomingAppointments ?? [];
    const nextPast = payload.pastAppointments ?? [];
    const nextIssues = payload.recentIssues ?? [];

    setProfile(payload.client);
    setManagement(payload.management ?? null);
    setSummary(payload.summary ?? null);
    setSubmittedPreferences(payload.submittedPreferences ?? null);
    setUpcomingAppointments(nextUpcoming);
    setPastAppointments(nextPast);
    setRecentIssues(nextIssues);
    setPhotos(payload.photos ?? []);
    setNotesHistory(payload.notesHistory ?? []);
    setNotesDraft(payload.client.notes ?? '');
    setPreferredTechnicianIdDraft(payload.client.preferredTechnician?.id ?? '');
    setSensitivitiesDraft(payload.client.sensitivities ?? '');
    setShapeDraft(payload.client.nailPreferences?.shape ?? '');
    setLengthDraft(payload.client.nailPreferences?.length ?? '');
    setColorsDraft(payload.client.nailPreferences?.favoriteColors ?? '');
    setProductsDraft(payload.client.nailPreferences?.productsUsed ?? '');
    setTagsDraft(payload.client.tags?.join(', ') ?? '');
    setRebookDaysDraft(payload.client.rebookIntervalDays?.toString() ?? '');

    onCacheUpdate(clientSummary.id, {
      profile: payload.client,
      management: payload.management ?? null,
      summary: payload.summary ?? null,
      submittedPreferences: payload.submittedPreferences ?? null,
      upcomingAppointments: nextUpcoming,
      pastAppointments: nextPast,
      recentIssues: nextIssues,
      photos: payload.photos ?? [],
      notesHistory: payload.notesHistory ?? [],
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

  // Shared appointment management: any change refreshes the profile so
  // upcoming/past lists, stats, and the dashboard stay consistent.
  const appointmentActions = useAppointmentActions({
    salonSlug,
    onMutationApplied: () => {
      void fetchClientDetail(true);
    },
    onCancelled: () => {
      setCancelIntent(false);
      void fetchClientDetail(true);
    },
    onOptimisticStatus: () => {
      void fetchClientDetail(true);
    },
  });

  const handleManageAppointment = useCallback((appointmentId: string) => {
    setCancelIntent(false);
    appointmentActions.openAppointment(appointmentId);
  }, [appointmentActions]);

  const handleCancelAppointmentRequest = useCallback((appointmentId: string) => {
    setCancelIntent(true);
    appointmentActions.openAppointment(appointmentId);
  }, [appointmentActions]);

  const openBookingModal = useCallback((prefill: RebookPrefill | null) => {
    setBookingPrefill(prefill ?? {
      name: statsSource.fullName ?? null,
      phone: statsSource.phone,
      email: statsSource.email ?? null,
      serviceId: null,
      technicianId: profile?.preferredTechnician?.id ?? null,
    });
    setShowBookingModal(true);
  }, [profile?.preferredTechnician?.id, statsSource.email, statsSource.fullName, statsSource.phone]);

  const profileDirty
    = notesDraft !== (profile?.notes ?? '')
    || preferredTechnicianIdDraft !== (profile?.preferredTechnician?.id ?? '')
    || sensitivitiesDraft !== (profile?.sensitivities ?? '')
    || shapeDraft !== (profile?.nailPreferences?.shape ?? '')
    || lengthDraft !== (profile?.nailPreferences?.length ?? '')
    || colorsDraft !== (profile?.nailPreferences?.favoriteColors ?? '')
    || productsDraft !== (profile?.nailPreferences?.productsUsed ?? '')
    || tagsDraft !== (profile?.tags?.join(', ') ?? '')
    || rebookDaysDraft !== (profile?.rebookIntervalDays?.toString() ?? '');

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
          expectedUpdatedAt: profile?.updatedAt,
          notes: notesDraft.trim() || null,
          preferredTechnicianId: preferredTechnicianIdDraft || null,
          sensitivities: sensitivitiesDraft.trim() || null,
          nailPreferences: {
            shape: shapeDraft.trim(),
            length: lengthDraft.trim(),
            favoriteColors: colorsDraft.trim(),
            productsUsed: productsDraft.trim(),
          },
          tags: tagsDraft.split(',').map(tag => tag.trim()).filter(Boolean),
          rebookIntervalDays: rebookDaysDraft ? Number(rebookDaysDraft) : null,
        }),
      });

      if (!response.ok) {
        if (response.status === 409) {
          throw new Error('This profile changed. Reload it before saving.');
        }
        throw new Error('Failed to save client profile');
      }

      await Promise.all([
        fetchClientDetail(true),
        fetchFlags(true),
      ]);
    } catch (error) {
      console.error('Failed to save client profile:', error);
      setProfileSaveError(
        error instanceof Error && error.message.includes('changed')
          ? error.message
          : 'Could not save client details',
      );
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
        expectedUpdatedAt: profile?.updatedAt,
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
        if (response.status === 409) {
          throw new Error('This profile changed. Reload it before saving client status.');
        }
        throw new Error('Failed to save client status');
      }

      await Promise.all([
        fetchClientDetail(true),
        fetchFlags(true),
      ]);
    } catch (error) {
      console.error('Failed to save client status:', error);
      setFlagsSaveError(
        error instanceof Error && error.message.includes('changed')
          ? error.message
          : 'Could not save client status',
      );
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
      className="fixed inset-0 top-12 z-50 overflow-y-auto overflow-x-hidden rounded-t-[20px] bg-[#fbf5ed]"
    >
      <ModalHeader
        title={detailName}
        leftAction={<BackButton onClick={onBack} label="Clients" />}
      />

      <div className="mx-auto w-full max-w-6xl p-4 pb-32 lg:pb-12">
        <AdminDetailCard className="mb-4 overflow-hidden rounded-[24px] border border-rose-100 bg-gradient-to-br from-white via-[#fffaf5] to-rose-50/70">
          <div className="flex flex-col items-center text-center lg:flex-row lg:items-center lg:text-left">
            <div className="mb-3 flex size-20 items-center justify-center rounded-full bg-gradient-to-br from-[#4facfe] to-[#00f2fe] text-2xl font-bold text-white shadow-lg">
              {getInitials(statsSource.fullName)}
            </div>
            <div className="lg:ml-5">
              <div className="flex flex-wrap items-center justify-center gap-2 lg:justify-start">
                <h2 className="text-[24px] font-semibold text-[#3f1727]">{detailName}</h2>
                {profile?.tags?.map(tag => (
                  <span key={tag} className="rounded-full bg-rose-100 px-2.5 py-1 text-xs font-semibold text-rose-800">
                    {tag}
                  </span>
                ))}
              </div>
              <div className="mt-1 flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-[14px] text-stone-500 lg:justify-start">
                <span className="flex items-center gap-1">
                  <Phone className="size-3.5" />
                  {formatPhone(statsSource.phone)}
                </span>
                {(profile?.email ?? clientSummary.email) && (
                  <span className="flex items-center gap-1">
                    <Mail className="size-3.5" />
                    {profile?.email ?? clientSummary.email}
                  </span>
                )}
              </div>
              <div className="mt-2 text-[13px] text-stone-500">
                {profile?.createdAt
                  ? `Client since ${formatDate(profile.createdAt)}${profile.lastVisitAt ? ` · Last visit ${formatDate(profile.lastVisitAt)}` : ''}`
                  : clientSummary.lastVisitAt
                    ? `Last visit ${formatDate(clientSummary.lastVisitAt)}`
                    : 'Loading client history…'}
              </div>
            </div>
          </div>
        </AdminDetailCard>

        <ProfileNavigation activeSection={activeSection} onChange={setActiveSection} />

        <ClientCommunicationActions
          salonSlug={salonSlug}
          salonName={salonName}
          client={{
            id: statsSource.id,
            fullName: statsSource.fullName,
            phone: statsSource.phone,
          }}
          upcomingAppointment={upcomingAppointments[0] ?? null}
          lastCompletedAppointment={pastAppointments[0] ?? null}
          completedAppointmentCount={pastAppointments.length}
          hasGoogleReview={profile?.hasGoogleReview ?? false}
          onOpenPromotionSettings={onOpenPromotionSettings}
          profileLayout
          showHistory={activeSection === 'activity'}
          profileControls={profile && management
            ? (
                <ClientProfileControls
                  salonSlug={salonSlug}
                  currency={summary?.currency ?? 'CAD'}
                  profile={{
                    id: profile.id,
                    fullName: profile.fullName,
                    firstName: profile.firstName,
                    lastName: profile.lastName,
                    phone: profile.phone,
                    email: profile.email,
                    birthday: profile.birthday,
                    notes: profile.notes,
                    preferredTechnicianId: profile.preferredTechnician?.id ?? null,
                    preferredTechnicianName: profile.preferredTechnician?.name ?? null,
                    rebookIntervalDays: profile.rebookIntervalDays,
                    updatedAt: profile.updatedAt,
                    archivedAt: profile.archivedAt,
                    mergedIntoClientId: profile.mergedIntoClientId,
                    canManageLifecycle: management.canManageLifecycle,
                    canPermanentlyDelete: management.canPermanentlyDelete,
                  }}
                  onUpdated={(updatedProfile: ClientProfileControlProfile) => {
                    setProfile((current) => {
                      if (!current) {
                        return current;
                      }
                      const nextProfile = {
                        ...current,
                        fullName: updatedProfile.fullName,
                        firstName: updatedProfile.firstName,
                        lastName: updatedProfile.lastName,
                        phone: updatedProfile.phone ?? current.phone,
                        email: updatedProfile.email,
                        birthday: updatedProfile.birthday,
                        updatedAt: updatedProfile.updatedAt,
                        archivedAt: updatedProfile.archivedAt,
                        mergedIntoClientId: updatedProfile.mergedIntoClientId,
                      };
                      onCacheUpdate(clientSummary.id, { profile: nextProfile });
                      return nextProfile;
                    });
                    setManagement(current => current
                      ? {
                          ...current,
                          canManageLifecycle: updatedProfile.canManageLifecycle,
                          canPermanentlyDelete: updatedProfile.canPermanentlyDelete,
                        }
                      : current);
                    void onDirectoryChanged();
                    void Promise.all([
                      fetchClientDetail(true),
                      fetchFlags(true),
                    ]);
                  }}
                  onViewClient={(clientId) => {
                    void onOpenClient(clientId);
                  }}
                  onMerged={(primaryId) => {
                    void onDirectoryChanged();
                    if (primaryId === clientSummary.id) {
                      void Promise.all([
                        fetchClientDetail(true),
                        fetchFlags(true),
                      ]);
                    } else {
                      void onOpenClient(primaryId);
                    }
                  }}
                  onRemoved={() => {
                    void onDirectoryChanged();
                    onBack();
                  }}
                />
              )
            : null}
          onBookAppointment={() => {
            const previousAppointment = pastAppointments[0];
            openBookingModal({
              name: statsSource.fullName ?? null,
              phone: statsSource.phone,
              email: statsSource.email ?? null,
              serviceId: previousAppointment?.services[0]?.id ?? null,
              technicianId:
                previousAppointment?.technician?.id
                ?? profile?.preferredTechnician?.id
                ?? null,
            });
          }}
        />

        {activeSection === 'overview' && (
          <div className="my-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard label="Completed visits" value={String(summary?.completedVisits ?? statsSource.totalVisits)} />
            <div>
              <StatCard
                label="Lifetime spend"
                value={formatCurrency(
                  summary?.lifetimeSpendCents ?? statsSource.totalSpent,
                  summary?.currency,
                )}
                accent="text-emerald-700"
              />
              <HistoryQualityBadge provenance={summary?.provenance.lifetimeSpend} />
            </div>
            <div>
              <StatCard
                label="Spend this month"
                value={summary
                  ? formatCurrency(summary.spendThisMonthCents, summary.currency)
                  : 'Unavailable'}
              />
              <HistoryQualityBadge provenance={summary?.provenance.spendThisMonth} />
            </div>
            <StatCard
              label="Completed outstanding"
              value={summary
                ? formatCurrency(summary.completedOutstandingCents, summary.currency)
                : 'Unavailable'}
              accent={summary?.completedOutstandingCents ? 'text-amber-700' : undefined}
            />
          </div>
        )}

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
                  {(activeSection === 'preferences' || activeSection === 'details') && (
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
                          <span className="mb-1.5 block text-[12px] font-semibold uppercase text-amber-700">Sensitivities & allergies</span>
                          <textarea
                            aria-label="Sensitivities and allergies"
                            value={sensitivitiesDraft}
                            onChange={event => setSensitivitiesDraft(event.target.value)}
                            rows={3}
                            placeholder="Allergies, product reactions, damaged nails, removal care..."
                            className="w-full rounded-xl border border-amber-300 bg-amber-50/60 px-3 py-2.5 text-[15px] text-[#1C1C1E] placeholder:text-[#8E8E93] focus:outline-none focus:ring-2 focus:ring-amber-400/40"
                          />
                          <span className="mt-1 block text-[11px] text-[#8E8E93]">Shown to the tech on today’s schedule before every appointment.</span>
                        </label>

                        <div className="mt-4 grid grid-cols-2 gap-3">
                          <label className="block">
                            <span className="mb-1.5 block text-[12px] font-medium uppercase text-[#8E8E93]">Preferred shape</span>
                            <input value={shapeDraft} onChange={event => setShapeDraft(event.target.value)} placeholder="Almond, square..." className="w-full rounded-xl border border-[#E5E7EB] bg-white px-3 py-2.5 text-[15px]" />
                          </label>
                          <label className="block">
                            <span className="mb-1.5 block text-[12px] font-medium uppercase text-[#8E8E93]">Preferred length</span>
                            <input value={lengthDraft} onChange={event => setLengthDraft(event.target.value)} placeholder="Short, medium..." className="w-full rounded-xl border border-[#E5E7EB] bg-white px-3 py-2.5 text-[15px]" />
                          </label>
                        </div>

                        <label className="mt-3 block">
                          <span className="mb-1.5 block text-[12px] font-medium uppercase text-[#8E8E93]">Favourite colours & styles</span>
                          <input value={colorsDraft} onChange={event => setColorsDraft(event.target.value)} placeholder="Nudes, French, chrome..." className="w-full rounded-xl border border-[#E5E7EB] bg-white px-3 py-2.5 text-[15px]" />
                        </label>

                        <label className="mt-3 block">
                          <span className="mb-1.5 block text-[12px] font-medium uppercase text-[#8E8E93]">Products used</span>
                          <input value={productsDraft} onChange={event => setProductsDraft(event.target.value)} placeholder="Builder gel shade, base, top..." className="w-full rounded-xl border border-[#E5E7EB] bg-white px-3 py-2.5 text-[15px]" />
                        </label>

                        <div className="mt-3 grid grid-cols-2 gap-3">
                          <label className="block">
                            <span className="mb-1.5 block text-[12px] font-medium uppercase text-[#8E8E93]">Tags</span>
                            <input value={tagsDraft} onChange={event => setTagsDraft(event.target.value)} placeholder="VIP, bridal" className="w-full rounded-xl border border-[#E5E7EB] bg-white px-3 py-2.5 text-[15px]" />
                          </label>
                          <label className="block">
                            <span className="mb-1.5 block text-[12px] font-medium uppercase text-[#8E8E93]">Rebook every</span>
                            <div className="flex items-center gap-2">
                              <input type="number" min={1} max={365} value={rebookDaysDraft} onChange={event => setRebookDaysDraft(event.target.value)} placeholder="21" className="min-w-0 flex-1 rounded-xl border border-[#E5E7EB] bg-white px-3 py-2.5 text-[15px]" />
                              <span className="text-sm text-[#8E8E93]">days</span>
                            </div>
                          </label>
                        </div>

                        {profile?.nextRebookDueAt && (
                          <p className="mt-3 rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-800">
                            Rebooking due
                            {' '}
                            {formatDate(profile.nextRebookDueAt)}
                          </p>
                        )}

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
                              setSensitivitiesDraft(profile?.sensitivities ?? '');
                              setShapeDraft(profile?.nailPreferences?.shape ?? '');
                              setLengthDraft(profile?.nailPreferences?.length ?? '');
                              setColorsDraft(profile?.nailPreferences?.favoriteColors ?? '');
                              setProductsDraft(profile?.nailPreferences?.productsUsed ?? '');
                              setTagsDraft(profile?.tags?.join(', ') ?? '');
                              setRebookDaysDraft(profile?.rebookIntervalDays?.toString() ?? '');
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

                      <AdminDetailCard className="mb-4">
                        <div className="text-[12px] font-medium uppercase text-[#8E8E93]">
                          Client-submitted preferences
                        </div>
                        <p className="mt-1 text-sm text-stone-500">
                          Read-only preferences shared by the client. Salon-managed details above remain separate.
                        </p>
                        {submittedPreferences
                          ? (
                              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                                {[
                                  ['Favourite technician', submittedPreferences.favoriteTechnician?.name],
                                  ['Favourite services', submittedPreferences.favoriteServices?.join(', ')],
                                  ['Nail shape', submittedPreferences.nailShape],
                                  ['Nail length', submittedPreferences.nailLength],
                                  ['Finishes', submittedPreferences.finishes?.join(', ')],
                                  ['Colour families', submittedPreferences.colorFamilies?.join(', ')],
                                  ['Preferred brands', submittedPreferences.preferredBrands?.join(', ')],
                                  ['Sensitivities', submittedPreferences.sensitivities?.join(', ')],
                                  ['Conversation', submittedPreferences.conversationLevel],
                                  ['Music', submittedPreferences.musicPreference],
                                  ['Beverages', submittedPreferences.beveragePreference?.join(', ')],
                                ].filter((entry): entry is [string, string] => Boolean(entry[1])).map(([label, value]) => (
                                  <div key={label} className="rounded-2xl bg-stone-50 p-3">
                                    <div className="text-[11px] font-semibold uppercase text-stone-400">{label}</div>
                                    <div className="mt-1 text-sm font-medium text-stone-800">{value}</div>
                                  </div>
                                ))}
                              </div>
                            )
                          : (
                              <div className="mt-4 rounded-2xl border border-dashed border-stone-200 px-4 py-5 text-sm text-stone-500">
                                No client-submitted preferences yet.
                              </div>
                            )}
                      </AdminDetailCard>
                    </>
                  )}

                  {activeSection === 'overview' && (
                    <div className="grid gap-4 lg:grid-cols-2">
                      <AdminDetailCard className="mb-4">
                        <div className="text-[12px] font-medium uppercase text-[#8E8E93]">Appointments & rebooking</div>
                        <div className="mt-4 space-y-3">
                          <div className="rounded-2xl bg-rose-50 px-4 py-3">
                            <div className="text-xs font-semibold uppercase text-rose-700">Next appointment</div>
                            <div className="mt-1 text-sm font-semibold text-stone-900">
                              {upcomingAppointments[0]
                                ? formatDateTimeRange(upcomingAppointments[0].startTime, upcomingAppointments[0].endTime)
                                : 'No future appointment booked'}
                            </div>
                          </div>
                          <div className="grid grid-cols-2 gap-3">
                            <div className="rounded-2xl bg-stone-50 p-3">
                              <div className="text-[11px] font-semibold uppercase text-stone-400">Last appointment</div>
                              <div className="mt-1 text-sm font-medium text-stone-800">
                                {pastAppointments[0] ? formatDate(pastAppointments[0].startTime) : 'No completed visit'}
                              </div>
                            </div>
                            <div className="rounded-2xl bg-stone-50 p-3">
                              <div className="text-[11px] font-semibold uppercase text-stone-400">Rebooking</div>
                              <div className="mt-1 text-sm font-medium capitalize text-stone-800">
                                {summary?.rebooking.status.replaceAll('_', ' ') ?? 'Unavailable'}
                              </div>
                            </div>
                            <div className="rounded-2xl bg-stone-50 p-3">
                              <div className="text-[11px] font-semibold uppercase text-stone-400">Preferred artist</div>
                              <div className="mt-1 text-sm font-medium text-stone-800">
                                {profile?.preferredTechnician?.name ?? 'No preference'}
                              </div>
                            </div>
                            <div className="rounded-2xl bg-stone-50 p-3">
                              <div className="text-[11px] font-semibold uppercase text-stone-400">Most-booked service</div>
                              <div className="mt-1 text-sm font-medium text-stone-800">
                                {summary?.mostBookedService?.name ?? 'Not enough history'}
                              </div>
                            </div>
                          </div>
                        </div>
                      </AdminDetailCard>

                      <AdminDetailCard className="mb-4">
                        <div className="text-[12px] font-medium uppercase text-[#8E8E93]">Client care</div>
                        <div className="mt-4 space-y-3">
                          {(sensitivitiesDraft || submittedPreferences?.sensitivities?.length) && (
                            <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3">
                              <div className="text-xs font-semibold uppercase text-amber-800">Allergies & sensitivities</div>
                              <p className="mt-1 text-sm text-amber-950">
                                {[sensitivitiesDraft, submittedPreferences?.sensitivities?.join(', ')]
                                  .filter(Boolean)
                                  .join(' · ')}
                              </p>
                            </div>
                          )}
                          {flagsState?.isBlocked && (
                            <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3">
                              <div className="text-xs font-semibold uppercase text-red-800">Online booking blocked</div>
                              {flagsState.blockedReason && <p className="mt-1 text-sm text-red-950">{flagsState.blockedReason}</p>}
                            </div>
                          )}
                          {flagsState?.adminFlags?.isProblemClient && (
                            <div className="rounded-2xl border border-orange-200 bg-orange-50 px-4 py-3">
                              <div className="text-xs font-semibold uppercase text-orange-800">Important internal flag</div>
                              {flagsState.adminFlags.flagReason && <p className="mt-1 text-sm text-orange-950">{flagsState.adminFlags.flagReason}</p>}
                            </div>
                          )}
                          {notesDraft && (
                            <div className="rounded-2xl bg-stone-50 px-4 py-3">
                              <div className="text-xs font-semibold uppercase text-stone-500">Important note</div>
                              <p className="mt-1 line-clamp-3 text-sm text-stone-800">{notesDraft}</p>
                            </div>
                          )}
                          <div className="grid grid-cols-2 gap-3">
                            <div className="rounded-2xl bg-amber-50 p-3">
                              <div className="text-[11px] font-semibold uppercase text-amber-700">Rewards</div>
                              <div className="mt-1 text-lg font-bold text-amber-900">{statsSource.loyaltyPoints.toLocaleString()}</div>
                            </div>
                            <div className="rounded-2xl bg-stone-50 p-3">
                              <div className="text-[11px] font-semibold uppercase text-stone-500">No-shows</div>
                              <div className="mt-1 text-lg font-bold text-stone-800">{flagsState?.noShowCount ?? statsSource.noShowCount}</div>
                            </div>
                          </div>
                        </div>
                      </AdminDetailCard>
                    </div>
                  )}

                  {activeSection === 'overview' && canManageFlags && (
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
                                        className="mt-3 w-full rounded-xl border border-[#E5E7EB] bg-white px-3 py-2.5 text-[14px] text-[#1C1C1E] placeholder:text-[#8E8E93] focus:outline-none focus:ring-2 focus:ring-[#007AFF]/30"
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
                                        className="mt-3 w-full rounded-xl border border-[#E5E7EB] bg-white px-3 py-2.5 text-[14px] text-[#1C1C1E] placeholder:text-[#8E8E93] focus:outline-none focus:ring-2 focus:ring-[#007AFF]/30"
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

                  {(activeSection === 'notes' || activeSection === 'details') && (
                    <AdminDetailCard className="mb-4">
                      <div className="text-[12px] font-medium uppercase text-[#8E8E93]">Internal notes</div>
                      <textarea
                        aria-label="Private notes"
                        value={notesDraft}
                        onChange={event => setNotesDraft(event.target.value)}
                        rows={5}
                        placeholder="Add private client notes..."
                        className="mt-3 w-full rounded-2xl border border-stone-200 bg-white px-4 py-3 text-[15px] text-stone-900 placeholder:text-stone-400 focus:outline-none focus:ring-2 focus:ring-rose-300"
                      />
                      <p className="mt-1 text-xs text-stone-500">
                        This is the current salon note. Earlier saved or merged notes are preserved below.
                      </p>
                      {profileSaveError && <p className="mt-2 text-sm text-red-600">{profileSaveError}</p>}
                      <div className="mt-3 flex justify-end">
                        <Button
                          type="button"
                          variant="brand"
                          size="pillSm"
                          disabled={!profileDirty || profileSaving}
                          onClick={saveProfile}
                        >
                          {profileSaving ? 'Saving…' : 'Save note'}
                        </Button>
                      </div>

                      {notesHistory.length > 0 && (
                        <div className="mt-5 border-t border-stone-100 pt-4">
                          <div className="text-[12px] font-medium uppercase text-[#8E8E93]">
                            Preserved note history
                          </div>
                          <div className="mt-3 space-y-2">
                            {notesHistory.map(note => (
                              <div
                                key={note.id}
                                className="min-w-0 rounded-2xl bg-stone-50 px-4 py-3"
                              >
                                <p className="break-words text-sm text-stone-800">{note.body}</p>
                                <p className="mt-1 text-xs text-stone-500">
                                  {formatDate(note.createdAt)}
                                  {note.sourceClientId && note.sourceClientId !== profile?.id
                                    ? ' · From merged profile'
                                    : ''}
                                </p>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      <div className="mb-3 mt-6 text-[12px] font-medium uppercase text-[#8E8E93]">Nail history photos</div>
                      {photos.length > 0
                        ? (
                            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                              {photos.map(photo => (
                                <a key={photo.id} href={photo.imageUrl} target="_blank" rel="noreferrer" className="group overflow-hidden rounded-2xl bg-stone-100">
                                  {/* eslint-disable-next-line @next/next/no-img-element -- provider URLs are tenant uploads */}
                                  <img src={photo.thumbnailUrl || photo.imageUrl} alt={photo.caption || `${photo.photoType} appointment photo`} className="aspect-square w-full object-cover transition group-hover:scale-[1.02]" />
                                  <div className="px-3 py-2 text-xs text-stone-600">
                                    {photo.caption || photo.photoType.replaceAll('_', ' ')}
                                    {' · '}
                                    {formatDate(photo.createdAt)}
                                  </div>
                                </a>
                              ))}
                            </div>
                          )
                        : (
                            <div className="rounded-2xl border border-dashed border-stone-200 px-4 py-6 text-center text-sm text-stone-500">
                              No appointment photos yet.
                            </div>
                          )}
                    </AdminDetailCard>
                  )}

                  {(activeSection === 'payments' || activeSection === 'activity') && (
                    <AdminDetailCard className="mb-4">
                      <div className="mb-1 text-[12px] font-medium uppercase text-[#8E8E93]">Payments</div>
                      <p className="text-sm text-stone-500">
                        Completed appointment value and recorded payments are separate. Future balances are not completed outstanding.
                      </p>
                      {pastAppointments.length === 0
                        ? (
                            <div className="mt-4 rounded-2xl border border-dashed border-stone-200 px-4 py-6 text-center text-sm text-stone-500">
                              No completed payment activity yet.
                            </div>
                          )
                        : (
                            <div className="mt-4 space-y-3">
                              {pastAppointments.map((appointment) => {
                                const financial = appointment.financial;
                                return (
                                  <button
                                    key={appointment.id}
                                    type="button"
                                    onClick={() => handleManageAppointment(appointment.id)}
                                    className="w-full rounded-2xl border border-stone-100 bg-stone-50 p-4 text-left transition hover:border-rose-200"
                                  >
                                    <div className="flex items-start justify-between gap-3">
                                      <div>
                                        <div className="font-semibold text-stone-900">
                                          {appointment.services.map(service => service.name).join(' · ') || 'Appointment'}
                                        </div>
                                        <div className="mt-1 text-xs text-stone-500">{formatDate(appointment.startTime)}</div>
                                      </div>
                                      <span className="text-sm font-semibold text-stone-900">
                                        {financial?.completedValueCents != null
                                          ? formatCurrency(financial.completedValueCents, summary?.currency)
                                          : 'Unavailable'}
                                      </span>
                                    </div>
                                    {financial && (
                                      <div className="mt-3 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
                                        <span>
                                          Received
                                          <strong>{formatCurrency(financial.paymentsReceivedCents, summary?.currency)}</strong>
                                        </span>
                                        <span>
                                          Tax
                                          <strong>{formatCurrency(financial.taxCents, summary?.currency)}</strong>
                                        </span>
                                        <span>
                                          Tips
                                          <strong>{formatCurrency(financial.tipsCents, summary?.currency)}</strong>
                                        </span>
                                        <span>
                                          Outstanding
                                          <strong>{financial.completedOutstandingCents == null ? 'Unavailable' : formatCurrency(financial.completedOutstandingCents, summary?.currency)}</strong>
                                        </span>
                                      </div>
                                    )}
                                  </button>
                                );
                              })}
                            </div>
                          )}
                    </AdminDetailCard>
                  )}

                  {(activeSection === 'appointments' || activeSection === 'activity') && (
                    <>
                      <AppointmentsSection
                        title="Upcoming appointments"
                        appointments={upcomingAppointments}
                        emptyMessage="No upcoming appointments booked."
                        onManage={handleManageAppointment}
                        onCancel={handleCancelAppointmentRequest}
                        currency={summary?.currency}
                      />

                      <AppointmentsSection
                        title="Completed appointments"
                        appointments={pastAppointments}
                        emptyMessage="No completed appointments yet."
                        onManage={handleManageAppointment}
                        currency={summary?.currency}
                      />

                      {recentIssues.length > 0 && (
                        <AppointmentsSection
                          title="Recent issues"
                          appointments={recentIssues}
                          emptyMessage=""
                          onManage={handleManageAppointment}
                          currency={summary?.currency}
                        />
                      )}
                    </>
                  )}
                </>
              )}
      </div>

      <AppointmentQuickEditSheet
        isOpen={Boolean(appointmentActions.selectedAppointmentId)}
        onClose={() => {
          setCancelIntent(false);
          appointmentActions.closeAppointment();
        }}
        detail={appointmentActions.detail}
        loading={appointmentActions.detailLoading}
        saving={appointmentActions.detailSaving}
        actionError={appointmentActions.detailError}
        attemptedTimeLabel={appointmentActions.attemptedTimeLabel}
        warnings={appointmentActions.warnings}
        onSaveEdits={appointmentActions.saveEdits}
        onMoveToNextAvailable={appointmentActions.moveToNextAvailable}
        onCancelAppointment={args => appointmentActions.cancelAppointment(args as CancelArgs)}
        onMarkCompleted={() => appointmentActions.openCheckout()}
        onStartAppointment={appointmentActions.startAppointment}
        onConfirmAppointment={appointmentActions.confirmAppointment}
        onMarkNoShow={appointmentActions.markNoShow}
        onResendConfirmation={appointmentActions.resendConfirmation}
        onViewReceipt={appointmentActions.openReceipt}
        onRetryLoad={() => void appointmentActions.refreshDetail()}
        onReminderSent={() => appointmentActions.refreshDetail()}
        initialPendingAction={cancelIntent ? 'cancel' : null}
        onRebook={() => {
          const prefill = appointmentActions.buildRebookPrefill();
          if (!prefill) {
            return;
          }
          appointmentActions.closeAppointment();
          openBookingModal(prefill);
        }}
      />

      <CheckoutSheet
        isOpen={appointmentActions.checkoutOpen}
        appointmentId={appointmentActions.selectedAppointmentId}
        salonSlug={salonSlug}
        initialView={appointmentActions.checkoutInitialView}
        onClose={appointmentActions.closeCheckout}
        onCompleted={() => {
          appointmentActions.handleCheckoutCompleted();
          void fetchClientDetail(true);
        }}
        onRebook={() => {
          const prefill = appointmentActions.buildRebookPrefill();
          if (!prefill) {
            return;
          }
          appointmentActions.closeCheckout();
          appointmentActions.closeAppointment();
          openBookingModal(prefill);
        }}
      />

      <NewAppointmentModal
        isOpen={showBookingModal}
        onClose={() => {
          setShowBookingModal(false);
          setBookingPrefill(null);
        }}
        onSuccess={() => {
          void fetchClientDetail(true);
        }}
        clientPrefill={bookingPrefill}
      />
    </motion.div>
  );
}

export function ClientsModal({
  onClose,
  initialClientId = null,
  onOpenPromotionSettings,
}: ClientsModalProps) {
  const { salonSlug, salonName } = useSalon();
  const [clients, setClients] = useState<ClientSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState('');
  const [searchRevision, setSearchRevision] = useState(0);
  const [sortBy, setSortBy] = useState<SortOption>('recent');
  const [directoryScope, setDirectoryScope] = useState<ClientDirectoryScope>('active');
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [totalClients, setTotalClients] = useState(0);
  const [selectedClient, setSelectedClient] = useState<ClientSummary | null>(null);
  const [showHub, setShowHub] = useState(false);
  const [activeSegment, setActiveSegment] = useState<ClientInsightSegmentId | null>(null);
  const [insightsBookingClient, setInsightsBookingClient] = useState<ClientInsightAttentionItem | null>(null);
  const [insightsRefreshKey, setInsightsRefreshKey] = useState(0);
  const [initialClientError, setInitialClientError] = useState<string | null>(null);

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
  const initialClientRequestRef = useRef<string | null>(null);
  const directoryScrollRef = useRef<HTMLDivElement | null>(null);
  const directoryReturnScrollRef = useRef(0);
  const savedDirectoryStateRef = useRef<DirectoryStateSnapshot | null>(null);
  const skipNextDirectoryFetchRef = useRef(false);
  const directoryRequestGenerationRef = useRef(0);
  const directoryAbortControllerRef = useRef<AbortController | null>(null);
  const pendingSearchRevisionRef = useRef(0);
  const directoryQuerySignature = JSON.stringify({
    salonSlug,
    activeSegment,
    directoryScope,
    search: debouncedSearchQuery,
    searchRevision,
    sortBy,
    sortOrder: sortBy === 'name' ? 'asc' : 'desc',
  });
  const directoryQuerySignatureRef = useRef(directoryQuerySignature);
  directoryQuerySignatureRef.current = directoryQuerySignature;

  const invalidateDirectoryRequests = useCallback((settleLoading = false) => {
    directoryRequestGenerationRef.current += 1;
    directoryAbortControllerRef.current?.abort();
    directoryAbortControllerRef.current = null;
    if (settleLoading) {
      setLoading(false);
    }
  }, []);

  const fetchClients = useCallback(async (targetPage: number, resetPage = false) => {
    if (!salonSlug) {
      return;
    }

    directoryAbortControllerRef.current?.abort();
    const controller = new AbortController();
    directoryAbortControllerRef.current = controller;
    const requestGeneration = directoryRequestGenerationRef.current + 1;
    directoryRequestGenerationRef.current = requestGeneration;
    const requestSignature = directoryQuerySignature;
    const isCurrentRequest = () =>
      requestGeneration === directoryRequestGenerationRef.current
      && requestSignature === directoryQuerySignatureRef.current
      && !controller.signal.aborted;

    try {
      setLoading(true);
      setError(null);

      const params = new URLSearchParams({
        salonSlug,
        sortBy,
        scope: directoryScope,
        sortOrder: sortBy === 'name' ? 'asc' : 'desc',
        page: String(targetPage),
        limit: String(CLIENTS_PAGE_SIZE),
      });
      if (debouncedSearchQuery) {
        params.set('search', debouncedSearchQuery);
      }
      if (activeSegment) {
        params.set('segment', activeSegment);
      }

      const response = await fetch(`/api/admin/clients?${params}`, {
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new Error('Failed to fetch clients');
      }

      const result = await response.json();
      if (!isCurrentRequest()) {
        return;
      }
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
      if (
        !isCurrentRequest()
        || (fetchError instanceof DOMException && fetchError.name === 'AbortError')
      ) {
        return;
      }
      console.error('Failed to fetch clients:', fetchError);
      setError('Failed to load clients');
    } finally {
      if (isCurrentRequest()) {
        setLoading(false);
        directoryAbortControllerRef.current = null;
      }
    }
  }, [
    activeSegment,
    debouncedSearchQuery,
    directoryScope,
    directoryQuerySignature,
    salonSlug,
    sortBy,
  ]);

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
      management: null,
      summary: null,
      submittedPreferences: null,
      upcomingAppointments: [],
      pastAppointments: [],
      recentIssues: [],
      photos: [],
      notesHistory: [],
      flagsState: null,
      flagsLoaded: false,
    };

    clientDetailCacheRef.current[clientId] = {
      ...existing,
      ...updates,
    };
  }, []);

  useEffect(() => {
    if (!initialClientId || !salonSlug || selectedClient?.id === initialClientId) {
      return;
    }

    const listedClient = clients.find(client => client.id === initialClientId);
    if (listedClient) {
      setInitialClientError(null);
      setSelectedClient(listedClient);
      return;
    }

    const requestKey = `${salonSlug}:${initialClientId}`;
    if (initialClientRequestRef.current === requestKey) {
      return;
    }
    initialClientRequestRef.current = requestKey;
    setInitialClientError(null);

    void fetch(
      `/api/admin/clients/${encodeURIComponent(initialClientId)}?salonSlug=${encodeURIComponent(salonSlug)}`,
      { cache: 'no-store' },
    )
      .then(async (response) => {
        const payload = await response.json().catch(() => null);
        if (!response.ok || !payload?.data?.client) {
          throw new Error(payload?.error?.message || 'Client could not be loaded.');
        }

        const client = payload.data.client as ClientProfile;
        clientDetailCacheRef.current[client.id] = {
          profile: client,
          management: payload.data.management ?? null,
          summary: payload.data.summary ?? null,
          submittedPreferences: payload.data.submittedPreferences ?? null,
          upcomingAppointments: payload.data.upcomingAppointments ?? [],
          pastAppointments: payload.data.pastAppointments ?? [],
          recentIssues: payload.data.recentIssues ?? [],
          photos: payload.data.photos ?? [],
          notesHistory: payload.data.notesHistory ?? [],
          flagsState: null,
          flagsLoaded: false,
        };
        setSelectedClient({
          id: client.id,
          phone: client.phone,
          fullName: client.fullName,
          email: client.email,
          lastVisitAt: client.lastVisitAt,
          totalVisits: client.totalVisits,
          totalSpent: client.totalSpent,
          noShowCount: client.noShowCount,
          loyaltyPoints: client.loyaltyPoints,
          preferredTechnician: client.preferredTechnician,
          notes: client.notes,
        });
      })
      .catch((requestError: unknown) => {
        setInitialClientError(
          requestError instanceof Error
            ? requestError.message
            : 'Client could not be loaded.',
        );
      });
  }, [clients, initialClientId, salonSlug, selectedClient?.id]);

  const openClientById = useCallback(async (clientId: string) => {
    const listedClient = clients.find(client => client.id === clientId);
    if (listedClient) {
      setSelectedClient(listedClient);
      return;
    }

    const cached = clientDetailCacheRef.current[clientId]?.profile;
    if (cached) {
      setSelectedClient({
        id: cached.id,
        phone: cached.phone,
        fullName: cached.fullName,
        email: cached.email,
        birthday: cached.birthday,
        archivedAt: cached.archivedAt,
        mergedIntoClientId: cached.mergedIntoClientId,
        updatedAt: cached.updatedAt,
        lastVisitAt: cached.lastVisitAt,
        totalVisits: cached.totalVisits,
        totalSpent: cached.totalSpent,
        noShowCount: cached.noShowCount,
        loyaltyPoints: cached.loyaltyPoints,
        preferredTechnician: cached.preferredTechnician,
        notes: cached.notes,
      });
      return;
    }

    try {
      const response = await fetch(
        `/api/admin/clients/${encodeURIComponent(clientId)}?salonSlug=${encodeURIComponent(salonSlug)}`,
        { cache: 'no-store' },
      );
      const payload = await response.json().catch(() => null);
      if (!response.ok || !payload?.data?.client) {
        throw new Error('Client could not be loaded.');
      }
      const client = payload.data.client as ClientProfile;
      clientDetailCacheRef.current[client.id] = {
        profile: client,
        management: payload.data.management ?? null,
        summary: payload.data.summary ?? null,
        submittedPreferences: payload.data.submittedPreferences ?? null,
        upcomingAppointments: payload.data.upcomingAppointments ?? [],
        pastAppointments: payload.data.pastAppointments ?? [],
        recentIssues: payload.data.recentIssues ?? [],
        photos: payload.data.photos ?? [],
        notesHistory: payload.data.notesHistory ?? [],
        flagsState: null,
        flagsLoaded: false,
      };
      setSelectedClient({
        id: client.id,
        phone: client.phone,
        fullName: client.fullName,
        email: client.email,
        birthday: client.birthday,
        archivedAt: client.archivedAt,
        mergedIntoClientId: client.mergedIntoClientId,
        updatedAt: client.updatedAt,
        lastVisitAt: client.lastVisitAt,
        totalVisits: client.totalVisits,
        totalSpent: client.totalSpent,
        noShowCount: client.noShowCount,
        loyaltyPoints: client.loyaltyPoints,
        preferredTechnician: client.preferredTechnician,
        notes: client.notes,
      });
    } catch {
      setInitialClientError('Client could not be loaded.');
    }
  }, [clients, salonSlug]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedSearchQuery(searchQuery.trim());
      setSearchRevision(pendingSearchRevisionRef.current);
    }, 300);

    return () => window.clearTimeout(timer);
  }, [searchQuery]);

  useEffect(() => () => {
    directoryRequestGenerationRef.current += 1;
    directoryAbortControllerRef.current?.abort();
  }, []);

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
    if (skipNextDirectoryFetchRef.current) {
      skipNextDirectoryFetchRef.current = false;
      return;
    }
    lastFetchedPageRef.current = 1;
    setPage(1);
    fetchClients(1, true);
  }, [
    activeSegment,
    debouncedSearchQuery,
    directoryScope,
    fetchClients,
    salonSlug,
    sortBy,
  ]);

  const groupedClients = useMemo(() => (
    sortBy === 'name' ? groupClientsByLetter(clients) : null
  ), [clients, sortBy]);

  const loadMore = () => {
    if (!hasMore || loading) {
      return;
    }
    setPage(prev => prev + 1);
  };

  const openSegment = useCallback((segment: ClientInsightSegmentId) => {
    if (segment === activeSegment) {
      setShowHub(false);
      return;
    }
    invalidateDirectoryRequests(true);
    setError(null);
    if (!activeSegment && !savedDirectoryStateRef.current) {
      savedDirectoryStateRef.current = {
        clients,
        searchQuery,
        debouncedSearchQuery,
        sortBy,
        directoryScope,
        page,
        hasMore,
        totalClients,
        scrollTop: directoryScrollRef.current?.scrollTop ?? 0,
      };
    }
    setActiveSegment(segment);
    setDirectoryScope('active');
    setSearchQuery('');
    setDebouncedSearchQuery('');
    setClients([]);
    setPage(1);
    setHasMore(false);
    setTotalClients(0);
    lastFetchedPageRef.current = 1;
    setShowHub(false);
  }, [
    activeSegment,
    clients,
    debouncedSearchQuery,
    directoryScope,
    hasMore,
    page,
    searchQuery,
    sortBy,
    totalClients,
    invalidateDirectoryRequests,
  ]);

  const clearSegment = useCallback(() => {
    invalidateDirectoryRequests(true);
    setError(null);
    const saved = savedDirectoryStateRef.current;
    if (!saved) {
      setActiveSegment(null);
      return;
    }
    skipNextDirectoryFetchRef.current = true;
    setActiveSegment(null);
    setClients(saved.clients);
    setSearchQuery(saved.searchQuery);
    setDebouncedSearchQuery(saved.debouncedSearchQuery);
    setSortBy(saved.sortBy);
    setDirectoryScope(saved.directoryScope);
    setPage(saved.page);
    setHasMore(saved.hasMore);
    setTotalClients(saved.totalClients);
    lastFetchedPageRef.current = saved.page;
    savedDirectoryStateRef.current = null;
    window.requestAnimationFrame(() => {
      if (directoryScrollRef.current) {
        directoryScrollRef.current.scrollTop = saved.scrollTop;
      }
    });
  }, [invalidateDirectoryRequests]);

  const handleSearchChange = useCallback((value: string) => {
    invalidateDirectoryRequests(true);
    setError(null);
    pendingSearchRevisionRef.current += 1;
    setSearchQuery(value);
  }, [invalidateDirectoryRequests]);

  const handleSortChange = useCallback((value: SortOption) => {
    if (value === sortBy) {
      return;
    }
    invalidateDirectoryRequests(true);
    setError(null);
    setSortBy(value);
  }, [invalidateDirectoryRequests, sortBy]);

  const handleDirectoryScopeChange = useCallback((value: ClientDirectoryScope) => {
    if (value === directoryScope) {
      return;
    }
    invalidateDirectoryRequests(true);
    setError(null);
    setDirectoryScope(value);
  }, [directoryScope, invalidateDirectoryRequests]);

  const restoreDirectoryScroll = useCallback(() => {
    const scrollTop = directoryReturnScrollRef.current;
    window.requestAnimationFrame(() => {
      if (directoryScrollRef.current) {
        directoryScrollRef.current.scrollTop = scrollTop;
      }
    });
  }, []);

  return (
    <div className="relative flex min-h-full w-full flex-col bg-[#F2F2F7] font-sans text-black">
      <div className="sticky top-0 z-20 bg-[#F2F2F7]/80 backdrop-blur-md">
        <ModalHeader
          title={showHub ? 'Client Insights' : 'Clients'}
          subtitle={showHub ? 'Client health and follow-up' : `${totalClients} total`}
          leftAction={<BackButton onClick={onClose} label="Back" />}
        />
        <div className="space-y-3 px-4 pb-3">
          <div className="flex rounded-[10px] bg-[#7676801f] p-0.5" role="tablist" aria-label="Clients or Client Insights">
            {([['clients', 'Clients'], ['insights', 'Client Insights']] as const).map(([id, label]) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={showHub === (id === 'insights')}
                data-testid={id === 'insights' ? 'clients-mode-hub' : 'clients-mode-clients'}
                data-mode={id}
                onClick={() => {
                  if (id === 'insights' && !showHub) {
                    directoryReturnScrollRef.current
                      = directoryScrollRef.current?.scrollTop ?? 0;
                    if (!activeSegment) {
                      savedDirectoryStateRef.current = {
                        clients,
                        searchQuery,
                        debouncedSearchQuery,
                        sortBy,
                        directoryScope,
                        page,
                        hasMore,
                        totalClients,
                        scrollTop: directoryReturnScrollRef.current,
                      };
                    }
                  }
                  if (id === 'clients' && showHub) {
                    restoreDirectoryScroll();
                    if (!activeSegment) {
                      // The directory never changed while Insights was visible.
                      // Clear the snapshot so the next Insights visit captures
                      // the latest search, sort, pagination, and scroll state.
                      savedDirectoryStateRef.current = null;
                    }
                  }
                  setShowHub(id === 'insights');
                }}
                className={`min-h-9 flex-1 rounded-[8px] text-[14px] font-semibold ${showHub === (id === 'insights') ? 'bg-white text-[#1C1C1E] shadow-sm' : 'text-[#636366]'}`}
              >
                {label}
              </button>
            ))}
          </div>
          {!showHub && (
            <>
              <AdminSearchField
                value={searchQuery}
                onChange={handleSearchChange}
                placeholder="Search clients"
                inputClassName="rounded-[10px] bg-[#767680]/12 py-2 text-[16px] shadow-none focus:ring-1 focus:ring-[#007AFF]/30"
              />
              {!activeSegment && (
                <div
                  className="flex rounded-[10px] bg-[rgba(118,118,128,0.12)] p-0.5"
                  role="tablist"
                  aria-label="Client directory status"
                >
                  {([['active', 'Active'], ['archived', 'Archived']] as const).map(([scope, label]) => (
                    <button
                      key={scope}
                      type="button"
                      role="tab"
                      aria-selected={directoryScope === scope}
                      onClick={() => handleDirectoryScopeChange(scope)}
                      className={`min-h-9 flex-1 rounded-[8px] text-[14px] font-semibold ${
                        directoryScope === scope
                          ? 'bg-white text-[#1C1C1E] shadow-sm'
                          : 'text-[#636366]'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              )}
              <SortPills sortBy={sortBy} onChange={handleSortChange} />
              {activeSegment && (
                <div
                  className="flex items-center justify-between gap-3 rounded-2xl border border-rose-200 bg-rose-50 px-3 py-2"
                  data-testid="clients-active-segment"
                >
                  <span className="min-w-0 truncate text-sm font-semibold text-rose-900">
                    {CLIENT_INSIGHT_SEGMENT_LABELS[activeSegment]}
                  </span>
                  <button
                    type="button"
                    onClick={clearSegment}
                    className="min-h-9 shrink-0 rounded-full bg-white px-3 text-xs font-semibold text-rose-800 shadow-sm"
                  >
                    Clear
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {showHub
        ? (
            <div className="flex-1 overflow-y-auto pt-2">
              <ClientInsightsPanel
                refreshKey={insightsRefreshKey}
                onOpenSegment={openSegment}
                onBookClient={setInsightsBookingClient}
                onOpenClient={(clientId) => {
                  const listed = clients.find(client => client.id === clientId);
                  setShowHub(false);
                  restoreDirectoryScroll();
                  if (!activeSegment) {
                    savedDirectoryStateRef.current = null;
                  }
                  if (listed) {
                    setSelectedClient(listed);
                  } else {
                    setSelectedClient({ id: clientId } as ClientSummary);
                  }
                }}
              />
            </div>
          )
        : (
            <div
              ref={directoryScrollRef}
              className="flex-1 overflow-y-auto pb-10"
              data-testid="clients-directory-scroll"
            >
              {initialClientError && (
                <AsyncStatePanel
                  tone="error"
                  title="Unable to open that client"
                  description={initialClientError}
                  className="mx-4 mt-4"
                  action={(
                    <Button
                      type="button"
                      variant="brandSoft"
                      size="pillSm"
                      onClick={() => {
                        initialClientRequestRef.current = null;
                        setInitialClientError(null);
                        void fetchClients(1, true);
                      }}
                    >
                      Try again
                    </Button>
                  )}
                />
              )}
              {loading && clients.length === 0
                ? (
                    <div className="p-4">
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
                    ? activeSegment
                      ? (
                          <div className="mx-4 my-8 rounded-3xl border border-dashed border-rose-200 bg-[#fffaf5] px-5 py-10 text-center">
                            <p className="font-semibold text-stone-900">
                              No clients match
                              {' '}
                              {CLIENT_INSIGHT_SEGMENT_LABELS[activeSegment].toLowerCase()}
                            </p>
                            <p className="mt-1 text-sm text-stone-500">
                              Clear the filter to return to the full directory.
                            </p>
                            <Button type="button" variant="brandSoft" size="pillSm" className="mt-4" onClick={clearSegment}>
                              Clear filter
                            </Button>
                          </div>
                        )
                      : (
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
          )}

      <AnimatePresence>
        {selectedClient && (
          <ClientDetail
            key={selectedClient.id}
            clientSummary={selectedClient}
            salonSlug={salonSlug}
            salonName={salonName}
            moduleAvailability={moduleAvailability}
            technicians={technicians}
            techniciansLoading={techniciansLoading}
            techniciansError={techniciansError}
            initialCachedDetail={clientDetailCacheRef.current[selectedClient.id] ?? null}
            onCacheUpdate={updateClientDetailCache}
            onRefreshTechnicians={fetchTechnicians}
            onDirectoryChanged={() => {
              clientDetailCacheRef.current = {};
              return fetchClients(1, true);
            }}
            onOpenClient={openClientById}
            onOpenPromotionSettings={stage =>
              onOpenPromotionSettings?.(stage, selectedClient.id)}
            onBack={() => setSelectedClient(null)}
          />
        )}
      </AnimatePresence>

      <NewAppointmentModal
        isOpen={Boolean(insightsBookingClient)}
        onClose={() => setInsightsBookingClient(null)}
        onSuccess={() => {
          setInsightsBookingClient(null);
          setInsightsRefreshKey(current => current + 1);
          void fetchClients(1, true);
        }}
        clientPrefill={insightsBookingClient
          ? {
              name: insightsBookingClient.clientName,
              phone: insightsBookingClient.phone,
              email: insightsBookingClient.email,
            }
          : null}
      />
    </div>
  );
}
