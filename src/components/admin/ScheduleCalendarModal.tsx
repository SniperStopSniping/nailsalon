'use client';

/**
 * ScheduleCalendarModal Component
 *
 * Full calendar view for appointments with:
 * - Weekly/Monthly view toggle
 * - Appointment counts per day
 * - Day detail view showing techs, times, and duration
 * - Click on a day to see detailed appointments
 */

import { AnimatePresence, motion } from 'framer-motion';
import {
  Calendar,
  ChevronLeft,
  ChevronRight,
  Clock,
  Plus,
  User,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { DepositPanel } from '@/components/admin/DepositPanel';
import { AppointmentQuickEditSheet } from '@/components/appointments/AppointmentQuickEditSheet';
import { CheckoutSheet } from '@/components/appointments/CheckoutSheet';
import { DialogShell } from '@/components/ui/dialog-shell';
import { type CancelArgs, type RebookPrefill, useAppointmentActions } from '@/hooks/useAppointmentActions';
import { formatAppointmentStatus } from '@/libs/appointmentStatusDisplay';
import {
  type CalendarDayAvailability,
  type CalendarSchedule,
  EMPTY_CALENDAR_SCHEDULE,
  formatMinutesLabel,
  getDayAvailability,
} from '@/libs/calendarSchedule';
import { APPOINTMENT_DATA_CHANGED_EVENT } from '@/libs/dashboardEvents';
import { useSalon } from '@/providers/SalonProvider';

import { BackButton, ModalHeader } from './AppModal';
import { NewAppointmentModal } from './NewAppointmentModal';

// Types
type ViewMode = 'weekly' | 'monthly';
type ScheduleFilter =
  | 'all'
  | 'appointments'
  | 'google_busy'
  | 'free'
  | 'needs_review';

type AppointmentSummary = {
  id: string;
  clientName: string;
  startTime: string;
  endTime: string;
  services: string[];
  technician: string | null;
  technicianId: string | null;
  status: string;
  source: 'luster' | 'google';
  transparency?: 'busy' | 'free';
  reviewStatus?: string;
  googleEventReviewId?: string;
  isReadOnly?: boolean;
  description?: string | null;
  location?: string | null;
  sourceVersion?: string | null;
  suggestedClient?: { fullName: string | null; phone: string; email: string | null } | null;
  timeZone?: string;
};

type DaySummary = {
  date: string; // YYYY-MM-DD
  count: number;
  appointmentCount: number;
  googleBusyCount: number;
  googleFreeCount: number;
  appointments: AppointmentSummary[];
};

type ScheduleCalendarModalProps = {
  onClose: () => void;
  /**
   * Active salon from the owner dashboard. It resolves its salon client-side,
   * after the tenant cookie the SalonProvider reads has been set, so the prop
   * is the reliable source and the provider is only the fallback.
   */
  salonSlug?: string | null;
};

// Helper functions
function formatMonthYear(date: Date): string {
  return date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}

function formatWeekRange(startDate: Date): string {
  const endDate = new Date(startDate);
  endDate.setDate(endDate.getDate() + 6);

  const startMonth = startDate.toLocaleDateString('en-US', { month: 'short' });
  const endMonth = endDate.toLocaleDateString('en-US', { month: 'short' });

  if (startMonth === endMonth) {
    return `${startMonth} ${startDate.getDate()} - ${endDate.getDate()}, ${startDate.getFullYear()}`;
  }
  return `${startMonth} ${startDate.getDate()} - ${endMonth} ${endDate.getDate()}, ${startDate.getFullYear()}`;
}

function getWeekStart(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay();
  d.setDate(d.getDate() - day);
  d.setHours(0, 0, 0, 0);
  return d;
}

function getMonthStart(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function getMonthDays(date: Date): Date[] {
  const year = date.getFullYear();
  const month = date.getMonth();
  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);

  const days: Date[] = [];

  // Add padding days from previous month
  const startPadding = firstDay.getDay();
  for (let i = startPadding - 1; i >= 0; i--) {
    const d = new Date(year, month, -i);
    days.push(d);
  }

  // Add days of current month
  for (let i = 1; i <= lastDay.getDate(); i++) {
    days.push(new Date(year, month, i));
  }

  // Add padding days from next month to complete the grid
  const endPadding = 42 - days.length; // 6 rows * 7 days
  for (let i = 1; i <= endPadding; i++) {
    days.push(new Date(year, month + 1, i));
  }

  return days;
}

function getWeekDays(startDate: Date): Date[] {
  const days: Date[] = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(startDate);
    d.setDate(startDate.getDate() + i);
    days.push(d);
  }
  return days;
}

function formatDateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function formatDateKeyInTimeZone(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

function formatTime(isoString: string, timeZone?: string): string {
  const date = new Date(isoString);
  return date.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZone,
  });
}

function calculateDuration(startTime: string, endTime: string): string {
  const start = new Date(startTime);
  const end = new Date(endTime);
  const minutes = Math.round((end.getTime() - start.getTime()) / (1000 * 60));

  if (minutes < 60) {
    return `${minutes}min`;
  }
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
}

function isSameDay(date1: Date, date2: Date): boolean {
  return (
    date1.getFullYear() === date2.getFullYear()
    && date1.getMonth() === date2.getMonth()
    && date1.getDate() === date2.getDate()
  );
}

function isToday(date: Date): boolean {
  return isSameDay(date, new Date());
}

// Status colors
const STATUS_COLORS: Record<
  string,
  { bg: string; text: string; border: string }
> = {
  confirmed: {
    bg: 'bg-blue-50',
    text: 'text-blue-700',
    border: 'border-blue-300',
  },
  pending: {
    bg: 'bg-yellow-50',
    text: 'text-yellow-700',
    border: 'border-yellow-300',
  },
  in_progress: {
    bg: 'bg-green-50',
    text: 'text-green-700',
    border: 'border-green-300',
  },
  // Deliberately distinct from confirmed-blue: an unpaid hold rendered in the
  // confirmed palette reads as a real booking at a glance. Fuchsia matches the
  // shared chip contract in appointmentStatusDisplay.ts.
  awaiting_payment: {
    bg: 'bg-fuchsia-50',
    text: 'text-fuchsia-800',
    border: 'border-fuchsia-300',
  },
  completed: {
    bg: 'bg-gray-50',
    text: 'text-gray-600',
    border: 'border-gray-300',
  },
  cancelled: {
    bg: 'bg-red-50',
    text: 'text-red-600',
    border: 'border-red-300',
  },
  no_show: {
    bg: 'bg-orange-50',
    text: 'text-orange-600',
    border: 'border-orange-300',
  },
  external_busy: {
    bg: 'bg-violet-50',
    text: 'text-violet-700',
    border: 'border-violet-300',
  },
  external_free: {
    bg: 'bg-emerald-50',
    text: 'text-emerald-700',
    border: 'border-emerald-300',
  },
  needs_details: {
    bg: 'bg-amber-50',
    text: 'text-amber-800',
    border: 'border-amber-300',
  },
};

