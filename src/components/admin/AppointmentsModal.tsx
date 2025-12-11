'use client';

/**
 * AppointmentsModal Component
 *
 * iOS Calendar Day View for appointments.
 * Features:
 * - Time grid with hour markers
 * - Floating appointment cards
 * - Current time indicator (red line)
 * - Day selector header
 * - Fetches real data from /api/appointments
 */

import { motion } from 'framer-motion';
import { Search, Plus, Calendar } from 'lucide-react';
import { useState, useEffect, useCallback } from 'react';

import { useSalon } from '@/providers/SalonProvider';

import { ModalHeader, BackButton } from './AppModal';

// Generate hours from 8 AM to 8 PM
const HOURS = Array.from({ length: 13 }, (_, i) => i + 8);

// Appointment interface for display
interface Appointment {
  id: string;
  client: string;
  service: string;
  time: string;
  startRow: number; // Hours after 8 AM (e.g., 9:30 = 1.5)
  duration: number; // In hours
  color: string;
  borderColor: string;
  avatar: string;
  status: string;
}

// Color schemes for different appointment statuses
const STATUS_COLORS: Record<string, { color: string; borderColor: string }> = {
  confirmed: { color: 'bg-blue-50 text-blue-700', borderColor: 'border-blue-500' },
  pending: { color: 'bg-yellow-50 text-yellow-700', borderColor: 'border-yellow-500' },
  in_progress: { color: 'bg-green-50 text-green-700', borderColor: 'border-green-500' },
  completed: { color: 'bg-gray-50 text-gray-600', borderColor: 'border-gray-400' },
  cancelled: { color: 'bg-red-50 text-red-600', borderColor: 'border-red-400' },
  no_show: { color: 'bg-orange-50 text-orange-600', borderColor: 'border-orange-400' },
};

interface AppointmentsModalProps {
  onClose: () => void;
}

/**
 * Format hour to 12-hour format
 */
function formatHour(hour: number): string {
  const h = hour > 12 ? hour - 12 : hour;
  const period = hour >= 12 ? 'PM' : 'AM';
  return `${h} ${period}`;
}

/**
 * Get current time position as percentage of day
 */
function getCurrentTimePosition(): { top: number; time: string } {
  const now = new Date();
  const hours = now.getHours();
  const minutes = now.getMinutes();

  // Calculate position relative to 8 AM start
  const hoursAfter8 = hours - 8 + minutes / 60;
  const top = hoursAfter8 * 96 + 16; // 96px per hour + 16px offset

  const timeStr = now.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: false,
  });

  return { top, time: timeStr };
}

/**
 * Format time range for display
 */
function formatTimeRange(startTime: string, endTime: string): string {
  const start = new Date(startTime);
  const end = new Date(endTime);
  
  const formatTime = (d: Date) => d.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
  
  return `${formatTime(start)} - ${formatTime(end)}`;
}

/**
 * Calculate start row (hours after 8 AM) from ISO datetime
 */
function calculateStartRow(startTime: string): number {
  const date = new Date(startTime);
  const hours = date.getHours();
  const minutes = date.getMinutes();
  return hours - 8 + minutes / 60;
}

/**
 * Calculate duration in hours from start and end times
 */
function calculateDuration(startTime: string, endTime: string): number {
  const start = new Date(startTime);
  const end = new Date(endTime);
  return (end.getTime() - start.getTime()) / (1000 * 60 * 60);
}

/**
 * Get initials from name
 */
function getInitials(name: string | null): string {
  if (!name) return '??';
  return name
    .split(' ')
    .map(n => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);
}

/**
 * Loading Skeleton
 */
function LoadingSkeleton() {
  return (
    <div className="animate-pulse p-4 space-y-4">
      {[1, 2, 3].map((i) => (
        <div key={i} className="h-20 bg-gray-100 rounded-lg" />
      ))}
    </div>
  );
}

/**
 * Empty State
 */
