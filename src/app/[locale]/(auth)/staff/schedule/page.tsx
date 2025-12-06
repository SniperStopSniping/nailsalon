'use client';

import { useUser } from '@clerk/nextjs';
import { useParams, useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';

import { useSalon } from '@/providers/SalonProvider';
import { themeVars } from '@/theme';

// =============================================================================
// Types
// =============================================================================

type DaySchedule = { start: string; end: string } | null;

interface WeeklySchedule {
  sunday?: DaySchedule;
  monday?: DaySchedule;
  tuesday?: DaySchedule;
  wednesday?: DaySchedule;
  thursday?: DaySchedule;
  friday?: DaySchedule;
  saturday?: DaySchedule;
}

interface TimeOffEntry {
  id: string;
  startDate: string;
  endDate: string;
  reason: string | null;
  notes: string | null;
}

const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'] as const;
const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const TIME_OPTIONS = [
  '08:00', '08:30', '09:00', '09:30', '10:00', '10:30',
  '11:00', '11:30', '12:00', '12:30', '13:00', '13:30',
  '14:00', '14:30', '15:00', '15:30', '16:00', '16:30',
  '17:00', '17:30', '18:00', '18:30', '19:00', '19:30', '20:00',
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
          {isOff ? (
            <span className="text-sm text-neutral-500">Day Off</span>
          ) : (
            <div className="flex items-center gap-1">
              <select
                value={schedule?.start || '09:00'}
                onChange={(e) => onChange({ start: e.target.value, end: schedule?.end || '17:00' })}
                className="rounded-lg border-0 bg-white px-2 py-1 text-sm font-medium shadow-sm"
              >
                {TIME_OPTIONS.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
              <span className="text-neutral-400">–</span>
              <select
                value={schedule?.end || '17:00'}
                onChange={(e) => onChange({ start: schedule?.start || '09:00', end: e.target.value })}
                className="rounded-lg border-0 bg-white px-2 py-1 text-sm font-medium shadow-sm"
              >
                {TIME_OPTIONS.map((t) => (
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
// Time Off Card
// =============================================================================

function TimeOffCard({
  entry,
  onDelete,
  isDeleting,
}: {
  entry: TimeOffEntry;
  onDelete: (id: string) => void;
  isDeleting: boolean;
}) {
  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };

  const reasonLabels: Record<string, string> = {
    vacation: '🏖️ Vacation',
    sick: '🤒 Sick Day',
    personal: '👤 Personal',
    training: '📚 Training',
    other: '📝 Other',
  };

  return (
    <div
      className="flex items-center justify-between rounded-xl p-3"
      style={{ backgroundColor: themeVars.surfaceAlt }}
    >
      <div>
        <div className="font-medium text-neutral-900">
          {formatDate(entry.startDate)} – {formatDate(entry.endDate)}
        </div>
        <div className="text-sm text-neutral-500">
          {entry.reason ? reasonLabels[entry.reason] || entry.reason : 'Time Off'}
        </div>
        {entry.notes && (
          <div className="mt-1 text-xs text-neutral-400">{entry.notes}</div>
        )}
      </div>
      <button
        type="button"
        onClick={() => onDelete(entry.id)}
        disabled={isDeleting}
        className="rounded-lg px-2 py-1 text-sm text-red-500 transition-colors hover:bg-red-50 disabled:opacity-50"
      >
        Remove
      </button>
    </div>
  );
}

// =============================================================================
// Add Time Off Form
// =============================================================================

function AddTimeOffForm({
  onAdd,
  onCancel,
  isSubmitting,
}: {
  onAdd: (startDate: string, endDate: string, reason: string, notes: string) => void;
  onCancel: () => void;
  isSubmitting: boolean;
}) {
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [reason, setReason] = useState('personal');
  const [notes, setNotes] = useState('');

  const handleSubmit = () => {
    if (!startDate || !endDate) return;
    onAdd(startDate, endDate, reason, notes);
  };

  const today = new Date().toISOString().split('T')[0];

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label htmlFor="start-date" className="mb-1 block text-xs font-medium text-neutral-600">
            Start Date
          </label>
          <input
            id="start-date"
            type="date"
            value={startDate}
            min={today}
            onChange={(e) => setStartDate(e.target.value)}
            className="w-full rounded-lg border-0 bg-neutral-100 px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label htmlFor="end-date" className="mb-1 block text-xs font-medium text-neutral-600">
            End Date
          </label>
          <input
            id="end-date"
            type="date"
            value={endDate}
            min={startDate || today}
            onChange={(e) => setEndDate(e.target.value)}
            className="w-full rounded-lg border-0 bg-neutral-100 px-3 py-2 text-sm"
          />
        </div>
      </div>

      <div>
        <label htmlFor="reason-select" className="mb-1 block text-xs font-medium text-neutral-600">
          Reason
        </label>
        <select
          id="reason-select"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          className="w-full rounded-lg border-0 bg-neutral-100 px-3 py-2 text-sm"
        >
          <option value="vacation">🏖️ Vacation</option>
          <option value="sick">🤒 Sick Day</option>
          <option value="personal">👤 Personal</option>
          <option value="training">📚 Training</option>
          <option value="other">📝 Other</option>
        </select>
      </div>

      <div>
        <label htmlFor="notes-input" className="mb-1 block text-xs font-medium text-neutral-600">
          Notes (optional)
        </label>
        <input
          id="notes-input"
          type="text"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Any additional notes..."
          className="w-full rounded-lg border-0 bg-neutral-100 px-3 py-2 text-sm"
        />
      </div>

      <div className="flex gap-2 pt-2">
        <button
          type="button"
          onClick={onCancel}
          disabled={isSubmitting}
          className="flex-1 rounded-full py-2 text-sm font-medium text-neutral-600 transition-colors hover:bg-neutral-100"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={handleSubmit}
          disabled={!startDate || !endDate || isSubmitting}
          className="flex-1 rounded-full py-2 text-sm font-bold text-neutral-900 transition-all hover:opacity-90 disabled:opacity-50"
          style={{ background: `linear-gradient(to right, ${themeVars.primary}, ${themeVars.primaryDark})` }}
        >
          {isSubmitting ? 'Adding...' : 'Add Time Off'}
        </button>
      </div>
    </div>
  );
}

// =============================================================================
// Staff Schedule Page
// =============================================================================

export default function StaffSchedulePage() {
  const { user, isLoaded } = useUser();
  const router = useRouter();
  const params = useParams();
  const { salonName, salonSlug } = useSalon();
  const locale = (params?.locale as string) || 'en';

  const [mounted, setMounted] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [weeklySchedule, setWeeklySchedule] = useState<WeeklySchedule>({});
  const [timeOffEntries, setTimeOffEntries] = useState<TimeOffEntry[]>([]);
  const [showAddTimeOff, setShowAddTimeOff] = useState(false);
  const [addingTimeOff, setAddingTimeOff] = useState(false);
  const [deletingTimeOffId, setDeletingTimeOffId] = useState<string | null>(null);

  // For demo purposes, use a fixed technician ID
  // In production, this would come from the authenticated user's profile
  const technicianId = 'tech_daniela';

  // Fetch schedule and time-off
  const fetchData = useCallback(async () => {
    if (!salonSlug) return;

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

      // Fetch time-off
      const timeOffResponse = await fetch(
        `/api/staff/time-off?technicianId=${technicianId}&salonSlug=${salonSlug}`,
      );
      if (timeOffResponse.ok) {
        const data = await timeOffResponse.json();
        setTimeOffEntries(data.data?.timeOff || []);
      }
    } catch (error) {
      console.error('Failed to fetch schedule:', error);
    } finally {
      setLoading(false);
    }
  }, [salonSlug]);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (isLoaded && user && salonSlug) {
      fetchData();
    }
  }, [isLoaded, user, salonSlug, fetchData]);

  // Save schedule
  const handleSaveSchedule = async () => {
    if (!salonSlug) return;

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
        // Show success feedback
      }
    } catch (error) {
      console.error('Failed to save schedule:', error);
    } finally {
      setSaving(false);
    }
  };

  // Update day schedule
  const handleDayChange = (day: keyof WeeklySchedule, schedule: DaySchedule) => {
    setWeeklySchedule((prev) => ({
      ...prev,
      [day]: schedule,
    }));
  };

  // Add time-off
  const handleAddTimeOff = async (startDate: string, endDate: string, reason: string, notes: string) => {
    if (!salonSlug) return;

    setAddingTimeOff(true);
    try {
      const response = await fetch('/api/staff/time-off', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          technicianId,
          salonSlug,
          startDate: new Date(startDate).toISOString(),
          endDate: new Date(endDate).toISOString(),
          reason,
          notes,
        }),
      });

      if (response.ok) {
        await fetchData();
        setShowAddTimeOff(false);
      }
    } catch (error) {
      console.error('Failed to add time-off:', error);
    } finally {
      setAddingTimeOff(false);
    }
  };

  // Delete time-off
  const handleDeleteTimeOff = async (id: string) => {
    if (!salonSlug) return;

    setDeletingTimeOffId(id);
    try {
      const response = await fetch(`/api/staff/time-off/${id}?salonSlug=${salonSlug}`, {
        method: 'DELETE',
      });

      if (response.ok) {
        setTimeOffEntries((prev) => prev.filter((e) => e.id !== id));
      }
    } catch (error) {
      console.error('Failed to delete time-off:', error);
    } finally {
      setDeletingTimeOffId(null);
    }
  };

  if (!isLoaded) {
    return (
      <div className="flex min-h-screen items-center justify-center" style={{ backgroundColor: themeVars.background }}>
        <div
          className="size-8 animate-spin rounded-full border-4 border-t-transparent"
          style={{ borderColor: `${themeVars.primary} transparent ${themeVars.primary} ${themeVars.primary}` }}
        />
      </div>
    );
  }

  if (!user) {
    return (
      <div
        className="flex min-h-screen flex-col items-center justify-center p-4"
        style={{ backgroundColor: themeVars.background }}
      >
        <h1 className="mb-4 text-2xl font-bold" style={{ color: themeVars.titleText }}>
          Staff Access Required
        </h1>
        <p className="text-neutral-600">Please sign in to access this page.</p>
      </div>
    );
  }

  return (
    <div
      className="min-h-screen pb-24"
      style={{
        background: `linear-gradient(to bottom, ${themeVars.background}, color-mix(in srgb, ${themeVars.background} 95%, ${themeVars.primaryDark}))`,
      }}
    >
      <div className="mx-auto max-w-2xl px-4">
        {/* Header */}
        <div
          className="pb-4 pt-6"
          style={{
            opacity: mounted ? 1 : 0,
            transform: mounted ? 'translateY(0)' : 'translateY(-8px)',
            transition: 'opacity 300ms ease-out, transform 300ms ease-out',
          }}
        >
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => router.push(`/${locale}/staff`)}
              className="flex size-10 items-center justify-center rounded-full transition-colors hover:bg-white/60"
            >
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                <path d="M12.5 15L7.5 10L12.5 5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
            <div>
              <h1 className="text-xl font-bold" style={{ color: themeVars.titleText }}>
                My Schedule
              </h1>
              <p className="text-sm text-neutral-600">{salonName}</p>
            </div>
          </div>
        </div>

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
                      onChange={(schedule) => handleDayChange(day, schedule)}
                    />
                  ))}
                </div>
              </div>
            </div>

            {/* Time Off */}
            <div
              className="overflow-hidden rounded-2xl bg-white shadow-lg"
              style={{ borderColor: themeVars.cardBorder, borderWidth: 1 }}
            >
              <div className="p-4">
                <div className="mb-4 flex items-center justify-between">
                  <h2 className="font-bold" style={{ color: themeVars.titleText }}>
                    Time Off
                  </h2>
                  {!showAddTimeOff && (
                    <button
                      type="button"
                      onClick={() => setShowAddTimeOff(true)}
                      className="rounded-full px-4 py-1.5 text-sm font-medium transition-colors"
                      style={{ backgroundColor: themeVars.selectedBackground, color: themeVars.titleText }}
                    >
                      + Add
                    </button>
                  )}
                </div>

                {showAddTimeOff ? (
                  <AddTimeOffForm
                    onAdd={handleAddTimeOff}
                    onCancel={() => setShowAddTimeOff(false)}
                    isSubmitting={addingTimeOff}
                  />
                ) : timeOffEntries.length === 0 ? (
                  <div className="py-6 text-center text-neutral-500">
                    <div className="mb-2 text-2xl">📅</div>
                    <p>No time off scheduled</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {timeOffEntries.map((entry) => (
                      <TimeOffCard
                        key={entry.id}
                        entry={entry}
                        onDelete={handleDeleteTimeOff}
                        isDeleting={deletingTimeOffId === entry.id}
                      />
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Bottom Navigation */}
      <div
        className="fixed bottom-0 left-0 right-0 border-t bg-white/95 px-4 py-3 backdrop-blur-sm"
        style={{ borderColor: themeVars.cardBorder }}
      >
        <div className="mx-auto flex max-w-2xl items-center justify-around">
          <button
            type="button"
            onClick={() => router.push(`/${locale}/staff`)}
            className="flex flex-col items-center gap-0.5 text-center text-neutral-500"
          >
            <span className="text-xl">🏠</span>
            <span className="text-xs font-medium">Home</span>
          </button>
          <button
            type="button"
            onClick={() => router.push(`/${locale}/staff/appointments`)}
            className="flex flex-col items-center gap-0.5 text-center text-neutral-500"
          >
            <span className="text-xl">📸</span>
            <span className="text-xs font-medium">Photos</span>
          </button>
          <button
            type="button"
            onClick={() => router.push(`/${locale}/staff/schedule`)}
            className="flex flex-col items-center gap-0.5 text-center"
            style={{ color: themeVars.accent }}
          >
            <span className="text-xl">⏰</span>
            <span className="text-xs font-medium">Schedule</span>
          </button>
        </div>
      </div>
    </div>
  );
}

