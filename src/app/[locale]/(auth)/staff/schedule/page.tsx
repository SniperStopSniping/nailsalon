'use client';

/**
 * Staff Schedule Page
 *
 * Allows staff to:
 * - View/edit weekly schedule
 * - Request time off (submit requests for admin approval)
 * - View/edit schedule overrides (if module enabled)
 *
 * EDIT 2: Staff cannot directly write time off - must submit requests only.
 */

import { useParams, useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';

import { ModuleSkeleton, StaffBottomNav, StaffHeader, UpgradeRequiredState } from '@/components/staff';
import { useStaffCapabilities } from '@/hooks/useStaffCapabilities';
import { useSalon } from '@/providers/SalonProvider';
import { themeVars } from '@/theme';

// Staff auth state (cookie-based, NOT Clerk)
type StaffAuthState = 'loading' | 'authed' | 'unauthed';

// =============================================================================
// Types
// =============================================================================

type DaySchedule = { start: string; end: string } | null;

type WeeklySchedule = {
  sunday?: DaySchedule;
  monday?: DaySchedule;
  tuesday?: DaySchedule;
  wednesday?: DaySchedule;
  thursday?: DaySchedule;
  friday?: DaySchedule;
  saturday?: DaySchedule;
};

type TimeOffRequest = {
  id: string;
  startDate: string;
  endDate: string;
  note: string | null;
  status: 'PENDING' | 'APPROVED' | 'DENIED';
  decidedAt: string | null;
  createdAt: string;
};

type ScheduleOverride = {
  id: string;
  date: string;
  type: 'off' | 'hours';
  startTime: string | null;
  endTime: string | null;
  note: string | null;
};

const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'] as const;
const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const TIME_OPTIONS = [
  '08:00',
  '08:30',
  '09:00',
  '09:30',
  '10:00',
  '10:30',
  '11:00',
  '11:30',
  '12:00',
  '12:30',
  '13:00',
  '13:30',
  '14:00',
  '14:30',
  '15:00',
  '15:30',
  '16:00',
  '16:30',
  '17:00',
  '17:30',
  '18:00',
  '18:30',
  '19:00',
  '19:30',
  '20:00',
];

// =============================================================================
// Day Schedule Editor
// =============================================================================

function DayScheduleEditor({
  label,
  schedule,
  onChange,
}: {
  label: string;
  schedule: DaySchedule;
  onChange: (schedule: DaySchedule) => void;
}) {
  const isOff = schedule === null;

  return (
    <div
      className="rounded-xl p-3"
      style={{ backgroundColor: isOff ? '#f5f5f5' : themeVars.surfaceAlt }}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="w-10 text-sm font-bold">{label}</span>
          {isOff
            ? (
                <span className="text-sm text-neutral-500">Day Off</span>
              )
            : (
                <div className="flex items-center gap-1">
                  <select
                    value={schedule?.start || '09:00'}
                    onChange={e => onChange({ start: e.target.value, end: schedule?.end || '17:00' })}
                    className="rounded-lg border-0 bg-white px-2 py-1 text-sm font-medium shadow-sm"
                  >
                    {TIME_OPTIONS.map(t => (
                      <option key={t} value={t}>{t}</option>
                    ))}
                  </select>
                  <span className="text-neutral-400">–</span>
                  <select
                    value={schedule?.end || '17:00'}
                    onChange={e => onChange({ start: schedule?.start || '09:00', end: e.target.value })}
                    className="rounded-lg border-0 bg-white px-2 py-1 text-sm font-medium shadow-sm"
                  >
                    {TIME_OPTIONS.map(t => (
                      <option key={t} value={t}>{t}</option>
                    ))}
                  </select>
                </div>
              )}
        </div>
        <button
          type="button"
          onClick={() => onChange(isOff ? { start: '09:00', end: '17:00' } : null)}
          className="rounded-lg px-2 py-1 text-xs font-medium transition-colors"
          style={{
            backgroundColor: isOff ? themeVars.primary : 'transparent',
            color: isOff ? 'white' : themeVars.accent,
          }}
        >
          {isOff ? 'Set Hours' : 'Mark Off'}
        </button>
      </div>
    </div>
  );
}

// =============================================================================
// Time Off Request Card (Request-based, not direct write)
// =============================================================================

function TimeOffRequestCard({ request }: { request: TimeOffRequest }) {
  const formatDate = (dateStr: string) => {
    const date = new Date(`${dateStr}T00:00:00`);
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };

  const statusStyles: Record<string, { bg: string; text: string; label: string }> = {
    PENDING: { bg: '#FEF3C7', text: '#D97706', label: 'Pending' },
    APPROVED: { bg: '#D1FAE5', text: '#059669', label: 'Approved' },
    DENIED: { bg: '#FEE2E2', text: '#DC2626', label: 'Denied' },
  };

  const style = statusStyles[request.status] ?? statusStyles.PENDING;

  return (
    <div
      className="flex items-center justify-between rounded-xl p-3"
      style={{ backgroundColor: themeVars.surfaceAlt }}
    >
      <div>
        <div className="font-medium text-neutral-900">
          {formatDate(request.startDate)}
          {' '}
          –
          {formatDate(request.endDate)}
        </div>
        {request.note && (
          <div className="mt-0.5 text-xs text-neutral-500">{request.note}</div>
        )}
      </div>
      <span
        className="rounded-full px-2.5 py-1 text-xs font-semibold"
        style={{ backgroundColor: style!.bg, color: style!.text }}
      >
        {style!.label}
      </span>
    </div>
  );
}

// =============================================================================
// Mini Calendar Component
// =============================================================================

function MiniCalendar({
  selectedDate,
  onSelect,
  minDate,
  onClose,
}: {
  selectedDate: string;
  onSelect: (date: string) => void;
  minDate?: string;
  onClose: () => void;
}) {
  const [viewDate, setViewDate] = useState(() => {
    if (selectedDate) {
      return new Date(`${selectedDate}T00:00:00`);
    }
    return new Date();
  });

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const minDateObj = minDate ? new Date(`${minDate}T00:00:00`) : today;

  const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const dayNames = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

  const getDaysInMonth = (date: Date) => {
    const year = date.getFullYear();
    const month = date.getMonth();
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const daysInMonth = lastDay.getDate();
    const startingDay = firstDay.getDay();

    const days: (Date | null)[] = [];
    for (let i = 0; i < startingDay; i++) {
      days.push(null);
    }
    for (let i = 1; i <= daysInMonth; i++) {
      days.push(new Date(year, month, i));
    }
    return days;
  };

  const days = getDaysInMonth(viewDate);

  const goToPrevMonth = () => {
    setViewDate(new Date(viewDate.getFullYear(), viewDate.getMonth() - 1, 1));
  };

  const goToNextMonth = () => {
    setViewDate(new Date(viewDate.getFullYear(), viewDate.getMonth() + 1, 1));
  };

  const formatDateString = (date: Date) => {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };

  const isDisabled = (date: Date) => date < minDateObj;
  const isSelected = (date: Date) => selectedDate === formatDateString(date);
  const isToday = (date: Date) => formatDateString(date) === formatDateString(today);

  return (
    <div className="rounded-xl border border-neutral-200 bg-white p-3 shadow-lg">
      <div className="mb-3 flex items-center justify-between">
        <button
          type="button"
          onClick={goToPrevMonth}
          className="flex size-8 items-center justify-center rounded-full text-neutral-600 transition-colors hover:bg-neutral-100"
        >
          ←
        </button>
        <span className="text-sm font-semibold text-neutral-900">
          {monthNames[viewDate.getMonth()]}
          {' '}
          {viewDate.getFullYear()}
        </span>
        <button
          type="button"
          onClick={goToNextMonth}
          className="flex size-8 items-center justify-center rounded-full text-neutral-600 transition-colors hover:bg-neutral-100"
        >
          →
        </button>
      </div>

      <div className="mb-2 grid grid-cols-7 gap-1">
        {dayNames.map(day => (
          <div key={day} className="py-1 text-center text-xs font-medium text-neutral-400">
            {day}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-1">
        {days.map((date, index) => {
          if (!date) {
            return <div key={`empty-${index}`} className="aspect-square" />;
          }

          const disabled = isDisabled(date);
          const selected = isSelected(date);
          const todayDate = isToday(date);

          return (
            <button
              key={formatDateString(date)}
              type="button"
              disabled={disabled}
              onClick={() => {
                onSelect(formatDateString(date));
                onClose();
              }}
              className={`
                flex aspect-square items-center justify-center rounded-full text-sm font-medium transition-all
                ${disabled ? 'cursor-not-allowed text-neutral-300' : 'cursor-pointer hover:bg-amber-100'}
                ${selected ? 'bg-amber-500 text-white hover:bg-amber-600' : ''}
                ${todayDate && !selected ? 'border-2 border-amber-400' : ''}
              `}
            >
              {date.getDate()}
            </button>
          );
        })}
      </div>

      <button
        type="button"
        onClick={onClose}
        className="mt-3 w-full rounded-lg bg-neutral-100 py-2 text-sm font-medium text-neutral-600 transition-colors hover:bg-neutral-200"
      >
        Close
      </button>
    </div>
  );
}

// =============================================================================
// Schedule Override Card
// =============================================================================

function OverrideCard({
  override,
  onEdit,
  onDelete,
  isDeleting,
}: {
  override: ScheduleOverride;
  onEdit: (override: ScheduleOverride) => void;
  onDelete: (id: string) => void;
  isDeleting: boolean;
}) {
  const formatDate = (dateStr: string) => {
    const date = new Date(`${dateStr}T00:00:00`);
    return date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  };

  const formatTime = (time: string) => {
    const [hours, minutes] = time.split(':').map(Number);
    const ampm = hours! >= 12 ? 'pm' : 'am';
    const displayHours = hours! % 12 || 12;
    return `${displayHours}:${String(minutes).padStart(2, '0')}${ampm}`;
  };

  return (
    <div
      className="flex items-center justify-between rounded-xl p-3"
      style={{ backgroundColor: themeVars.surfaceAlt }}
    >
      <div className="flex-1">
        <div className="font-medium text-neutral-900">
          {formatDate(override.date)}
        </div>
        <div className="flex items-center gap-2">
          {override.type === 'off'
            ? (
                <span className="inline-flex items-center rounded-full bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-700">
                  OFF
                </span>
              )
            : (
                <span className="inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-700">
                  {formatTime(override.startTime!)}
                  {' '}
                  –
                  {formatTime(override.endTime!)}
                </span>
              )}
        </div>
        {override.note && (
          <div className="mt-1 text-xs text-neutral-500">{override.note}</div>
        )}
      </div>
      <div className="flex gap-1">
        <button
          type="button"
          onClick={() => onEdit(override)}
          className="rounded-lg px-2 py-1 text-sm text-neutral-600 transition-colors hover:bg-neutral-100"
        >
          Edit
        </button>
        <button
          type="button"
          onClick={() => onDelete(override.id)}
          disabled={isDeleting}
          className="rounded-lg px-2 py-1 text-sm text-red-500 transition-colors hover:bg-red-50 disabled:opacity-50"
        >
          Remove
        </button>
      </div>
    </div>
  );
}

// =============================================================================
// Add Override Form
// =============================================================================

function AddOverrideForm({
  editingOverride,
  onSave,
  onCancel,
  isSubmitting,
}: {
  editingOverride: ScheduleOverride | null;
  onSave: (data: {
    startDate: string;
    endDate: string;
    type: 'off' | 'hours';
    startTime?: string;
    endTime?: string;
    note?: string;
  }) => void;
  onCancel: () => void;
  isSubmitting: boolean;
}) {
  const [startDate, setStartDate] = useState(editingOverride?.date || '');
  const [endDate, setEndDate] = useState(editingOverride?.date || '');
  const [type, setType] = useState<'off' | 'hours'>(editingOverride?.type || 'off');
  const [startTime, setStartTime] = useState(editingOverride?.startTime || '09:00');
  const [endTime, setEndTime] = useState(editingOverride?.endTime || '17:00');
  const [note, setNote] = useState(editingOverride?.note || '');
  const [showStartCalendar, setShowStartCalendar] = useState(false);
  const [showEndCalendar, setShowEndCalendar] = useState(false);

  const isEditing = !!editingOverride;

  const handleSubmit = () => {
    if (!startDate) {
      return;
    }
    const effectiveEndDate = isEditing ? startDate : (endDate || startDate);

    onSave({
      startDate,
      endDate: effectiveEndDate,
      type,
      ...(type === 'hours' && { startTime, endTime }),
      ...(note && { note }),
    });
  };

  const today = new Date().toISOString().split('T')[0];

  const formatDisplayDate = (dateStr: string) => {
    if (!dateStr) {
      return 'Tap to select';
    }
    const date = new Date(`${dateStr}T00:00:00`);
    return date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  };

  return (
    <div className="space-y-4">
      <div className="flex gap-2 rounded-xl bg-neutral-100 p-1">
        <button
          type="button"
          onClick={() => setType('off')}
          className={`flex-1 rounded-lg py-2.5 text-sm font-semibold transition-all ${
            type === 'off'
              ? 'bg-white text-neutral-900 shadow-sm'
              : 'text-neutral-500 hover:text-neutral-700'
          }`}
        >
          Day Off
        </button>
        <button
          type="button"
          onClick={() => setType('hours')}
          className={`flex-1 rounded-lg py-2.5 text-sm font-semibold transition-all ${
            type === 'hours'
              ? 'bg-white text-neutral-900 shadow-sm'
              : 'text-neutral-500 hover:text-neutral-700'
          }`}
        >
          Custom Hours
        </button>
      </div>

      <div className={isEditing ? '' : 'grid grid-cols-2 gap-3'}>
        <div>
          <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-neutral-500">
            {isEditing ? 'Date' : 'Start Date'}
          </label>
          <button
            type="button"
            onClick={() => {
              setShowStartCalendar(!showStartCalendar);
              setShowEndCalendar(false);
            }}
            className={`
              w-full rounded-xl border-2 p-3 text-left text-sm font-medium transition-all
              ${startDate
      ? 'border-amber-400 bg-amber-50 text-neutral-900'
      : 'border-neutral-200 bg-white text-neutral-400 hover:border-neutral-300'}
            `}
          >
            <div className="flex items-center justify-between">
              <span>{formatDisplayDate(startDate)}</span>
              <span className="text-lg">📅</span>
            </div>
          </button>
          {showStartCalendar && (
            <div className="mt-2">
              <MiniCalendar
                selectedDate={startDate}
                onSelect={(date) => {
                  setStartDate(date);
                  if (!isEditing && endDate && date > endDate) {
                    setEndDate('');
                  }
                }}
                minDate={today}
                onClose={() => setShowStartCalendar(false)}
              />
            </div>
          )}
        </div>
        {!isEditing && (
          <div>
            <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-neutral-500">
              End Date
            </label>
            <button
              type="button"
              onClick={() => {
                setShowEndCalendar(!showEndCalendar);
                setShowStartCalendar(false);
              }}
              className={`
                w-full rounded-xl border-2 p-3 text-left text-sm font-medium transition-all
                ${endDate
            ? 'border-amber-400 bg-amber-50 text-neutral-900'
            : 'border-neutral-200 bg-white text-neutral-400 hover:border-neutral-300'}
              `}
            >
              <div className="flex items-center justify-between">
                <span>{formatDisplayDate(endDate)}</span>
                <span className="text-lg">📅</span>
              </div>
            </button>
            {showEndCalendar && (
              <div className="mt-2">
                <MiniCalendar
                  selectedDate={endDate}
                  onSelect={setEndDate}
                  minDate={startDate || today}
                  onClose={() => setShowEndCalendar(false)}
                />
              </div>
            )}
          </div>
        )}
      </div>

      {type === 'hours' && (
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-neutral-500">
              Start Time
            </label>
            <select
              value={startTime}
              onChange={e => setStartTime(e.target.value)}
              className="w-full rounded-xl border-2 border-neutral-200 bg-white p-3 text-sm font-medium transition-all focus:border-amber-400 focus:outline-none"
            >
              {TIME_OPTIONS.map(t => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-neutral-500">
              End Time
            </label>
            <select
              value={endTime}
              onChange={e => setEndTime(e.target.value)}
              className="w-full rounded-xl border-2 border-neutral-200 bg-white p-3 text-sm font-medium transition-all focus:border-amber-400 focus:outline-none"
            >
              {TIME_OPTIONS.map(t => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </div>
        </div>
      )}

      <div>
        <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-neutral-500">
          Note (optional)
        </label>
        <input
          type="text"
          value={note}
          onChange={e => setNote(e.target.value)}
          placeholder="e.g., Doctor appointment"
          className="w-full rounded-xl border-2 border-neutral-200 bg-white p-3 text-sm font-medium transition-all placeholder:text-neutral-400 focus:border-amber-400 focus:outline-none"
        />
      </div>

      <div className="flex gap-3 pt-2">
        <button
          type="button"
          onClick={onCancel}
          disabled={isSubmitting}
          className="flex-1 rounded-xl border-2 border-neutral-200 py-3 text-sm font-semibold text-neutral-600 transition-all hover:bg-neutral-50 disabled:opacity-50"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={handleSubmit}
          disabled={!startDate || isSubmitting}
          className="flex-1 rounded-xl py-3 text-sm font-bold text-white transition-all hover:opacity-90 disabled:opacity-50"
          style={{ backgroundColor: themeVars.accent }}
        >
          {isSubmitting ? 'Saving...' : isEditing ? 'Update' : 'Add Override'}
        </button>
      </div>
    </div>
  );
}

// =============================================================================
// Request Time Off Form (EDIT 2: Request-based, not direct write)
// =============================================================================

function RequestTimeOffForm({
  onSubmit,
  onCancel,
  isSubmitting,
}: {
  onSubmit: (startDate: string, endDate: string, note: string) => void;
  onCancel: () => void;
  isSubmitting: boolean;
}) {
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [note, setNote] = useState('');
  const [showStartCalendar, setShowStartCalendar] = useState(false);
  const [showEndCalendar, setShowEndCalendar] = useState(false);

  const handleSubmit = () => {
    if (!startDate || !endDate) {
      return;
    }
    onSubmit(startDate, endDate, note);
  };

  const today = new Date().toISOString().split('T')[0];

  const formatDisplayDate = (dateStr: string) => {
    if (!dateStr) {
      return 'Tap to select';
    }
    const date = new Date(`${dateStr}T00:00:00`);
    return date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  };

  return (
    <div className="space-y-4">
      <div className="rounded-xl bg-amber-50 p-3 text-sm text-amber-800">
        <strong>Note:</strong>
        {' '}
        Time off requests require admin approval. You&apos;ll receive a notification when your request is reviewed.
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-neutral-500">
            Start Date
          </label>
          <button
            type="button"
            onClick={() => {
              setShowStartCalendar(!showStartCalendar);
              setShowEndCalendar(false);
            }}
            className={`
              w-full rounded-xl border-2 p-3 text-left text-sm font-medium transition-all
              ${startDate
      ? 'border-amber-400 bg-amber-50 text-neutral-900'
      : 'border-neutral-200 bg-white text-neutral-400 hover:border-neutral-300'}
            `}
          >
            <div className="flex items-center justify-between">
              <span>{formatDisplayDate(startDate)}</span>
              <span className="text-lg">📅</span>
            </div>
          </button>
          {showStartCalendar && (
            <div className="mt-2">
              <MiniCalendar
                selectedDate={startDate}
                onSelect={(date) => {
                  setStartDate(date);
                  if (endDate && date > endDate) {
                    setEndDate('');
                  }
                }}
                minDate={today}
                onClose={() => setShowStartCalendar(false)}
              />
            </div>
          )}
        </div>
        <div>
          <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-neutral-500">
            End Date
          </label>
          <button
            type="button"
            onClick={() => {
              setShowEndCalendar(!showEndCalendar);
              setShowStartCalendar(false);
            }}
            className={`
              w-full rounded-xl border-2 p-3 text-left text-sm font-medium transition-all
              ${endDate
      ? 'border-amber-400 bg-amber-50 text-neutral-900'
      : 'border-neutral-200 bg-white text-neutral-400 hover:border-neutral-300'}
            `}
          >
            <div className="flex items-center justify-between">
              <span>{formatDisplayDate(endDate)}</span>
              <span className="text-lg">📅</span>
            </div>
          </button>
          {showEndCalendar && (
            <div className="mt-2">
              <MiniCalendar
                selectedDate={endDate}
                onSelect={setEndDate}
                minDate={startDate || today}
                onClose={() => setShowEndCalendar(false)}
              />
            </div>
          )}
        </div>
      </div>

      <div>
        <label htmlFor="request-note" className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-neutral-500">
          Note (optional)
        </label>
        <input
          id="request-note"
          type="text"
          value={note}
          onChange={e => setNote(e.target.value)}
          placeholder="e.g., Family vacation"
          className="w-full rounded-xl border-2 border-neutral-200 bg-white p-3 text-sm font-medium transition-all placeholder:text-neutral-400 focus:border-amber-400 focus:outline-none"
        />
      </div>

      <div className="flex gap-3 pt-2">
        <button
          type="button"
          onClick={onCancel}
          disabled={isSubmitting}
          className="flex-1 rounded-xl border-2 border-neutral-200 py-3 text-sm font-semibold text-neutral-600 transition-all hover:bg-neutral-50 disabled:opacity-50"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={handleSubmit}
          disabled={!startDate || !endDate || isSubmitting}
          className="flex-1 rounded-xl py-3 text-sm font-bold text-white transition-all hover:opacity-90 disabled:opacity-50"
          style={{ backgroundColor: themeVars.accent }}
        >
          {isSubmitting ? 'Submitting...' : 'Submit Request'}
        </button>
      </div>
    </div>
  );
}

// =============================================================================
// Staff Schedule Page
// =============================================================================

export default function StaffSchedulePage() {
  const router = useRouter();
  const params = useParams();
  const { salonName: providerSalonName } = useSalon();
  const locale = (params?.locale as string) || 'en';

  // Staff auth state
  const [authState, setAuthState] = useState<StaffAuthState>('loading');

  const [mounted, setMounted] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [weeklySchedule, setWeeklySchedule] = useState<WeeklySchedule>({});
  const [timeOffRequests, setTimeOffRequests] = useState<TimeOffRequest[]>([]);
  const [showRequestTimeOff, setShowRequestTimeOff] = useState(false);
  const [submittingRequest, setSubmittingRequest] = useState(false);
  const [technicianId, setTechnicianId] = useState<string | null>(null);
  const [salonSlug, setSalonSlug] = useState<string | null>(null);
  const [salonName, setSalonName] = useState<string>(providerSalonName);

  // Schedule overrides state
  const [overrides, setOverrides] = useState<ScheduleOverride[]>([]);
  const [showAddOverride, setShowAddOverride] = useState(false);
  const [editingOverride, setEditingOverride] = useState<ScheduleOverride | null>(null);
  const [savingOverride, setSavingOverride] = useState(false);
  const [deletingOverrideId, setDeletingOverrideId] = useState<string | null>(null);
  const [overridesUpgradeRequired, setOverridesUpgradeRequired] = useState(false);

  // Module capabilities
  const { modules, loading: capabilitiesLoading } = useStaffCapabilities();
  const scheduleOverridesEnabled = modules?.scheduleOverrides ?? false;

  // Fetch staff info from session
  useEffect(() => {
    const fetchStaffInfo = async () => {
      try {
        const response = await fetch('/api/staff/me');
        if (response.ok) {
          const data = await response.json();
          if (data.data?.technician?.id) {
            setTechnicianId(data.data.technician.id);
          }
          if (data.data?.salon?.slug) {
            setSalonSlug(data.data.salon.slug);
          }
          if (data.data?.salon?.name) {
            setSalonName(data.data.salon.name);
          }
          setAuthState('authed');
        } else if (response.status === 401) {
          setAuthState('unauthed');
          router.replace(`/${locale}/staff-login`);
        } else {
          setAuthState('unauthed');
          router.replace(`/${locale}/staff-login`);
        }
      } catch (error) {
        console.error('Failed to fetch staff info:', error);
        setAuthState('unauthed');
        router.replace(`/${locale}/staff-login`);
      }
    };
    fetchStaffInfo();
  }, [locale, router]);

  // Fetch schedule data
  const fetchData = useCallback(async () => {
    if (!salonSlug || !technicianId) {
      return;
    }

    setLoading(true);
    try {
      // Fetch availability
      const availResponse = await fetch(
        `/api/staff/availability?technicianId=${technicianId}&salonSlug=${salonSlug}`,
      );
      if (availResponse.ok) {
        const data = await availResponse.json();
        setWeeklySchedule(data.data?.weeklySchedule || {});
      }

      // Fetch time-off requests (new endpoint)
      const requestsResponse = await fetch('/api/staff/time-off-requests');
      if (requestsResponse.ok) {
        const data = await requestsResponse.json();
        setTimeOffRequests(data.data?.requests || []);
      }

      // Fetch schedule overrides if module enabled
      if (scheduleOverridesEnabled) {
        const overridesResponse = await fetch('/api/staff/overrides');
        if (overridesResponse.ok) {
          const data = await overridesResponse.json();
          setOverrides(data.data?.overrides || []);
          setOverridesUpgradeRequired(false);
        } else {
          const errorData = await overridesResponse.json().catch(() => ({}));
          if (errorData.error?.code === 'UPGRADE_REQUIRED') {
            setOverridesUpgradeRequired(true);
            setOverrides([]);
          } else if (errorData.error?.code === 'MODULE_DISABLED') {
            setOverridesUpgradeRequired(false);
            setOverrides([]);
          }
        }
      } else {
        setOverrides([]);
        setOverridesUpgradeRequired(false);
      }
    } catch (error) {
      console.error('Failed to fetch schedule:', error);
    } finally {
      setLoading(false);
    }
  }, [salonSlug, technicianId, scheduleOverridesEnabled]);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (authState === 'authed' && salonSlug && technicianId) {
      fetchData();
    }
  }, [authState, salonSlug, technicianId, fetchData]);

  // Save weekly schedule
  const handleSaveSchedule = async () => {
    if (!salonSlug || !technicianId) {
      return;
    }

    setSaving(true);
    try {
      const response = await fetch('/api/staff/availability', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          technicianId,
          salonSlug,
          weeklySchedule,
        }),
      });

      if (response.ok) {
        // Success feedback could be added here
      }
    } catch (error) {
      console.error('Failed to save schedule:', error);
    } finally {
      setSaving(false);
    }
  };

  // Update day schedule
  const handleDayChange = (day: keyof WeeklySchedule, schedule: DaySchedule) => {
    setWeeklySchedule(prev => ({
      ...prev,
      [day]: schedule,
    }));
  };

  // Submit time off request (EDIT 2: Request-based)
  const handleSubmitTimeOffRequest = async (startDate: string, endDate: string, note: string) => {
    setSubmittingRequest(true);
    try {
      const response = await fetch('/api/staff/time-off-requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ startDate, endDate, note: note || undefined }),
      });

      if (response.ok) {
        await fetchData();
        setShowRequestTimeOff(false);
      } else {
        const errorData = await response.json().catch(() => ({}));
        console.error('Failed to submit request:', errorData);
      }
    } catch (error) {
      console.error('Failed to submit time-off request:', error);
    } finally {
      setSubmittingRequest(false);
    }
  };

  // Save schedule override
  const handleSaveOverride = async (data: {
    startDate: string;
    endDate: string;
    type: 'off' | 'hours';
    startTime?: string;
    endTime?: string;
    note?: string;
  }) => {
    setSavingOverride(true);
    try {
      if (editingOverride) {
        const response = await fetch(`/api/staff/overrides/${editingOverride.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            type: data.type,
            startTime: data.startTime,
            endTime: data.endTime,
            note: data.note,
          }),
        });

        if (response.ok) {
          await fetchData();
          setEditingOverride(null);
          setShowAddOverride(false);
        }
      } else {
        const response = await fetch('/api/staff/overrides', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data),
        });

        if (response.ok) {
          await fetchData();
          setShowAddOverride(false);
        }
      }
    } catch (error) {
      console.error('Failed to save override:', error);
    } finally {
      setSavingOverride(false);
    }
  };

  // Delete schedule override
  const handleDeleteOverride = async (id: string) => {
    setDeletingOverrideId(id);
    try {
      const response = await fetch(`/api/staff/overrides/${id}`, {
        method: 'DELETE',
      });

      if (response.ok) {
        setOverrides(prev => prev.filter(o => o.id !== id));
      }
    } catch (error) {
      console.error('Failed to delete override:', error);
    } finally {
      setDeletingOverrideId(null);
    }
  };

  // Edit override
  const handleEditOverride = (override: ScheduleOverride) => {
    setEditingOverride(override);
    setShowAddOverride(true);
  };

  // Get approved time off for display
  const approvedTimeOff = timeOffRequests.filter(r => r.status === 'APPROVED');

  // Auth loading state
  if (authState === 'loading') {
    return (
      <div className="flex min-h-screen items-center justify-center" style={{ backgroundColor: themeVars.background }}>
        <div
          className="size-8 animate-spin rounded-full border-4 border-t-transparent"
          style={{ borderColor: `${themeVars.primary} transparent ${themeVars.primary} ${themeVars.primary}` }}
        />
      </div>
    );
  }

  if (authState === 'unauthed') {
    return null;
  }

  return (
    <div
      className="min-h-screen pb-24"
      style={{
        background: `linear-gradient(to bottom, ${themeVars.background}, color-mix(in srgb, ${themeVars.background} 95%, ${themeVars.primaryDark}))`,
      }}
    >
      <div className="mx-auto max-w-2xl px-4">
        {/* Header with notification bell */}
        <StaffHeader
          title="My Schedule"
          subtitle={salonName}
          showBack
          onBack={() => router.push(`/${locale}/staff`)}
        />

        {/* Approved Time Off Banner */}
        {approvedTimeOff.length > 0 && (
          <div
            className="mb-4 rounded-xl bg-green-50 p-3"
            style={{
              opacity: mounted ? 1 : 0,
              transform: mounted ? 'translateY(0)' : 'translateY(10px)',
              transition: 'opacity 300ms ease-out 50ms, transform 300ms ease-out 50ms',
            }}
          >
            <div className="text-sm font-medium text-green-800">Upcoming Approved Time Off</div>
            {approvedTimeOff.slice(0, 3).map(r => (
              <div key={r.id} className="mt-1 text-xs text-green-700">
                {new Date(`${r.startDate}T00:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                {' '}
                –
                {new Date(`${r.endDate}T00:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
              </div>
            ))}
          </div>
        )}

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <div
              className="size-8 animate-spin rounded-full border-4 border-t-transparent"
              style={{ borderColor: `${themeVars.primary} transparent ${themeVars.primary} ${themeVars.primary}` }}
            />
          </div>
        ) : (
          <div
            className="space-y-6"
            style={{
              opacity: mounted ? 1 : 0,
              transform: mounted ? 'translateY(0)' : 'translateY(10px)',
              transition: 'opacity 300ms ease-out 100ms, transform 300ms ease-out 100ms',
            }}
          >
            {/* Weekly Schedule */}
            <div
              className="overflow-hidden rounded-2xl bg-white shadow-lg"
              style={{ borderColor: themeVars.cardBorder, borderWidth: 1 }}
            >
              <div className="p-4">
                <div className="mb-4 flex items-center justify-between">
                  <h2 className="font-bold" style={{ color: themeVars.titleText }}>
                    Weekly Hours
                  </h2>
                  <button
                    type="button"
                    onClick={handleSaveSchedule}
                    disabled={saving}
                    className="rounded-full px-4 py-1.5 text-sm font-bold text-neutral-900 transition-all hover:opacity-90 disabled:opacity-50"
                    style={{ background: `linear-gradient(to right, ${themeVars.primary}, ${themeVars.primaryDark})` }}
                  >
                    {saving ? 'Saving...' : 'Save'}
                  </button>
                </div>

                <div className="space-y-2">
                  {DAYS.map((day, index) => (
                    <DayScheduleEditor
                      key={day}
                      label={DAY_LABELS[index]!}
                      schedule={weeklySchedule[day] ?? null}
                      onChange={schedule => handleDayChange(day, schedule)}
                    />
                  ))}
                </div>
              </div>
            </div>

            {/* Upcoming Changes (Schedule Overrides) - Only show if module enabled */}
            {capabilitiesLoading
              ? (
                  <ModuleSkeleton />
                )
              : overridesUpgradeRequired
                ? (
                    <UpgradeRequiredState featureName="Schedule Overrides" />
                  )
                : scheduleOverridesEnabled
                  ? (
                      <div
                        className="overflow-hidden rounded-2xl bg-white shadow-lg"
                        style={{ borderColor: themeVars.cardBorder, borderWidth: 1 }}
                      >
                        <div className="p-4">
                          <div className="mb-4 flex items-center justify-between">
                            <div>
                              <h2 className="font-bold" style={{ color: themeVars.titleText }}>
                                Upcoming Changes
                              </h2>
                              <p className="text-xs text-neutral-500">One-time schedule adjustments</p>
                            </div>
                            {!showAddOverride && (
                              <button
                                type="button"
                                onClick={() => {
                                  setEditingOverride(null);
                                  setShowAddOverride(true);
                                }}
                                className="rounded-full px-4 py-1.5 text-sm font-medium transition-colors"
                                style={{ backgroundColor: themeVars.selectedBackground, color: themeVars.titleText }}
                              >
                                + Add
                              </button>
                            )}
                          </div>

                          {showAddOverride
                            ? (
                                <AddOverrideForm
                                  editingOverride={editingOverride}
                                  onSave={handleSaveOverride}
                                  onCancel={() => {
                                    setShowAddOverride(false);
                                    setEditingOverride(null);
                                  }}
                                  isSubmitting={savingOverride}
                                />
                              )
                            : overrides.length === 0
                              ? (
                                  <div className="py-6 text-center text-neutral-500">
                                    <div className="mb-2 text-2xl">✨</div>
                                    <p>No upcoming changes</p>
                                    <p className="mt-1 text-xs">Add a day off or custom hours</p>
                                  </div>
                                )
                              : (
                                  <div className="space-y-2">
                                    {overrides.map(override => (
                                      <OverrideCard
                                        key={override.id}
                                        override={override}
                                        onEdit={handleEditOverride}
                                        onDelete={handleDeleteOverride}
                                        isDeleting={deletingOverrideId === override.id}
                                      />
                                    ))}
                                  </div>
                                )}
                        </div>
                      </div>
                    )
                  : null}

            {/* Time Off Requests (EDIT 2: Request-based) */}
            <div
              className="overflow-hidden rounded-2xl bg-white shadow-lg"
              style={{ borderColor: themeVars.cardBorder, borderWidth: 1 }}
            >
              <div className="p-4">
                <div className="mb-4 flex items-center justify-between">
                  <div>
                    <h2 className="font-bold" style={{ color: themeVars.titleText }}>
                      Time Off Requests
                    </h2>
                    <p className="text-xs text-neutral-500">Requires admin approval</p>
                  </div>
                  {!showRequestTimeOff && (
                    <button
                      type="button"
                      onClick={() => setShowRequestTimeOff(true)}
                      className="rounded-full px-4 py-1.5 text-sm font-medium transition-colors"
                      style={{ backgroundColor: themeVars.selectedBackground, color: themeVars.titleText }}
                    >
                      + Request
                    </button>
                  )}
                </div>

                {showRequestTimeOff
                  ? (
                      <RequestTimeOffForm
                        onSubmit={handleSubmitTimeOffRequest}
                        onCancel={() => setShowRequestTimeOff(false)}
                        isSubmitting={submittingRequest}
                      />
                    )
                  : timeOffRequests.length === 0
                    ? (
                        <div className="py-6 text-center text-neutral-500">
                          <div className="mb-2 text-2xl">📅</div>
                          <p>No time off requests</p>
                          <p className="mt-1 text-xs">Submit a request for admin approval</p>
                        </div>
                      )
                    : (
                        <div className="space-y-2">
                          {timeOffRequests.map(request => (
                            <TimeOffRequestCard key={request.id} request={request} />
                          ))}
                        </div>
                      )}
              </div>
            </div>
          </div>
        )}
      </div>

      <StaffBottomNav activeItem="schedule" />
    </div>
  );
}
