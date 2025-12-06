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
 * - Floating action button
 */

import { motion } from 'framer-motion';
import { Search, Plus, MapPin } from 'lucide-react';

import { ModalHeader, BackButton } from './AppModal';

// Generate hours from 8 AM to 8 PM
const HOURS = Array.from({ length: 13 }, (_, i) => i + 8);

// Sample appointment data
interface Appointment {
  id: number;
  client: string;
  service: string;
  time: string;
  startRow: number; // Hours after 8 AM (e.g., 9:30 = 1.5)
  duration: number; // In hours
  color: string;
  borderColor: string;
  avatar: string;
  location?: string;
}

const SAMPLE_APPOINTMENTS: Appointment[] = [
  {
    id: 1,
    client: 'Emma Watson',
    service: 'Full Balayage & Cut',
    time: '09:30 AM - 11:30 AM',
    startRow: 1.5,
    duration: 2,
    color: 'bg-blue-50 text-blue-700',
    borderColor: 'border-blue-500',
    avatar: 'EW',
  },
  {
    id: 2,
    client: 'Sarah Connor',
    service: 'Root Touch Up',
    time: '12:00 PM - 01:00 PM',
    startRow: 4,
    duration: 1,
    color: 'bg-purple-50 text-purple-700',
    borderColor: 'border-purple-500',
    avatar: 'SC',
  },
  {
    id: 3,
    client: 'Jessica Jones',
    service: 'Manicure (Gel)',
    time: '01:30 PM - 02:15 PM',
    startRow: 5.5,
    duration: 0.75,
    color: 'bg-orange-50 text-orange-700',
    borderColor: 'border-orange-500',
    avatar: 'JJ',
  },
];

interface AppointmentsModalProps {
  onClose: () => void;
  appointments?: Appointment[];
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

export function AppointmentsModal({
  onClose,
  appointments = SAMPLE_APPOINTMENTS,
}: AppointmentsModalProps) {
  const { top: currentTimeTop, time: currentTime } = getCurrentTimePosition();
  const today = new Date();
  const dayName = today.toLocaleDateString('en-US', { weekday: 'long' });
  const dayNumber = today.getDate();
  const monthName = today.toLocaleDateString('en-US', { month: 'short' });

  // Day selector (current week)
  const days = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
  const currentDayIndex = today.getDay();

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
            className="text-[#007AFF] active:opacity-50 transition-opacity"
          >
            <Search className="w-5 h-5" />
          </button>
        }
      />

      {/* Day Selector Row */}
      <div className="flex justify-between px-4 pb-2 pt-1 bg-white border-b border-gray-100">
        {days.map((d, i) => (
          <div
            key={i}
            className={`
              flex flex-col items-center justify-center w-8 h-8 rounded-full text-[13px] font-medium
              ${i === currentDayIndex ? 'bg-black text-white' : 'text-gray-400'}
            `}
          >
            {d}
          </div>
        ))}
      </div>

      {/* Scrollable Timeline */}
      <div className="flex-1 overflow-y-auto relative bg-white">
        {/* Current Time Line (Red) */}
        {currentTimeTop > 0 && currentTimeTop < 13 * 96 && (
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
                height: `${appt.duration * 96 - 4}px`,
              }}
              className={`
                rounded-[6px] border-l-[3px] p-3 shadow-sm flex flex-col justify-center 
                cursor-pointer active:brightness-95 transition-all overflow-hidden
                ${appt.color} ${appt.borderColor}
              `}
            >
              <div className="flex justify-between items-start">
                <div>
                  <div className="text-[13px] font-semibold leading-tight">
                    {appt.service}
                  </div>
                  <div className="text-[11px] opacity-80 mt-0.5">{appt.client}</div>
                </div>
                <div className="text-[10px] font-semibold opacity-70">
                  {appt.time.split('-')[0]}
                </div>
              </div>
              {appt.location && (
                <div className="mt-auto flex items-center gap-1 text-[10px] opacity-60">
                  <MapPin className="w-3 h-3" />
                  <span>{appt.location}</span>
                </div>
              )}
            </motion.div>
          ))}
        </div>
      </div>

      {/* Floating Action Button */}
      <button
        type="button"
        className="fixed bottom-8 right-6 w-14 h-14 bg-[#007AFF] rounded-full text-white shadow-[0_4px_16px_rgba(0,122,255,0.4)] flex items-center justify-center active:scale-90 transition-transform z-50"
      >
        <Plus className="w-8 h-8" />
      </button>
    </div>
  );
}

