'use client';

import { AnimatePresence, motion } from 'framer-motion';
import { Calendar, Check, Copy, Plus, Trash2, X } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

import type { TimeOffReason } from '@/models/Schema';
import { useSalon } from '@/providers/SalonProvider';

// =============================================================================
// Types
// =============================================================================

type DaySchedule = { start: string; end: string } | null;
type WeeklySchedule = Record<string, DaySchedule>;

type TimeOffEntry = {
  id: string;
  startDate: string;
  endDate: string;
  reason: string | null;
  notes: string | null;
};

type ScheduleTabProps = {
  technicianId: string;
  weeklySchedule: WeeklySchedule | null;
  onUpdate: (schedule: WeeklySchedule) => void;
};

const DAYS = [
  { key: 'sunday', label: 'Sunday', short: 'Sun' },
  { key: 'monday', label: 'Monday', short: 'Mon' },
  { key: 'tuesday', label: 'Tuesday', short: 'Tue' },
  { key: 'wednesday', label: 'Wednesday', short: 'Wed' },
  { key: 'thursday', label: 'Thursday', short: 'Thu' },
  { key: 'friday', label: 'Friday', short: 'Fri' },
  { key: 'saturday', label: 'Saturday', short: 'Sat' },
];

const TIME_OPTIONS = [
  '06:00',
  '06:30',
  '07:00',
  '07:30',
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
  '20:30',
  '21:00',
  '21:30',
  '22:00',
];

const REASON_OPTIONS: { value: TimeOffReason; label: string }[] = [
  { value: 'vacation', label: 'Vacation' },
  { value: 'sick', label: 'Sick Day' },
  { value: 'personal', label: 'Personal' },
  { value: 'training', label: 'Training' },
  { value: 'other', label: 'Other' },
];

// =============================================================================
// Component
// =============================================================================