/**
 * Spoken summary of the availability facts a day cell shows visually, so the
 * closed / off / blocked marks are never colour- or glyph-only.
 */
function describeAvailability(availability: CalendarDayAvailability | null): string {
  if (!availability) {
    return '';
  }
  const parts: string[] = [];
  if (availability.closed) {
    parts.push('Salon closed.');
  }
  if (availability.techniciansOff.length > 0) {
    parts.push(`${availability.techniciansOff.map(entry => entry.name).join(', ')} off.`);
  }
  if (availability.blockedWindows.length > 0) {
    parts.push(
      `${availability.blockedWindows.length} blocked ${availability.blockedWindows.length === 1 ? 'window' : 'windows'}.`,
    );
  }
  return parts.join(' ');
}

// Day Cell Component
type DayCellProps = {
  date: Date;
  count: number;
  appointmentCount: number;
  googleBusyCount: number;
  isCurrentMonth: boolean;
  isSelected: boolean;
  onClick: () => void;
  viewMode: ViewMode;
  availability: CalendarDayAvailability | null;
};

function DayCell({
  date,
  count,
  appointmentCount,
  googleBusyCount,
  isCurrentMonth,
  isSelected,
  onClick,
  viewMode,
  availability,
}: DayCellProps) {
  const today = isToday(date);
  const dayLabel = date.toLocaleDateString('en-CA', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
  const closed = availability?.closed ?? false;
  const offCount = availability?.techniciansOff.length ?? 0;
  const blockedCount = availability?.blockedWindows.length ?? 0;

  return (
    <motion.button
      type="button"
      aria-label={`${dayLabel}. ${appointmentCount} Luster ${appointmentCount === 1 ? 'appointment' : 'appointments'}. ${googleBusyCount} Google busy ${googleBusyCount === 1 ? 'event' : 'events'}. ${describeAvailability(availability)}`.trim()}
      aria-pressed={isSelected}
      data-testid={`calendar-day-${formatDateKey(date)}`}
      data-selected={isSelected ? 'true' : 'false'}
      data-closed={closed ? 'true' : 'false'}
      data-off-count={offCount}
      data-blocked-count={blockedCount}
      onClick={onClick}
      whileTap={{ scale: 0.95 }}
      className={`
        relative flex min-w-0 flex-col items-center justify-center overflow-hidden rounded-xl transition-all
        ${viewMode === 'weekly' ? 'min-h-[72px] py-1.5' : 'aspect-square min-h-[44px]'}
        ${
    isSelected
      ? 'bg-rose-800 text-white shadow-lg shadow-rose-900/20'
      : closed
        ? 'border border-dashed border-stone-300 bg-stone-100/80 bg-[repeating-linear-gradient(45deg,transparent,transparent_3px,rgba(120,113,108,0.10)_3px,rgba(120,113,108,0.10)_6px)] text-stone-500'
        : today
          ? 'bg-rose-50 text-rose-700'
          : isCurrentMonth
            ? 'bg-white text-gray-900 hover:bg-gray-50'
            : 'bg-gray-50/50 text-gray-400'
    }
        ${count > 0 && !isSelected && !closed ? 'ring-1 ring-rose-200' : ''}
      `}
    >
      <span className="text-sm font-semibold">
        {date.getDate()}
      </span>

      {closed && (
        <span
          className={`mt-0.5 text-[9px] font-semibold uppercase tracking-wide ${isSelected ? 'text-white/90' : 'text-stone-500'}`}
        >
          Closed
        </span>
      )}

      {/*
        One metadata line under the date: the count and the availability marks
        share it so a busy day that is also an off day still fits a 44 px cell
        without clipping either.
      */}
      {!closed && (count > 0 || offCount > 0 || blockedCount > 0) && (
        <span className="mt-px flex max-w-full items-center justify-center gap-1 leading-none">
          {count > 0 && (
            <span
              className={`truncate text-[10px] font-bold ${isSelected ? 'text-white/90' : 'text-rose-800'}`}
            >
              {appointmentCount > 0
              && `${appointmentCount} ${appointmentCount === 1 ? 'appt' : 'appts'}`}
              {appointmentCount > 0 && googleBusyCount > 0 && ' · '}
              {googleBusyCount > 0 && `${googleBusyCount} busy`}
            </span>
          )}
          {offCount > 0 && (
            <span
              aria-hidden="true"
              data-testid={`calendar-day-off-${formatDateKey(date)}`}
              className={`inline-flex h-3 shrink-0 items-center rounded-full px-1 text-[9px] font-bold leading-none ${isSelected ? 'bg-white/25 text-white' : 'bg-amber-100 text-amber-800'}`}
            >
              {offCount > 1 ? `${offCount} off` : 'off'}
            </span>
          )}
          {blockedCount > 0 && (
            <span
              aria-hidden="true"
              data-testid={`calendar-day-blocked-${formatDateKey(date)}`}
              className={`size-1.5 shrink-0 rounded-full ${isSelected ? 'bg-white/70' : 'bg-slate-400'}`}
            />
          )}
        </span>
      )}

      {today && !isSelected && (
        <div className="absolute bottom-1 size-1.5 rounded-full bg-rose-700" />
      )}
    </motion.button>
  );
}

/**
 * The non-bookable facts for a day, in words: the salon being closed, who is
 * off, and every blocked window — the three authorities the booking engine
 * enforces and the calendar used to hide (AG-today-calendar-04).
 */
function DayAvailabilityNotes({
  availability,
  compact = false,
}: {
  availability: CalendarDayAvailability | null;
  compact?: boolean;
}) {
  if (!availability) {
    return null;
  }

  const { closed, techniciansOff, blockedWindows } = availability;
  if (!closed && techniciansOff.length === 0 && blockedWindows.length === 0) {
    return null;
  }

  return (
    <div
      data-testid="calendar-day-availability"
      className={`flex flex-wrap items-center gap-1.5 ${compact ? '' : 'mt-2'}`}
    >
      {closed && (
        <span
          data-testid="calendar-day-availability-closed"
          className="inline-flex items-center rounded-full border border-stone-300 bg-stone-100 px-2 py-0.5 text-[11px] font-semibold text-stone-700"
        >
          Closed — salon hours
        </span>
      )}
      {techniciansOff.map(entry => (
        <span
          key={entry.id}
          data-testid={`calendar-day-availability-off-${entry.id}`}
          className="inline-flex items-center rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-800"
        >
          {entry.name}
          {' off'}
          {entry.reason ? ` · ${entry.reason}` : ''}
        </span>
      ))}
      {blockedWindows.map(window => (
        <span
          key={window.id}
          data-testid={`calendar-day-availability-blocked-${window.id}`}
          className="inline-flex items-center rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] font-semibold text-slate-700"
        >
          {window.technicianName ? `${window.technicianName} · ` : ''}
          {formatMinutesLabel(window.startMinutes)}
          {' – '}
          {formatMinutesLabel(window.endMinutes)}
          {' · '}
          {window.label || 'Blocked'}
        </span>
      ))}
    </div>
  );
}

// Day Detail Panel
type DayDetailPanelProps = {
  date: Date;
  appointments: AppointmentSummary[];
  availability: CalendarDayAvailability | null;
  onClose: () => void;
  onConvertGoogleEvent: (appointment: AppointmentSummary) => void;
  onSelectAppointment: (appointmentId: string) => void;
};

function DayDetailPanel({
  date,
  appointments,
  availability,
  onClose,
  onConvertGoogleEvent,
  onSelectAppointment,
}: DayDetailPanelProps) {
  const dayName = date.toLocaleDateString('en-US', { weekday: 'long' });
  const dateStr = date.toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
  const appointmentCountLabel
    = appointments.length === 1 ? 'appointment' : 'appointments';

  // Group appointments by technician
  const byTechnician = useMemo(() => {
    const groups: Record<string, AppointmentSummary[]> = {};

    for (const appt of appointments) {
      const tech = appt.technician || 'Unassigned';
      if (!groups[tech]) {
        groups[tech] = [];
      }
      groups[tech].push(appt);
    }

    // Sort each group by start time
    for (const tech of Object.keys(groups)) {
      groups[tech]!.sort(
        (a, b) =>
          new Date(a.startTime).getTime() - new Date(b.startTime).getTime(),
      );
    }

    return groups;
  }, [appointments]);

  return (
    <motion.div
      role="dialog"
      aria-modal="true"
      aria-labelledby="calendar-day-details-title"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 20 }}
      transition={{ type: 'spring', damping: 25, stiffness: 300 }}
      className="relative w-full overflow-hidden"
    >
      {/* Header */}
      <div className="sticky top-0 z-10 border-b border-gray-100 bg-white px-5 pb-4 pt-5">
        <div className="mb-2 flex items-center justify-between">
          <div>
            <h3 id="calendar-day-details-title" className="text-xl font-bold text-gray-900">{dayName}</h3>
            <p className="text-sm text-gray-500">{dateStr}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close day details"
            className="flex size-11 items-center justify-center rounded-full bg-gray-100 transition-colors hover:bg-gray-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-950"
          >
            <X className="size-5 text-gray-600" />
          </button>
        </div>
        <div className="flex items-center gap-2 text-sm text-gray-600">
          <Calendar className="size-4" />
          <span>
            {appointments.length}
            {' '}
            {appointmentCountLabel}
          </span>
          {availability?.openMinutes != null && availability.closeMinutes != null && (
            <span className="text-xs text-gray-500">
              ·
              {' '}
              Open
              {' '}
              {formatMinutesLabel(availability.openMinutes)}
              {' – '}
              {formatMinutesLabel(availability.closeMinutes)}
            </span>
          )}
        </div>
        <DayAvailabilityNotes availability={availability} />
      </div>

      {/* Content */}
      <div
        className="overflow-y-auto p-5"
        style={{
          maxHeight: 'calc(70dvh - 100px)',
          paddingBottom: 'max(env(safe-area-inset-bottom, 0px), 20px)',
        }}
      >
        {appointments.length === 0 && (
          <div className="flex flex-col items-center justify-center py-12">
            <div className="mb-3 flex size-14 items-center justify-center rounded-full bg-gray-100">
              <Calendar className="size-7 text-gray-400" />
            </div>
            <p className="text-sm font-medium text-gray-500">
              No appointments scheduled
            </p>
          </div>
        )}
        {appointments.length > 0 && (
          <div className="space-y-6">
            {Object.entries(byTechnician).map(([techName, appts]) => (
              <div key={techName}>
                {/* Technician Header */}
                <div className="mb-3 flex items-center gap-2">
                  <div className="flex size-8 items-center justify-center rounded-full bg-gradient-to-br from-[#4facfe] to-[#00f2fe] text-xs font-bold text-white">
                    {techName
                      .split(' ')
                      .map(n => n[0])
                      .join('')
                      .slice(0, 2)
                      .toUpperCase()}
                  </div>
                  <span className="text-sm font-semibold text-gray-900">
                    {techName}
                  </span>
                  <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600">
                    {appts.length}
                    {' '}
                    appt
                    {appts.length !== 1 ? 's' : ''}
                  </span>
                </div>

                {/* Appointments List */}
                <div className="space-y-2">
                  {appts.map((appt, idx) => {
                    const statusColors
                      = STATUS_COLORS[appt.status] ?? STATUS_COLORS.confirmed!;
                    const isCrmAppointment = appt.source !== 'google';

                    return (
                      <motion.div
                        key={appt.id}
                        initial={{ opacity: 0, x: -10 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ delay: idx * 0.05 }}
                        data-testid={isCrmAppointment ? `day-detail-appointment-${appt.id}` : `day-detail-google-${appt.id}`}
                        data-dialog-return-focus-key={isCrmAppointment ? `appointment-${appt.id}` : undefined}
                        role={isCrmAppointment ? 'button' : undefined}
                        tabIndex={isCrmAppointment ? 0 : undefined}
                        onClick={isCrmAppointment ? () => onSelectAppointment(appt.id) : undefined}
                        onKeyDown={isCrmAppointment
                          ? (event) => {
                              if (event.key === 'Enter' || event.key === ' ') {
                                event.preventDefault();
                                onSelectAppointment(appt.id);
                              }
                            }
                          : undefined}
                        className={`
                          rounded-xl border p-3
                          ${isCrmAppointment ? 'min-h-11 cursor-pointer text-left transition-transform active:scale-[0.99]' : ''}
                          ${statusColors!.bg} ${statusColors!.border}
                        `}
                      >
                        <div className="flex items-start justify-between">
                          <div className="flex-1">
                            {/* Client Name & Time */}
                            <div className="flex items-center gap-2">
                              <User
                                className={`size-4 ${statusColors!.text}`}
                              />
                              <span
                                className={`font-semibold ${statusColors!.text}`}
                              >
                                {appt.clientName || 'Guest'}
                              </span>
                              {appt.source === 'google' && (
                                <span className="rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-bold text-blue-700">
                                  Google
                                </span>
                              )}
                            </div>

                            {/* Services */}
                            <p className="mt-1 text-sm text-gray-600">
                              {appt.services.join(', ') || 'Service'}
                            </p>
                          </div>

                          {/* Time & Duration */}
                          <div className="text-right">
                            <div
                              className={`flex items-center gap-1 text-sm font-semibold ${statusColors!.text}`}
                            >
                              <Clock className="size-3.5" />
                              {formatTime(appt.startTime, appt.timeZone)}
                            </div>
                            <p className="mt-0.5 text-xs text-gray-500">
                              {calculateDuration(appt.startTime, appt.endTime)}
                            </p>
                          </div>
                        </div>

                        {/* Status Badge */}
                        <div className="mt-2 flex items-center justify-between">
                          <span
                            className={`
                            inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide
                            ${statusColors!.bg} ${statusColors!.text} border ${statusColors!.border}
                          `}
                          >
                            {formatAppointmentStatus(appt.status)}
                          </span>
                          <span className="text-xs text-gray-400">
                            {formatTime(appt.startTime, appt.timeZone)}
                            {' '}
                            -
                            {formatTime(appt.endTime, appt.timeZone)}
                          </span>
                        </div>
                        {appt.source === 'google'
                        && appt.googleEventReviewId && (
                          <button
                            type="button"
                            onClick={() => onConvertGoogleEvent(appt)}
                            className="mt-3 w-full rounded-lg bg-rose-800 px-3 py-2 text-xs font-semibold text-white"
                          >
                            Convert to appointment
                          </button>
                        )}
                      </motion.div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </motion.div>
  );
}

// Main Component
export function ScheduleCalendarModal({ onClose, salonSlug: salonSlugProp }: ScheduleCalendarModalProps) {
  const { salonSlug: contextSalonSlug } = useSalon();
  const salonSlug = salonSlugProp?.trim() || contextSalonSlug;
  const [viewMode, setViewMode] = useState<ViewMode>('monthly');
  const [scheduleFilter, setScheduleFilter] = useState<ScheduleFilter>('all');
  const [currentDate, setCurrentDate] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [appointmentData, setAppointmentData] = useState<
    Map<string, DaySummary>
  >(new Map());
  const [schedule, setSchedule] = useState<CalendarSchedule>(EMPTY_CALENDAR_SCHEDULE);
  // 'all' or a technician id: filters the grid counts, the weekly agenda and
  // the day panel together, so one owner question ("what is Tiffany's week?")
  // has one answer everywhere (AG-today-calendar-04).
  const [technicianFilter, setTechnicianFilter] = useState<string>('all');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showNewAppointmentModal, setShowNewAppointmentModal] = useState(false);
  const [googleEventPrefill, setGoogleEventPrefill]
    = useState<AppointmentSummary | null>(null);
  const [rebookPrefill, setRebookPrefill] = useState<RebookPrefill | null>(null);

  // Source-filter chip row: five chips overflow 390 px, so the row scrolls and
  // shows a fade cue until the owner has scrolled to the end.
  const filterRowRef = useRef<HTMLDivElement | null>(null);
  const [filterOverflow, setFilterOverflow] = useState(false);
  const updateFilterOverflow = useCallback(() => {
    const row = filterRowRef.current;
    if (!row) {
      return;
    }
    // 1px tolerance for sub-pixel scroll widths.
    setFilterOverflow(row.scrollWidth - row.clientWidth - row.scrollLeft > 1);
  }, []);

  useEffect(() => {
    updateFilterOverflow();
    if (typeof window === 'undefined') {
      return;
    }
    window.addEventListener('resize', updateFilterOverflow);
    return () => window.removeEventListener('resize', updateFilterOverflow);
  }, [updateFilterOverflow]);

  // Calculate date range based on view mode
  const dateRange = useMemo(() => {
    if (viewMode === 'weekly') {
      const start = getWeekStart(currentDate);
      const weekEnd = new Date(start);
      weekEnd.setDate(weekEnd.getDate() + 6);
      return { start, end: weekEnd };
    } else {
      // Extend range to include padding days
      const start = getMonthStart(currentDate);
      const firstDayPadding = start.getDay();
      const adjustedStart = new Date(start);
      adjustedStart.setDate(adjustedStart.getDate() - firstDayPadding);
      const lastDay = new Date(start.getFullYear(), start.getMonth() + 1, 0);
      const lastDayPadding = 6 - lastDay.getDay();
      const adjustedEnd = new Date(lastDay);
      adjustedEnd.setDate(adjustedEnd.getDate() + lastDayPadding);
      return { start: adjustedStart, end: adjustedEnd };
    }
  }, [viewMode, currentDate]);

  // Get days to display
  const displayDays = useMemo(() => {
    if (viewMode === 'weekly') {
      return getWeekDays(getWeekStart(currentDate));
    }
    return getMonthDays(currentDate);
  }, [viewMode, currentDate]);

  // Fetch appointments for the date range
  const fetchAppointments = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      const startStr = formatDateKey(dateRange.start);
      const endStr = formatDateKey(dateRange.end);

      const externalRangeEnd = new Date(dateRange.end);
      externalRangeEnd.setDate(externalRangeEnd.getDate() + 1);
      const fetchGoogleEvents = async () => {
        if (!salonSlug) {
          return null;
        }

        const controller = new AbortController();
        const timeout = window.setTimeout(() => controller.abort(), 5000);
        try {
          return await fetch(
            `/api/integrations/google/events?${new URLSearchParams({
              salonSlug,
              startTime: dateRange.start.toISOString(),
              endTime: externalRangeEnd.toISOString(),
            }).toString()}`,
            { signal: controller.signal },
          );
        } catch {
          return null;
        } finally {
          window.clearTimeout(timeout);
        }
      };
      const [response, googleResponse] = await Promise.all([
        fetch(
          `/api/admin/appointments?startDate=${startStr}&endDate=${endStr}&status=pending,confirmed,in_progress,awaiting_payment,completed`,
        ),
        fetchGoogleEvents(),
      ]);

      if (!response.ok) {
        throw new Error('Failed to load appointments');
      }

      const result = await response.json();
      const rawAppointments = result.data?.appointments || [];
      const salonTimeZone = result.meta?.timeZone || 'America/Toronto';
      setSchedule(
        result.data?.schedule
          ? { ...EMPTY_CALENDAR_SCHEDULE, ...result.data.schedule } as CalendarSchedule
          : EMPTY_CALENDAR_SCHEDULE,
      );
      const googlePayload = googleResponse?.ok
        ? await googleResponse.json()
        : null;
      const externalEvents = googlePayload?.data?.events || [];

      // Group appointments by date
      const dataMap = new Map<string, DaySummary>();

      for (const appt of rawAppointments) {
        const dateKey = formatDateKeyInTimeZone(
          new Date(appt.startTime),
          salonTimeZone,
        );
        const existing = dataMap.get(dateKey);

        const summary: AppointmentSummary = {
          id: appt.id,
          clientName: appt.clientName || 'Guest',
          startTime: appt.startTime,
          endTime: appt.endTime,
          services: appt.services?.map((s: { name: string }) => s.name) || [],
          technician: appt.technician?.name || null,
          technicianId: appt.technician?.id || null,
          status: appt.status,
          source: 'luster',
          timeZone: salonTimeZone,
        };

        if (existing) {
          existing.count++;
          existing.appointmentCount++;
          existing.appointments.push(summary);
        } else {
          dataMap.set(dateKey, {
            date: dateKey,
            count: 1,
            appointmentCount: 1,
            googleBusyCount: 0,
            googleFreeCount: 0,
            appointments: [summary],
          });
        }
      }

      for (const event of externalEvents) {
        if (event.appointmentId) {
          continue;
        }
        const dateKey = formatDateKeyInTimeZone(
          new Date(event.startTime),
          salonTimeZone,
        );
        const existing = dataMap.get(dateKey);
        const summary: AppointmentSummary = {
          id: `google:${event.id}`,
          clientName: event.label || 'Google Calendar event',
          startTime: event.startTime,
          endTime: event.endTime,
          services: [
            event.reviewStatus === 'needs_review'
              ? 'Needs review'
              : event.transparency === 'free'
                ? 'Free Google event'
                : 'Busy time',
          ],
          technician: null,
          technicianId: null,
          status:
            event.reviewStatus === 'needs_review'
              ? 'needs_details'
              : event.transparency === 'free'
                ? 'external_free'
                : 'external_busy',
          source: 'google',
          transparency: event.transparency,
          reviewStatus: event.reviewStatus,
          googleEventReviewId: event.id,
          isReadOnly: event.isReadOnly,
          description: event.description,
          location: event.location,
          sourceVersion: event.lastSyncedAt,
          suggestedClient: event.suggestedClient,
          timeZone: salonTimeZone,
        };
        if (existing) {
          existing.count++;
          if (event.transparency === 'free') {
            existing.googleFreeCount++;
          } else {
            existing.googleBusyCount++;
          }
          existing.appointments.push(summary);
        } else {
          dataMap.set(dateKey, {
            date: dateKey,
            count: 1,
            appointmentCount: 0,
            googleBusyCount: event.transparency === 'free' ? 0 : 1,
            googleFreeCount: event.transparency === 'free' ? 1 : 0,
            appointments: [summary],
          });
        }
      }

      setGoogleEventPrefill((active) => {
        if (!active?.googleEventReviewId) {
          return active;
        }
        const refreshed = externalEvents.find((event: { id: string }) => event.id === active.googleEventReviewId);
        if (!refreshed) {
          return active;
        }
        return {
          ...active,
          clientName: refreshed.label || active.clientName,
          startTime: refreshed.startTime,
          endTime: refreshed.endTime,
          isReadOnly: refreshed.isReadOnly,
          description: refreshed.description,
          location: refreshed.location,
          sourceVersion: refreshed.lastSyncedAt,
          suggestedClient: refreshed.suggestedClient,
        };
      });

      setAppointmentData(dataMap);
    } catch (err) {
      console.error('Failed to fetch appointments:', err);
      setError('Failed to load appointments');
    } finally {
      setLoading(false);
    }
  }, [dateRange, salonSlug]);

  useEffect(() => {
    fetchAppointments();
  }, [fetchAppointments]);

  /*
    A create, move, cancel or status change made anywhere in the workspace
    (Today, the walk-in sheet, a client profile, the staff app in another tab)
    announces itself on APPOINTMENT_DATA_CHANGED_EVENT. The calendar refetches
    on it so an open calendar is never stale, coalesced on a short timer
    because one mutation fires the event and the action callback below.
  */
  const refreshTimerRef = useRef<number | null>(null);
  const fetchAppointmentsRef = useRef(fetchAppointments);
  fetchAppointmentsRef.current = fetchAppointments;

  const scheduleRefresh = useCallback(() => {
    if (typeof window === 'undefined') {
      void fetchAppointmentsRef.current();
      return;
    }
    if (refreshTimerRef.current !== null) {
      window.clearTimeout(refreshTimerRef.current);
    }
    refreshTimerRef.current = window.setTimeout(() => {
      refreshTimerRef.current = null;
      void fetchAppointmentsRef.current();
    }, 60);
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }
    window.addEventListener(APPOINTMENT_DATA_CHANGED_EVENT, scheduleRefresh);
    return () => {
      window.removeEventListener(APPOINTMENT_DATA_CHANGED_EVENT, scheduleRefresh);
      if (refreshTimerRef.current !== null) {
        window.clearTimeout(refreshTimerRef.current);
        refreshTimerRef.current = null;
      }
    };
  }, [scheduleRefresh]);

  // Shared appointment-management actions: any change refreshes the visible
  // range so day counts and the day panel stay consistent.
  const actions = useAppointmentActions({
    salonSlug,
    onMutationApplied: scheduleRefresh,
    onCancelled: scheduleRefresh,
    onOptimisticStatus: scheduleRefresh,
  });

  // Navigation handlers
  const handlePrev = () => {
    setCurrentDate((prev) => {
      const d = new Date(prev);
      if (viewMode === 'weekly') {
        d.setDate(d.getDate() - 7);
      } else {
        d.setMonth(d.getMonth() - 1);
      }
      return d;
    });
    setSelectedDate(null);
  };

  const handleNext = () => {
    setCurrentDate((prev) => {
      const d = new Date(prev);
      if (viewMode === 'weekly') {
        d.setDate(d.getDate() + 7);
      } else {
        d.setMonth(d.getMonth() + 1);
      }
      return d;
    });
    setSelectedDate(null);
  };

  const handleToday = () => {
    setCurrentDate(new Date());
    setSelectedDate(null);
  };

  const handleDayClick = (date: Date) => {
    setSelectedDate(date);
  };

  /*
    One predicate for both filters, applied to the day-cell counts as well as
    the day panel: a chip that changes the panel but not the count it came from
    reads as a bug (source-map I-032), and a technician filter that left the
    counts alone would answer the wrong question entirely.
  */
  const matchesFilters = useCallback(
    (appointment: AppointmentSummary) => {
      if (technicianFilter !== 'all' && appointment.technicianId !== technicianFilter) {
        return false;
      }
      if (scheduleFilter === 'appointments') {
        return appointment.source === 'luster';
      }
      if (scheduleFilter === 'google_busy') {
        return (
          appointment.source === 'google' && appointment.transparency === 'busy'
        );
      }
      if (scheduleFilter === 'free') {
        return (
          appointment.source === 'google' && appointment.transparency === 'free'
        );
      }
      if (scheduleFilter === 'needs_review') {
        return (
          appointment.source === 'google'
          && appointment.reviewStatus === 'needs_review'
        );
      }
      return true;
    },
    [scheduleFilter, technicianFilter],
  );

  const visibleData = useMemo(() => {
    const next = new Map<string, DaySummary>();
    for (const [dateKey, summary] of appointmentData) {
      const appointments = summary.appointments.filter(matchesFilters);
      next.set(dateKey, {
        date: dateKey,
        count: appointments.length,
        appointmentCount: appointments.filter(item => item.source === 'luster').length,
        googleBusyCount: appointments.filter(
          item => item.source === 'google' && item.transparency !== 'free',
        ).length,
        googleFreeCount: appointments.filter(
          item => item.source === 'google' && item.transparency === 'free',
        ).length,
        appointments,
      });
    }
    return next;
  }, [appointmentData, matchesFilters]);

  const availabilityByDate = useMemo(() => {
    const next = new Map<string, CalendarDayAvailability>();
    const technicianId = technicianFilter === 'all' ? null : technicianFilter;
    for (const date of displayDays) {
      const dateKey = formatDateKey(date);
      next.set(dateKey, getDayAvailability(schedule, dateKey, { technicianId }));
    }
    return next;
  }, [displayDays, schedule, technicianFilter]);

  const selectedDateKey = selectedDate ? formatDateKey(selectedDate) : null;
  const selectedAppointments = selectedDateKey
    ? visibleData.get(selectedDateKey)?.appointments ?? []
    : [];
  const selectedAvailability = selectedDateKey
    ? availabilityByDate.get(selectedDateKey)
    ?? getDayAvailability(schedule, selectedDateKey, {
      technicianId: technicianFilter === 'all' ? null : technicianFilter,
    })
    : null;

  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  return (
    <div className="flex min-h-full w-full flex-col bg-[#FFF8F5] font-sans text-black">
      {/* Header */}
      <ModalHeader
        title="Schedule"
        subtitle={
          viewMode === 'weekly'
            ? formatWeekRange(getWeekStart(currentDate))
            : formatMonthYear(currentDate)
        }
        leftAction={<BackButton onClick={onClose} label="Back" />}
        rightAction={(
          <button
            type="button"
            onClick={handleToday}
            className="text-[15px] font-medium text-rose-800 transition-opacity active:opacity-50"
          >
            Today
          </button>
        )}
      />

      {/* View Mode Toggle */}
      <div className="flex justify-center border-b border-gray-200 bg-white px-4 pb-3 pt-2">
        <div className="flex rounded-lg bg-gray-100 p-1">
          <button
            type="button"
            onClick={() => setViewMode('weekly')}
            className={`
              rounded-md px-4 py-1.5 text-sm font-medium transition-all
              ${
    viewMode === 'weekly'
      ? 'bg-white text-gray-900 shadow-sm'
      : 'text-gray-600 hover:text-gray-900'
    }
            `}
          >
            Weekly
          </button>
          <button
            type="button"
            onClick={() => setViewMode('monthly')}
            className={`
              rounded-md px-4 py-1.5 text-sm font-medium transition-all
              ${
    viewMode === 'monthly'
      ? 'bg-white text-gray-900 shadow-sm'
      : 'text-gray-600 hover:text-gray-900'
    }
            `}
          >
            Monthly
          </button>
        </div>
      </div>

      {/* Navigation */}
      <div className="flex items-center justify-between bg-white px-4 py-3">
        <button
          type="button"
          onClick={handlePrev}
          aria-label={
            viewMode === 'weekly' ? 'Previous week' : 'Previous month'
          }
          className="flex size-10 items-center justify-center rounded-full transition-colors hover:bg-gray-100 active:bg-gray-200"
        >
          <ChevronLeft className="size-6 text-gray-600" />
        </button>

        <h2 className="text-lg font-semibold text-gray-900">
          {viewMode === 'weekly'
            ? formatWeekRange(getWeekStart(currentDate))
            : formatMonthYear(currentDate)}
        </h2>

        <button
          type="button"
          onClick={handleNext}
          aria-label={viewMode === 'weekly' ? 'Next week' : 'Next month'}
          className="flex size-10 items-center justify-center rounded-full transition-colors hover:bg-gray-100 active:bg-gray-200"
        >
          <ChevronRight className="size-6 text-gray-600" />
        </button>
      </div>

      {/* Calendar Grid */}
      <div className="flex-1 overflow-y-auto bg-white px-3 pb-24">
        {/*
          Five chips do not fit at 390 px. The row scrolls horizontally and a
          right-edge fade advertises the overflow; trailing padding keeps the
          last chip from sitting flush against the clip (AG-today-calendar-10).
        */}
        <div className="relative py-3">
          <div
            ref={filterRowRef}
            onScroll={updateFilterOverflow}
            role="group"
            aria-label="Calendar source filter"
            data-testid="calendar-filter-row"
            className="scrollbar-hide flex gap-2 overflow-x-auto pr-7"
          >
            {(
              [
                ['all', 'All'],
                ['appointments', 'Appointments'],
                ['google_busy', 'Google Busy'],
                ['free', 'Free Events'],
                ['needs_review', 'Needs Review'],
              ] as Array<[ScheduleFilter, string]>
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                onClick={() => setScheduleFilter(id)}
                aria-pressed={scheduleFilter === id}
                className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-semibold outline-none transition-colors focus-visible:ring-2 focus-visible:ring-[var(--owner-focus,#b85075)] focus-visible:ring-offset-1 ${scheduleFilter === id ? 'bg-[var(--owner-accent,#8b3151)] text-white' : 'bg-stone-100 text-stone-600'}`}
              >
                {label}
              </button>
            ))}
          </div>
          <div
            aria-hidden="true"
            data-testid="calendar-filter-overflow-cue"
            className={`pointer-events-none absolute inset-y-3 right-0 w-8 bg-gradient-to-l from-white via-white/85 to-transparent transition-opacity duration-200 ${
              filterOverflow ? 'opacity-100' : 'opacity-0'
            }`}
          />
        </div>

        {schedule.technicians.length > 0 && (
          <div
            role="group"
            aria-label="Filter calendar by technician"
            data-testid="calendar-technician-filter"
            className="scrollbar-hide -mt-1 mb-2 flex gap-2 overflow-x-auto pb-1"
          >
            {[{ id: 'all', name: 'All team' }, ...schedule.technicians].map(technician => (
              <button
                key={technician.id}
                type="button"
                onClick={() => setTechnicianFilter(technician.id)}
                aria-pressed={technicianFilter === technician.id}
                data-testid={`calendar-technician-chip-${technician.id}`}
                className={`shrink-0 rounded-full border px-3 py-1.5 text-xs font-semibold outline-none transition-colors focus-visible:ring-2 focus-visible:ring-[var(--owner-focus,#b85075)] focus-visible:ring-offset-1 ${
                  technicianFilter === technician.id
                    ? 'border-transparent bg-stone-900 text-white'
                    : 'border-stone-200 bg-white text-stone-600'
                }`}
              >
                {technician.name}
              </button>
            ))}
          </div>
        )}
        {/* Day Names Header */}
        <div className="sticky top-0 z-10 grid grid-cols-7 gap-1 bg-white py-2">
          {dayNames.map(day => (
            <div
              key={day}
              className="text-center text-xs font-semibold uppercase tracking-wide text-gray-500"
            >
              {day}
            </div>
          ))}
        </div>

        {loading && (
          <div
            role="status"
            className="mb-2 flex items-center justify-center gap-2 text-xs font-medium text-stone-500"
          >
            <span className="size-3 animate-spin rounded-full border-2 border-rose-200 border-t-rose-800" />
            Refreshing schedule…
          </div>
        )}

        {error && (
          <div className="mb-3 flex items-center justify-between gap-3 rounded-xl border border-red-100 bg-red-50 px-3 py-2">
            <p className="text-xs text-red-700">
              Schedule details could not refresh. Existing calendar dates are
              still available.
            </p>
            <button
              type="button"
              onClick={fetchAppointments}
              className="shrink-0 text-xs font-semibold text-rose-800"
            >
              Try again
            </button>
          </div>
        )}

        <div
          aria-busy={loading}
          className={`grid grid-cols-7 gap-1 ${viewMode === 'weekly' ? 'gap-2' : ''}`}
        >
          {displayDays.map((date) => {
            const dateKey = formatDateKey(date);
            const daySummary = visibleData.get(dateKey);
            const isCurrentMonth = viewMode === 'weekly'
              ? true
              : date.getMonth() === currentDate.getMonth();
            const isSelected = selectedDate
              ? isSameDay(date, selectedDate)
              : false;

            return (
              <DayCell
                key={dateKey}
                date={date}
                count={daySummary?.count || 0}
                appointmentCount={daySummary?.appointmentCount || 0}
                googleBusyCount={daySummary?.googleBusyCount || 0}
                isCurrentMonth={isCurrentMonth}
                isSelected={isSelected}
                onClick={() => handleDayClick(date)}
                viewMode={viewMode}
                availability={availabilityByDate.get(dateKey) ?? null}
              />
            );
          })}
        </div>

        {viewMode === 'weekly' && (
          <div className="mt-4 space-y-3" data-testid="calendar-week-agenda">
            {displayDays.map((date) => {
              const dateKey = formatDateKey(date);
              const daySummary = visibleData.get(dateKey);
              const dayAppointments = [...(daySummary?.appointments ?? [])].sort(
                (a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime(),
              );
              const availability = availabilityByDate.get(dateKey) ?? null;

              return (
                <section
                  key={`agenda-${dateKey}`}
                  data-testid={`calendar-week-agenda-${dateKey}`}
                  className={`rounded-2xl border p-3 ${isToday(date) ? 'border-rose-200 bg-rose-50/40' : 'border-stone-200 bg-white'}`}
                >
                  <div className="flex items-baseline justify-between gap-2">
                    <button
                      type="button"
                      onClick={() => handleDayClick(date)}
                      className="text-left text-sm font-semibold text-stone-900 underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--owner-focus,#b85075)]"
                    >
                      {date.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })}
                    </button>
                    <span className="shrink-0 text-[11px] font-medium text-stone-500">
                      {dayAppointments.length === 0
                        ? 'Nothing booked'
                        : `${dayAppointments.length} ${dayAppointments.length === 1 ? 'entry' : 'entries'}`}
                    </span>
                  </div>

                  <DayAvailabilityNotes availability={availability} />

                  {dayAppointments.length > 0 && (
                    <ul className="mt-2 space-y-1.5">
                      {dayAppointments.map((appointment) => {
                        const statusColors = STATUS_COLORS[appointment.status] ?? STATUS_COLORS.confirmed!;
                        const isCrmAppointment = appointment.source !== 'google';
                        return (
                          <li key={appointment.id}>
                            <button
                              type="button"
                              disabled={!isCrmAppointment}
                              onClick={isCrmAppointment ? () => actions.openAppointment(appointment.id) : undefined}
                              data-testid={`calendar-week-entry-${appointment.id}`}
                              className={`flex w-full items-center gap-2 rounded-xl border px-2.5 py-2 text-left ${statusColors.bg} ${statusColors.border} ${isCrmAppointment ? 'transition-transform active:scale-[0.99]' : 'cursor-default'}`}
                            >
                              <span className={`w-[68px] shrink-0 text-xs font-semibold ${statusColors.text}`}>
                                {formatTime(appointment.startTime, appointment.timeZone)}
                              </span>
                              <span className="min-w-0 flex-1">
                                <span className="block truncate text-sm font-medium text-stone-900">
                                  {appointment.clientName || 'Guest'}
                                </span>
                                <span className="block truncate text-[11px] text-stone-500">
                                  {[appointment.services.join(', ') || 'Service', appointment.technician]
                                    .filter(Boolean)
                                    .join(' · ')}
                                </span>
                              </span>
                              <span className={`shrink-0 text-[10px] font-bold uppercase tracking-wide ${statusColors.text}`}>
                                {formatAppointmentStatus(appointment.status)}
                              </span>
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </section>
              );
            })}
          </div>
        )}

        {/* Legend */}
        <div className="mt-6 flex flex-wrap items-center justify-center gap-4 text-xs text-gray-500">
          <div className="flex items-center gap-1.5">
            <div className="size-3 rounded-full bg-rose-700" />
            <span>Today</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="size-3 rounded border border-rose-200 bg-white" />
            <span>Has Appointments</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="size-3 rounded bg-rose-800" />
            <span>Selected</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="size-3 rounded border border-violet-300 bg-violet-50" />
            <span>Google busy</span>
          </div>
        </div>
      </div>

      {/* Floating Action Button */}
      <button
        type="button"
        onClick={() => setShowNewAppointmentModal(true)}
        aria-label="Add new appointment"
        className="fixed bottom-24 right-6 z-40 flex size-14 items-center justify-center rounded-full bg-rose-800 text-white shadow-[0_4px_16px_rgba(159,18,57,0.3)] transition-transform active:scale-90"
      >
        <Plus className="size-8" />
      </button>

      {/* Day Detail Panel */}
      <DialogShell
        isOpen={Boolean(selectedDate && !showNewAppointmentModal && !actions.selectedAppointmentId)}
        onClose={() => setSelectedDate(null)}
        alignClassName="items-end justify-center p-0"
        maxWidthClassName="max-w-none"
        contentClassName="max-h-[70dvh] overflow-hidden rounded-t-[24px] bg-white shadow-2xl"
      >
        <AnimatePresence>
          {selectedDate && (
            <DayDetailPanel
              date={selectedDate}
              appointments={selectedAppointments}
              availability={selectedAvailability}
              onClose={() => setSelectedDate(null)}
              onConvertGoogleEvent={(appointment) => {
                setGoogleEventPrefill(appointment);
                setShowNewAppointmentModal(true);
              }}
              onSelectAppointment={actions.openAppointment}
            />
          )}
        </AnimatePresence>
      </DialogShell>

      <AppointmentQuickEditSheet
        isOpen={Boolean(actions.selectedAppointmentId)}
        onClose={actions.closeAppointment}
        detail={actions.detail}
        loading={actions.detailLoading}
        saving={actions.detailSaving}
        actionError={actions.detailError}
        attemptedTimeLabel={actions.attemptedTimeLabel}
        warnings={actions.warnings}
        onSaveEdits={actions.saveEdits}
        onMoveToNextAvailable={actions.moveToNextAvailable}
        onCancelAppointment={args => actions.cancelAppointment(args as CancelArgs)}
        onMarkCompleted={() => actions.openCheckout()}
        onStartAppointment={actions.startAppointment}
        onConfirmAppointment={actions.confirmAppointment}
        onDeclineAppointment={actions.declineAppointment}
        onMarkNoShow={actions.markNoShow}
        onResendConfirmation={actions.resendConfirmation}
        onViewReceipt={actions.openReceipt}
        onRetryLoad={() => void actions.refreshDetail()}
        onReminderSent={() => actions.refreshDetail()}
        adminDepositPanelSlot={actions.selectedAppointmentId
          ? <DepositPanel appointmentId={actions.selectedAppointmentId} salonSlug={salonSlug} />
          : null}
        onRebook={() => {
          const prefill = actions.buildRebookPrefill();
          if (!prefill) {
            return;
          }
          setRebookPrefill(prefill);
          actions.closeAppointment();
          setShowNewAppointmentModal(true);
        }}
      />

      <CheckoutSheet
        isOpen={actions.checkoutOpen}
        appointmentId={actions.selectedAppointmentId}
        salonSlug={salonSlug}
        initialView={actions.checkoutInitialView}
        onClose={actions.closeCheckout}
        onCompleted={() => actions.handleCheckoutCompleted()}
        onRebook={() => {
          const prefill = actions.buildRebookPrefill();
          if (!prefill) {
            return;
          }
          setRebookPrefill(prefill);
          actions.closeCheckout();
          actions.closeAppointment();
          setShowNewAppointmentModal(true);
        }}
      />

      {/* New Appointment Modal */}
      <NewAppointmentModal
        isOpen={showNewAppointmentModal}
        salonSlug={salonSlug}
        onClose={() => {
          setShowNewAppointmentModal(false);
          setGoogleEventPrefill(null);
          setRebookPrefill(null);
        }}
        onSuccess={() => {
          // Refresh appointments after creating a new one
          fetchAppointments();
          setGoogleEventPrefill(null);
          setRebookPrefill(null);
        }}
        clientPrefill={rebookPrefill}
        preselectedDate={selectedDate || new Date()}
        googleEventPrefill={
          googleEventPrefill
            ? {
                id: googleEventPrefill.googleEventReviewId!,
                title: googleEventPrefill.clientName,
                startTime: googleEventPrefill.startTime,
                endTime: googleEventPrefill.endTime,
                durationMinutes: Math.max(
                  1,
                  Math.round(
                    (new Date(googleEventPrefill.endTime).getTime()
                      - new Date(googleEventPrefill.startTime).getTime())
                      / 60_000,
                  ),
                ),
                description: googleEventPrefill.description,
                location: googleEventPrefill.location,
                sourceVersion: googleEventPrefill.sourceVersion,
                suggestedClient: googleEventPrefill.suggestedClient,
                isReadOnly: googleEventPrefill.isReadOnly,
              }
            : null
        }
      />
    </div>
  );
}
