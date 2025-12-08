'use client';

import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Copy, Check, Plus, Calendar, X, Trash2 } from 'lucide-react';

import { useSalon } from '@/providers/SalonProvider';
import { TIME_OFF_REASONS, type TimeOffReason } from '@/models/Schema';

// =============================================================================
// Types
// =============================================================================

type DaySchedule = { start: string; end: string } | null;
type WeeklySchedule = Record<string, DaySchedule>;

interface TimeOffEntry {
  id: string;
  startDate: string;
  endDate: string;
  reason: string | null;
  notes: string | null;
}

interface ScheduleTabProps {
  technicianId: string;
  weeklySchedule: WeeklySchedule | null;
  onUpdate: (schedule: WeeklySchedule) => void;
}

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
  '06:00', '06:30', '07:00', '07:30', '08:00', '08:30', '09:00', '09:30',
  '10:00', '10:30', '11:00', '11:30', '12:00', '12:30', '13:00', '13:30',
  '14:00', '14:30', '15:00', '15:30', '16:00', '16:30', '17:00', '17:30',
  '18:00', '18:30', '19:00', '19:30', '20:00', '20:30', '21:00', '21:30', '22:00',
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
    }
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
    if (!salonSlug) return;

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
    if (!salonSlug || !newTimeOff.startDate || !newTimeOff.endDate) return;

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
    if (!salonSlug) return;

    try {
      const response = await fetch(`/api/staff/time-off/${id}?salonSlug=${salonSlug}`, {
        method: 'DELETE',
      });

      if (response.ok) {
        setTimeOff((prev) => prev.filter((t) => t.id !== id));
      }
    } catch (err) {
      console.error('Error deleting time off:', err);
    }
  };

  const toggleDay = (dayKey: string) => {
    setSchedule((prev) => ({
      ...prev,
      [dayKey]: prev[dayKey] ? null : { start: '09:00', end: '18:00' },
    }));
  };

  const updateTime = (dayKey: string, field: 'start' | 'end', value: string) => {
    setSchedule((prev) => ({
      ...prev,
      [dayKey]: prev[dayKey]
        ? { ...prev[dayKey]!, [field]: value }
        : { start: '09:00', end: '18:00', [field]: value },
    }));
  };

  const copyToAll = (sourceDayKey: string) => {
    const sourceSchedule = schedule[sourceDayKey];
    if (!sourceSchedule) return;

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
    if (!salonSlug) return;

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
    <div className="p-4 space-y-4 pb-24">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-[13px] font-semibold text-[#8E8E93] uppercase px-1">
          Weekly Schedule
        </h3>
      </div>

      {/* Schedule Grid */}
      <div className="bg-white rounded-[12px] overflow-hidden">
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
                    className={`w-[51px] h-[31px] rounded-full p-[2px] transition-colors ${
                      isWorking ? 'bg-[#34C759]' : 'bg-[#E5E5EA]'
                    }`}
                  >
                    <motion.div
                      className="w-[27px] h-[27px] bg-white rounded-full shadow-sm"
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
                    className="p-2 text-[#007AFF] active:bg-gray-100 rounded-lg"
                    title="Copy to all working days"
                  >
                    <Copy className="w-4 h-4" />
                  </button>
                )}
              </div>

              {/* Time Pickers */}
              {isWorking && (
                <div className="flex items-center gap-3 mt-3 ml-[63px]">
                  <select
                    value={daySchedule?.start ?? '09:00'}
                    onChange={(e) => updateTime(day.key, 'start', e.target.value)}
                    aria-label={`${day.label} start time`}
                    className="flex-1 py-2 px-3 bg-[#F2F2F7] rounded-lg text-[15px] text-[#1C1C1E] focus:outline-none"
                  >
                    {TIME_OPTIONS.map((time) => (
                      <option key={time} value={time}>
                        {formatTime(time)}
                      </option>
                    ))}
                  </select>
                  <span className="text-[#8E8E93]">to</span>
                  <select
                    value={daySchedule?.end ?? '18:00'}
                    onChange={(e) => updateTime(day.key, 'end', e.target.value)}
                    aria-label={`${day.label} end time`}
                    className="flex-1 py-2 px-3 bg-[#F2F2F7] rounded-lg text-[15px] text-[#1C1C1E] focus:outline-none"
                  >
                    {TIME_OPTIONS.map((time) => (
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
          w-full py-3 rounded-xl text-[17px] font-semibold
          flex items-center justify-center gap-2
          ${saved ? 'bg-[#34C759] text-white' : 'bg-[#007AFF] text-white'}
          disabled:opacity-50
        `}
      >
        {saved ? (
          <>
            <Check className="w-5 h-5" />
            Saved
          </>
        ) : saving ? (
          'Saving...'
        ) : (
          'Save Schedule'
        )}
      </button>

      {/* Time Off Section */}
      <div className="pt-4">
        <div className="flex items-center justify-between mb-2 px-1">
          <h3 className="text-[13px] font-semibold text-[#8E8E93] uppercase">
            Time Off
          </h3>
          <button
            type="button"
            onClick={() => setShowAddTimeOff(true)}
            className="flex items-center gap-1 text-[#007AFF] text-[13px] font-medium"
          >
            <Plus className="w-4 h-4" />
            Add
          </button>
        </div>

        {loadingTimeOff ? (
          <div className="bg-white rounded-[12px] p-4 animate-pulse">
            <div className="h-12 bg-gray-100 rounded" />
          </div>
        ) : timeOff.length === 0 ? (
          <div className="bg-white rounded-[12px] p-6 text-center">
            <Calendar className="w-8 h-8 text-[#C7C7CC] mx-auto mb-2" />
            <p className="text-[15px] text-[#8E8E93]">No upcoming time off</p>
          </div>
        ) : (
          <div className="bg-white rounded-[12px] overflow-hidden">
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
            className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4"
            onClick={() => setShowAddTimeOff(false)}
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-white rounded-[20px] p-6 max-w-sm w-full"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-[20px] font-bold text-[#1C1C1E]">Add Time Off</h3>
                <button
                  type="button"
                  onClick={() => setShowAddTimeOff(false)}
                  aria-label="Close"
                  className="p-1 text-[#8E8E93]"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="space-y-4">
                {/* Start Date */}
                <div>
                  <label htmlFor="timeoff-start" className="block text-[13px] text-[#8E8E93] mb-1">Start Date</label>
                  <input
                    id="timeoff-start"
                    type="date"
                    value={newTimeOff.startDate}
                    onChange={(e) => setNewTimeOff((prev) => ({ ...prev, startDate: e.target.value }))}
                    min={new Date().toISOString().split('T')[0]}
                    className="w-full py-2.5 px-3 bg-[#F2F2F7] rounded-lg text-[15px] text-[#1C1C1E] focus:outline-none"
                  />
                </div>

                {/* End Date */}
                <div>
                  <label htmlFor="timeoff-end" className="block text-[13px] text-[#8E8E93] mb-1">End Date</label>
                  <input
                    id="timeoff-end"
                    type="date"
                    value={newTimeOff.endDate}
                    onChange={(e) => setNewTimeOff((prev) => ({ ...prev, endDate: e.target.value }))}
                    min={newTimeOff.startDate || new Date().toISOString().split('T')[0]}
                    className="w-full py-2.5 px-3 bg-[#F2F2F7] rounded-lg text-[15px] text-[#1C1C1E] focus:outline-none"
                  />
                </div>

                {/* Reason */}
                <div>
                  <label className="block text-[13px] text-[#8E8E93] mb-1">Reason</label>
                  <div className="flex flex-wrap gap-2">
                    {REASON_OPTIONS.map((option) => (
                      <button
                        key={option.value}
                        type="button"
                        onClick={() => setNewTimeOff((prev) => ({ ...prev, reason: option.value }))}
                        className={`px-3 py-1.5 rounded-full text-[13px] font-medium transition-colors ${
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
                  <label className="block text-[13px] text-[#8E8E93] mb-1">Notes (optional)</label>
                  <textarea
                    value={newTimeOff.notes}
                    onChange={(e) => setNewTimeOff((prev) => ({ ...prev, notes: e.target.value }))}
                    placeholder="Additional details..."
                    rows={2}
                    className="w-full py-2.5 px-3 bg-[#F2F2F7] rounded-lg text-[15px] text-[#1C1C1E] placeholder-[#C7C7CC] focus:outline-none resize-none"
                  />
                </div>
              </div>

              <div className="flex gap-3 mt-6">
                <button
                  type="button"
                  onClick={() => setShowAddTimeOff(false)}
                  className="flex-1 py-3 bg-[#E5E5EA] text-[#1C1C1E] rounded-xl text-[17px] font-medium"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleAddTimeOff}
                  disabled={addingTimeOff || !newTimeOff.startDate || !newTimeOff.endDate}
                  className="flex-1 py-3 bg-[#007AFF] text-white rounded-xl text-[17px] font-medium disabled:opacity-50"
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
    const option = REASON_OPTIONS.find((r) => r.value === reason);
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
    <div className={`p-4 flex items-center justify-between ${!isLast ? 'border-b border-gray-100' : ''}`}>
      <div>
        <div className="flex items-center gap-2 mb-1">
          <span className={`px-2 py-0.5 rounded-full text-[11px] font-medium ${getReasonColor(entry.reason)}`}>
            {getReasonLabel(entry.reason)}
          </span>
        </div>
        <div className="text-[15px] text-[#1C1C1E]">
          {formatDate(entry.startDate)} — {formatDate(entry.endDate)}
        </div>
        {entry.notes && (
          <p className="text-[13px] text-[#8E8E93] mt-0.5">{entry.notes}</p>
        )}
      </div>
      <button
        type="button"
        onClick={onDelete}
        aria-label="Delete time off"
        className="p-2 text-[#FF3B30] hover:bg-red-50 rounded-lg"
      >
        <Trash2 className="w-4 h-4" />
      </button>
    </div>
  );
}