function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center py-20 px-8">
      <div className="w-16 h-16 rounded-full bg-[#F2F2F7] flex items-center justify-center mb-4">
        <Calendar className="w-8 h-8 text-[#8E8E93]" />
      </div>
      <h3 className="text-[17px] font-semibold text-[#1C1C1E] mb-1">
        No Appointments Today
      </h3>
      <p className="text-[15px] text-[#8E8E93] text-center">
        You don&apos;t have any appointments scheduled for today
      </p>
    </div>
  );
}

export function AppointmentsModal({ onClose }: AppointmentsModalProps) {
  const { salonSlug } = useSalon();
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedDate, setSelectedDate] = useState(new Date());
  
  const { top: currentTimeTop, time: currentTime } = getCurrentTimePosition();
  const dayName = selectedDate.toLocaleDateString('en-US', { weekday: 'long' });
  const dayNumber = selectedDate.getDate();
  const monthName = selectedDate.toLocaleDateString('en-US', { month: 'short' });

  // Get the current week's dates
  const getWeekDates = useCallback(() => {
    const today = new Date();
    const dayOfWeek = today.getDay();
    const weekStart = new Date(today);
    weekStart.setDate(today.getDate() - dayOfWeek);
    
    return Array.from({ length: 7 }, (_, i) => {
      const date = new Date(weekStart);
      date.setDate(weekStart.getDate() + i);
      return date;
    });
  }, []);

  const weekDates = getWeekDates();
  const days = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

  // Fetch appointments for the selected date
  const fetchAppointments = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      
      // Format date as YYYY-MM-DD
      const dateStr = selectedDate.toISOString().split('T')[0];
      
      const response = await fetch(
        `/api/appointments?date=${dateStr}&status=pending,confirmed,in_progress,completed&salonSlug=${salonSlug}`
      );
      
      if (!response.ok) {
        throw new Error('Failed to load appointments');
      }
      
      const result = await response.json();
      const rawAppointments = result.data?.appointments || [];
      
      // Transform API data to component format
      const transformedAppointments: Appointment[] = rawAppointments.map((appt: {
        id: string;
        clientName: string | null;
        startTime: string;
        endTime: string;
        status: string;
        services?: { name: string }[];
      }) => {
        const statusColors = STATUS_COLORS[appt.status] ?? STATUS_COLORS.confirmed;
        const serviceNames = appt.services?.map((s) => s.name).join(', ') || 'Service';
        
        return {
          id: appt.id,
          client: appt.clientName || 'Guest',
          service: serviceNames,
          time: formatTimeRange(appt.startTime, appt.endTime),
          startRow: calculateStartRow(appt.startTime),
          duration: calculateDuration(appt.startTime, appt.endTime),
          color: statusColors!.color,
          borderColor: statusColors!.borderColor,
          avatar: getInitials(appt.clientName),
          status: appt.status,
        };
      });
      
      // Filter to only show appointments within the visible time range (8 AM - 8 PM)
      const visibleAppointments = transformedAppointments.filter(
        (appt) => appt.startRow >= 0 && appt.startRow < 12
      );
      
      setAppointments(visibleAppointments);
    } catch (err) {
      console.error('Failed to fetch appointments:', err);
      setError('Failed to load appointments');
    } finally {
      setLoading(false);
    }
  }, [selectedDate, salonSlug]);

  useEffect(() => {
    fetchAppointments();
  }, [fetchAppointments]);

  const handleDateSelect = (date: Date) => {
    setSelectedDate(date);
  };

  const isToday = (date: Date) => {
    const today = new Date();
    return date.toDateString() === today.toDateString();
  };

  const isSelected = (date: Date) => {
    return date.toDateString() === selectedDate.toDateString();
  };

  return (
    <div className="min-h-full w-full bg-white text-black font-sans flex flex-col">
      {/* Header */}
      <ModalHeader
        title={dayName}
        subtitle={`${monthName} ${dayNumber}`}
        leftAction={<BackButton onClick={onClose} label="Back" />}
        rightAction={
          <button
            type="button"
            aria-label="Search appointments"
            className="text-[#007AFF] active:opacity-50 transition-opacity"
          >
            <Search className="w-5 h-5" />
          </button>
        }
      />

      {/* Day Selector Row */}
      <div className="flex justify-between px-4 pb-2 pt-1 bg-white border-b border-gray-100">
        {weekDates.map((date, i) => (
          <button
            key={i}
            type="button"
            onClick={() => handleDateSelect(date)}
            aria-label={`Select ${date.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}`}
            className={`
              flex flex-col items-center justify-center w-9 h-12 rounded-full text-[13px] font-medium transition-colors
              ${isSelected(date) 
                ? 'bg-black text-white' 
                : isToday(date) 
                  ? 'bg-blue-100 text-blue-600' 
                  : 'text-gray-400 hover:bg-gray-100'
              }
            `}
          >
            <span className="text-[10px] mb-0.5">{days[i]}</span>
            <span className="text-[14px]">{date.getDate()}</span>
          </button>
        ))}
      </div>

      {/* Scrollable Timeline */}
      <div className="flex-1 overflow-y-auto relative bg-white">
        {loading ? (
          <LoadingSkeleton />
        ) : error ? (
          <div className="flex flex-col items-center justify-center py-20 px-8">
            <p className="text-sm text-red-600 mb-2">{error}</p>
            <button
              type="button"
              onClick={fetchAppointments}
              className="text-sm text-[#007AFF] font-medium"
            >
              Try again
            </button>
          </div>
        ) : appointments.length === 0 ? (
          <EmptyState />
        ) : (
          <>
            {/* Current Time Line (Red) - only show for today */}
            {isToday(selectedDate) && currentTimeTop > 0 && currentTimeTop < 13 * 96 && (
              <div
                className="absolute left-14 w-[calc(100%-56px)] z-20 pointer-events-none"
                style={{ top: currentTimeTop }}
              >
                <div className="h-[2px] bg-red-500 w-full relative">
                  <div className="absolute -left-1.5 -top-1 w-2 h-2 rounded-full bg-red-500" />
                  <span className="absolute -left-12 -top-1.5 text-[10px] font-bold text-red-500">
                    {currentTime}
                  </span>
                </div>
              </div>
            )}

            {/* Time Grid */}
            <div className="pb-20 pt-4">
              {HOURS.map((hour) => (
                <div key={hour} className="flex h-24 relative">
                  {/* Time Column */}
                  <div className="w-14 text-right pr-3 text-[11px] font-medium text-gray-400 -mt-1.5">
                    {formatHour(hour)}
                  </div>
                  {/* Row Lines */}
                  <div className="flex-1 border-t border-gray-100 relative">
                    {/* Half-hour dotted line */}
                    <div className="absolute top-12 left-0 w-full border-t border-dashed border-gray-50" />
                  </div>
                </div>
              ))}

              {/* Floating Appointment Cards */}
              {appointments.map((appt) => (
                <motion.div
                  key={appt.id}
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ type: 'spring', stiffness: 200, damping: 20 }}
                  style={{
                    position: 'absolute',
                    top: `${appt.startRow * 96 + 16}px`,
                    left: '60px',
                    right: '12px',
                    height: `${Math.max(appt.duration * 96 - 4, 40)}px`,
                  }}
                  className={`
                    rounded-[6px] border-l-[3px] p-3 shadow-sm flex flex-col justify-center 
                    cursor-pointer active:brightness-95 transition-all overflow-hidden
                    ${appt.color} ${appt.borderColor}
                  `}
                >
                  <div className="flex justify-between items-start">
                    <div className="min-w-0 flex-1">
                      <div className="text-[13px] font-semibold leading-tight truncate">
                        {appt.service}
                      </div>
                      <div className="text-[11px] opacity-80 mt-0.5 truncate">{appt.client}</div>
                    </div>
                    <div className="text-[10px] font-semibold opacity-70 ml-2 flex-shrink-0">
                      {appt.time.split('-')[0]}
                    </div>
                  </div>
                </motion.div>
              ))}
            </div>
          </>
        )}
      </div>

      {/* Floating Action Button */}
      <button
        type="button"
        aria-label="Add new appointment"
        className="fixed bottom-8 right-6 w-14 h-14 bg-[#007AFF] rounded-full text-white shadow-[0_4px_16px_rgba(0,122,255,0.4)] flex items-center justify-center active:scale-90 transition-transform z-50"
      >
        <Plus className="w-8 h-8" />
      </button>
    </div>
  );
}
