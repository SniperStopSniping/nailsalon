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
import { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';

import { formatAppointmentStatus } from '@/libs/appointmentStatusDisplay';
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
  status: string;
  source: 'luster' | 'google';
  transparency?: 'busy' | 'free';
  reviewStatus?: string;
  googleEventReviewId?: string;
  isReadOnly?: boolean;
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
}: DayCellProps) {
  const today = isToday(date);
  const dayLabel = date.toLocaleDateString('en-CA', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });

  return (
    <motion.button
      type="button"
      aria-label={`${dayLabel}. ${appointmentCount} Luster ${appointmentCount === 1 ? 'appointment' : 'appointments'}. ${googleBusyCount} Google busy ${googleBusyCount === 1 ? 'event' : 'events'}.`}
      onClick={onClick}
      whileTap={{ scale: 0.95 }}
      className={`
        relative flex flex-col items-center justify-center rounded-xl transition-all
        ${viewMode === 'weekly' ? 'aspect-[1/1.2] min-h-[80px]' : 'aspect-square min-h-[44px]'}
        ${
    isSelected
      ? 'bg-rose-800 text-white shadow-lg shadow-rose-900/20'
      : today
        ? 'bg-rose-50 text-rose-700'
        : isCurrentMonth
          ? 'bg-white text-gray-900 hover:bg-gray-50'
          : 'bg-gray-50/50 text-gray-400'
    }
        ${count > 0 && !isSelected ? 'ring-1 ring-rose-200' : ''}
      `}
    >
      <span
        className={`text-sm font-semibold ${viewMode === 'weekly' ? 'text-lg' : ''}`}
      >
        {date.getDate()}
      </span>

      {count > 0 && (
        <span
          className={`
            mt-0.5 text-[10px] font-bold
            ${viewMode === 'weekly' ? 'text-xs' : ''}
            ${isSelected ? 'text-white/90' : 'text-rose-800'}
          `}
        >
          {appointmentCount > 0
          && `${appointmentCount} ${appointmentCount === 1 ? 'appt' : 'appts'}`}
          {appointmentCount > 0 && googleBusyCount > 0 && ' · '}
          {googleBusyCount > 0 && `${googleBusyCount} busy`}
        </span>
      )}

      {today && !isSelected && (
        <div className="absolute bottom-1 size-1.5 rounded-full bg-rose-700" />
      )}
    </motion.button>
  );
}

// Day Detail Panel
type DayDetailPanelProps = {
  date: Date;
  appointments: AppointmentSummary[];
  onClose: () => void;
  onConvertGoogleEvent: (appointment: AppointmentSummary) => void;
};

function DayDetailPanel({
  date,
  appointments,
  onClose,
  onConvertGoogleEvent,
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
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 20 }}
      transition={{ type: 'spring', damping: 25, stiffness: 300 }}
      className="relative max-h-[70dvh] w-full overflow-hidden rounded-t-[24px] bg-white shadow-2xl"
    >
      {/* Header */}
      <div className="sticky top-0 z-10 border-b border-gray-100 bg-white px-5 pb-4 pt-5">
        <div className="mb-2 flex items-center justify-between">
          <div>
            <h3 className="text-xl font-bold text-gray-900">{dayName}</h3>
            <p className="text-sm text-gray-500">{dateStr}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close day details"
            className="flex size-9 items-center justify-center rounded-full bg-gray-100 transition-colors hover:bg-gray-200"
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
        </div>
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

                    return (
                      <motion.div
                        key={appt.id}
                        initial={{ opacity: 0, x: -10 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ delay: idx * 0.05 }}
                        className={`
                          rounded-xl border p-3
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
export function ScheduleCalendarModal({ onClose }: ScheduleCalendarModalProps) {
  const { salonSlug } = useSalon();
  const [viewMode, setViewMode] = useState<ViewMode>('monthly');
  const [scheduleFilter, setScheduleFilter] = useState<ScheduleFilter>('all');
  const [currentDate, setCurrentDate] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [appointmentData, setAppointmentData] = useState<
    Map<string, DaySummary>
  >(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showNewAppointmentModal, setShowNewAppointmentModal] = useState(false);
  const [googleEventPrefill, setGoogleEventPrefill]
    = useState<AppointmentSummary | null>(null);
  const [portalReady, setPortalReady] = useState(false);

  useEffect(() => {
    setPortalReady(true);
  }, []);

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
          `/api/admin/appointments?startDate=${startStr}&endDate=${endStr}&status=pending,confirmed,in_progress,completed`,
        ),
        fetchGoogleEvents(),
      ]);

      if (!response.ok) {
        throw new Error('Failed to load appointments');
      }

      const result = await response.json();
      const rawAppointments = result.data?.appointments || [];
      const salonTimeZone = result.meta?.timeZone || 'America/Toronto';
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

  const selectedDateData = selectedDate
    ? appointmentData.get(formatDateKey(selectedDate))
    : null;
  const selectedAppointments = (selectedDateData?.appointments || []).filter(
    (appointment) => {
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
  );

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
        <div className="flex gap-2 overflow-x-auto py-3">
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
              className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-semibold ${scheduleFilter === id ? 'bg-rose-800 text-white' : 'bg-stone-100 text-stone-600'}`}
            >
              {label}
            </button>
          ))}
        </div>
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
            const daySummary = appointmentData.get(dateKey);
            const isCurrentMonth = date.getMonth() === currentDate.getMonth();
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
              />
            );
          })}
        </div>

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
      {portalReady
      && createPortal(
        <AnimatePresence>
          {selectedDate && !showNewAppointmentModal && (
            <>
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="fixed inset-0 z-[70] bg-black/30"
                onClick={() => setSelectedDate(null)}
              />
              <div className="fixed inset-x-0 bottom-0 z-[80]">
                <DayDetailPanel
                  date={selectedDate}
                  appointments={selectedAppointments}
                  onClose={() => setSelectedDate(null)}
                  onConvertGoogleEvent={(appointment) => {
                    setGoogleEventPrefill(appointment);
                    setShowNewAppointmentModal(true);
                  }}
                />
              </div>
            </>
          )}
        </AnimatePresence>,
        document.body,
      )}

      {/* New Appointment Modal */}
      <NewAppointmentModal
        isOpen={showNewAppointmentModal}
        onClose={() => {
          setShowNewAppointmentModal(false);
          setGoogleEventPrefill(null);
        }}
        onSuccess={() => {
          // Refresh appointments after creating a new one
          fetchAppointments();
          setGoogleEventPrefill(null);
        }}
        preselectedDate={selectedDate || new Date()}
        googleEventPrefill={
          googleEventPrefill
            ? {
                id: googleEventPrefill.googleEventReviewId!,
                title: googleEventPrefill.clientName,
                startTime: googleEventPrefill.startTime,
                durationMinutes: Math.max(
                  1,
                  Math.round(
                    (new Date(googleEventPrefill.endTime).getTime()
                      - new Date(googleEventPrefill.startTime).getTime())
                      / 60_000,
                  ),
                ),
                isReadOnly: googleEventPrefill.isReadOnly,
              }
            : null
        }
      />
    </div>
  );
}