export function ScheduleTab({ technicianId, weeklySchedule, onUpdate }: ScheduleTabProps) {
  const { salonSlug } = useSalon();
  const [schedule, setSchedule] = useState<WeeklySchedule>(
    weeklySchedule ?? {
      sunday: null,
      monday: { start: '09:00', end: '18:00' },
      tuesday: { start: '09:00', end: '18:00' },
      wednesday: { start: '09:00', end: '18:00' },
      thursday: { start: '09:00', end: '18:00' },
      friday: { start: '09:00', end: '18:00' },
      saturday: null,
    },
  );
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  // Time off state
  const [timeOff, setTimeOff] = useState<TimeOffEntry[]>([]);
  const [loadingTimeOff, setLoadingTimeOff] = useState(true);
  const [showAddTimeOff, setShowAddTimeOff] = useState(false);
  const [newTimeOff, setNewTimeOff] = useState({
    startDate: '',
    endDate: '',
    reason: 'vacation' as TimeOffReason,
    notes: '',
  });
  const [addingTimeOff, setAddingTimeOff] = useState(false);

  // Fetch time off entries
  const fetchTimeOff = useCallback(async () => {
    if (!salonSlug) {
      return;
    }

    try {
      setLoadingTimeOff(true);
      const params = new URLSearchParams({
        technicianId,
        salonSlug,
      });
      const response = await fetch(`/api/staff/time-off?${params}`);
      if (response.ok) {
        const result = await response.json();
        setTimeOff(result.data?.timeOff ?? []);
      }
    } catch (err) {
      console.error('Error fetching time off:', err);
    } finally {
      setLoadingTimeOff(false);
    }
  }, [salonSlug, technicianId]);

  useEffect(() => {
    fetchTimeOff();
  }, [fetchTimeOff]);

  const handleAddTimeOff = async () => {
    if (!salonSlug || !newTimeOff.startDate || !newTimeOff.endDate) {
      return;
    }

    setAddingTimeOff(true);
    try {
      const response = await fetch('/api/staff/time-off', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          technicianId,
          salonSlug,
          startDate: new Date(newTimeOff.startDate).toISOString(),
          endDate: new Date(newTimeOff.endDate).toISOString(),
          reason: newTimeOff.reason,
          notes: newTimeOff.notes || undefined,
        }),
      });

      if (response.ok) {
        await fetchTimeOff();
        setShowAddTimeOff(false);
        setNewTimeOff({
          startDate: '',
          endDate: '',
          reason: 'vacation',
          notes: '',
        });
      }
    } catch (err) {
      console.error('Error adding time off:', err);
    } finally {
      setAddingTimeOff(false);
    }
  };

  const handleDeleteTimeOff = async (id: string) => {
    if (!salonSlug) {
      return;
    }

    try {
      const response = await fetch(`/api/staff/time-off/${id}?salonSlug=${salonSlug}`, {
        method: 'DELETE',
      });

      if (response.ok) {
        setTimeOff(prev => prev.filter(t => t.id !== id));
      }
    } catch (err) {
      console.error('Error deleting time off:', err);
    }
  };

  const toggleDay = (dayKey: string) => {
    setSchedule(prev => ({
      ...prev,
      [dayKey]: prev[dayKey] ? null : { start: '09:00', end: '18:00' },
    }));
  };

  const updateTime = (dayKey: string, field: 'start' | 'end', value: string) => {
    setSchedule(prev => ({
      ...prev,
      [dayKey]: prev[dayKey]
        ? { ...prev[dayKey]!, [field]: value }
        : { start: '09:00', end: '18:00', [field]: value },
    }));
  };

  const copyToAll = (sourceDayKey: string) => {
    const sourceSchedule = schedule[sourceDayKey];
    if (!sourceSchedule) {
      return;
    }

    setSchedule((prev) => {
      const newSchedule = { ...prev };
      DAYS.forEach((day) => {
        if (day.key !== sourceDayKey && prev[day.key] !== null) {
          newSchedule[day.key] = { ...sourceSchedule };
        }
      });
      return newSchedule;
    });
  };

  const handleSave = async () => {
    if (!salonSlug) {
      return;
    }

    setSaving(true);
    try {
      const response = await fetch(`/api/admin/technicians/${technicianId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          salonSlug,
          weeklySchedule: schedule,
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to save schedule');
      }

      onUpdate(schedule);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      console.error('Error saving schedule:', err);
    } finally {
      setSaving(false);
    }
  };

  const formatTime = (time: string): string => {
    const [hours, minutes] = time.split(':').map(Number);
    const h = hours! % 12 || 12;
    const period = hours! >= 12 ? 'PM' : 'AM';
    return `${h}:${String(minutes).padStart(2, '0')} ${period}`;
  };

  return (
    <div className="space-y-4 p-4 pb-24">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="px-1 text-[13px] font-semibold uppercase text-[#8E8E93]">
          Weekly Schedule
        </h3>
      </div>

      {/* Schedule Grid */}
      <div className="overflow-hidden rounded-[12px] bg-white">
        {DAYS.map((day, index) => {
          const daySchedule = schedule[day.key];
          const isWorking = daySchedule !== null;

          return (
            <div
              key={day.key}
              className={`p-4 ${index !== DAYS.length - 1 ? 'border-b border-gray-100' : ''}`}
            >
              <div className="flex items-center justify-between">
                {/* Day Toggle */}
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => toggleDay(day.key)}
                    aria-label={`Toggle ${day.label} working`}
                    className={`h-[31px] w-[51px] rounded-full p-[2px] transition-colors ${
                      isWorking ? 'bg-[#34C759]' : 'bg-[#E5E5EA]'
                    }`}
                  >
                    <motion.div
                      className="size-[27px] rounded-full bg-white shadow-sm"
                      animate={{ x: isWorking ? 20 : 0 }}
                      transition={{ type: 'spring', stiffness: 500, damping: 30 }}
                    />
                  </button>
                  <span className={`text-[17px] ${isWorking ? 'text-[#1C1C1E]' : 'text-[#8E8E93]'}`}>
                    {day.label}
                  </span>
                </div>

                {/* Copy Button */}
                {isWorking && (
                  <button
                    type="button"
                    onClick={() => copyToAll(day.key)}
                    className="rounded-lg p-2 text-[#007AFF] active:bg-gray-100"
                    title="Copy to all working days"
                  >
                    <Copy className="size-4" />
                  </button>
                )}
              </div>

              {/* Time Pickers */}
              {isWorking && (
                <div className="ml-[63px] mt-3 flex items-center gap-3">
                  <select
                    value={daySchedule?.start ?? '09:00'}
                    onChange={e => updateTime(day.key, 'start', e.target.value)}
                    aria-label={`${day.label} start time`}
                    className="flex-1 rounded-lg bg-[#F2F2F7] px-3 py-2 text-[15px] text-[#1C1C1E] focus:outline-none"
                  >
                    {TIME_OPTIONS.map(time => (
                      <option key={time} value={time}>
                        {formatTime(time)}
                      </option>
                    ))}
                  </select>
                  <span className="text-[#8E8E93]">to</span>
                  <select
                    value={daySchedule?.end ?? '18:00'}
                    onChange={e => updateTime(day.key, 'end', e.target.value)}
                    aria-label={`${day.label} end time`}
                    className="flex-1 rounded-lg bg-[#F2F2F7] px-3 py-2 text-[15px] text-[#1C1C1E] focus:outline-none"
                  >
                    {TIME_OPTIONS.map(time => (
                      <option key={time} value={time}>
                        {formatTime(time)}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Save Button */}
      <button
        type="button"
        onClick={handleSave}
        disabled={saving}
        className={`
          flex w-full items-center justify-center gap-2
          rounded-xl py-3 text-[17px] font-semibold
          ${saved ? 'bg-[#34C759] text-white' : 'bg-[#007AFF] text-white'}
          disabled:opacity-50
        `}
      >
        {saved
          ? (
              <>
                <Check className="size-5" />
                Saved
              </>
            )
          : saving
            ? (
                'Saving...'
              )
            : (
                'Save Schedule'
              )}
      </button>

      {/* Time Off Section */}
      <div className="pt-4">
        <div className="mb-2 flex items-center justify-between px-1">
          <h3 className="text-[13px] font-semibold uppercase text-[#8E8E93]">
            Time Off
          </h3>
          <button
            type="button"
            onClick={() => setShowAddTimeOff(true)}
            className="flex items-center gap-1 text-[13px] font-medium text-[#007AFF]"
          >
            <Plus className="size-4" />
            Add
          </button>
        </div>

        {loadingTimeOff
          ? (
              <div className="animate-pulse rounded-[12px] bg-white p-4">
                <div className="h-12 rounded bg-gray-100" />
              </div>
            )
          : timeOff.length === 0
            ? (
                <div className="rounded-[12px] bg-white p-6 text-center">
                  <Calendar className="mx-auto mb-2 size-8 text-[#C7C7CC]" />
                  <p className="text-[15px] text-[#8E8E93]">No upcoming time off</p>
                </div>
              )
            : (
                <div className="overflow-hidden rounded-[12px] bg-white">
                  {timeOff.map((entry, index) => (
                    <TimeOffRow
                      key={entry.id}
                      entry={entry}
                      isLast={index === timeOff.length - 1}
                      onDelete={() => handleDeleteTimeOff(entry.id)}
                    />
                  ))}
                </div>
              )}
      </div>

      {/* Add Time Off Modal */}
      <AnimatePresence>
        {showAddTimeOff && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
            onClick={() => setShowAddTimeOff(false)}
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="w-full max-w-sm rounded-[20px] bg-white p-6"
              onClick={e => e.stopPropagation()}
            >
              <div className="mb-4 flex items-center justify-between">
                <h3 className="text-[20px] font-bold text-[#1C1C1E]">Add Time Off</h3>
                <button
                  type="button"
                  onClick={() => setShowAddTimeOff(false)}
                  aria-label="Close"
                  className="p-1 text-[#8E8E93]"
                >
                  <X className="size-5" />
                </button>
              </div>

              <div className="space-y-4">
                {/* Start Date */}
                <div>
                  <label htmlFor="timeoff-start" className="mb-1 block text-[13px] text-[#8E8E93]">Start Date</label>
                  <input
                    id="timeoff-start"
                    type="date"
                    value={newTimeOff.startDate}
                    onChange={e => setNewTimeOff(prev => ({ ...prev, startDate: e.target.value }))}
                    min={new Date().toISOString().split('T')[0]}
                    className="w-full rounded-lg bg-[#F2F2F7] px-3 py-2.5 text-[15px] text-[#1C1C1E] focus:outline-none"
                  />
                </div>

                {/* End Date */}
                <div>
                  <label htmlFor="timeoff-end" className="mb-1 block text-[13px] text-[#8E8E93]">End Date</label>
                  <input
                    id="timeoff-end"
                    type="date"
                    value={newTimeOff.endDate}
                    onChange={e => setNewTimeOff(prev => ({ ...prev, endDate: e.target.value }))}
                    min={newTimeOff.startDate || new Date().toISOString().split('T')[0]}
                    className="w-full rounded-lg bg-[#F2F2F7] px-3 py-2.5 text-[15px] text-[#1C1C1E] focus:outline-none"
                  />
                </div>

                {/* Reason */}
                <div>
                  <label className="mb-1 block text-[13px] text-[#8E8E93]">Reason</label>
                  <div className="flex flex-wrap gap-2">
                    {REASON_OPTIONS.map(option => (
                      <button
                        key={option.value}
                        type="button"
                        onClick={() => setNewTimeOff(prev => ({ ...prev, reason: option.value }))}
                        className={`rounded-full px-3 py-1.5 text-[13px] font-medium transition-colors ${
                          newTimeOff.reason === option.value
                            ? 'bg-[#007AFF] text-white'
                            : 'bg-[#E5E5EA] text-[#1C1C1E]'
                        }`}
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Notes */}
                <div>
                  <label className="mb-1 block text-[13px] text-[#8E8E93]">Notes (optional)</label>
                  <textarea
                    value={newTimeOff.notes}
                    onChange={e => setNewTimeOff(prev => ({ ...prev, notes: e.target.value }))}
                    placeholder="Additional details..."
                    rows={2}
                    className="w-full resize-none rounded-lg bg-[#F2F2F7] px-3 py-2.5 text-[15px] text-[#1C1C1E] placeholder-[#C7C7CC] focus:outline-none"
                  />
                </div>
              </div>

              <div className="mt-6 flex gap-3">
                <button
                  type="button"
                  onClick={() => setShowAddTimeOff(false)}
                  className="flex-1 rounded-xl bg-[#E5E5EA] py-3 text-[17px] font-medium text-[#1C1C1E]"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleAddTimeOff}
                  disabled={addingTimeOff || !newTimeOff.startDate || !newTimeOff.endDate}
                  className="flex-1 rounded-xl bg-[#007AFF] py-3 text-[17px] font-medium text-white disabled:opacity-50"
                >
                  {addingTimeOff ? 'Adding...' : 'Add'}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// =============================================================================
// Time Off Row
// =============================================================================

function TimeOffRow({
  entry,
  isLast,
  onDelete,
}: {
  entry: TimeOffEntry;
  isLast: boolean;
  onDelete: () => void;
}) {
  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  };

  const getReasonLabel = (reason: string | null) => {
    const option = REASON_OPTIONS.find(r => r.value === reason);
    return option?.label ?? 'Time Off';
  };

  const getReasonColor = (reason: string | null) => {
    switch (reason) {
      case 'vacation':
        return 'bg-blue-100 text-blue-700';
      case 'sick':
        return 'bg-red-100 text-red-700';
      case 'personal':
        return 'bg-purple-100 text-purple-700';
      case 'training':
        return 'bg-green-100 text-green-700';
      default:
        return 'bg-gray-100 text-gray-700';
    }
  };

  return (
    <div className={`flex items-center justify-between p-4 ${!isLast ? 'border-b border-gray-100' : ''}`}>
      <div>
        <div className="mb-1 flex items-center gap-2">
          <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${getReasonColor(entry.reason)}`}>
            {getReasonLabel(entry.reason)}
          </span>
        </div>
        <div className="text-[15px] text-[#1C1C1E]">
          {formatDate(entry.startDate)}
          {' '}
          —
          {formatDate(entry.endDate)}
        </div>
        {entry.notes && (
          <p className="mt-0.5 text-[13px] text-[#8E8E93]">{entry.notes}</p>
        )}
      </div>
      <button
        type="button"
        onClick={onDelete}
        aria-label="Delete time off"
        className="rounded-lg p-2 text-[#FF3B30] hover:bg-red-50"
      >
        <Trash2 className="size-4" />
      </button>
    </div>
  );
}
