'use client';

/**
 * StaffModal Component
 *
 * iOS-style staff management modal.
 * Features:
 * - Staff list with availability status
 * - Performance stats (revenue, utilization)
 * - Weekly schedule display
 * - Tap to view staff details
 */

import { motion, AnimatePresence } from 'framer-motion';
import { 
  Clock, 
  DollarSign, 
  ChevronRight, 
  User,
  Calendar,
  Star,
} from 'lucide-react';
import { useState, useEffect, useCallback } from 'react';

import { ModalHeader, BackButton } from './AppModal';

// Types
interface StaffMember {
  id: string;
  name: string;
  bio: string | null;
  avatarUrl: string | null;
  specialties: string[];
  rating: number | null;
  reviewCount: number;
  weeklySchedule: WeeklySchedule | null;
  status: 'busy' | 'free' | 'off';
  currentClient?: string;
  todayRevenue?: number;
  todayAppointments?: number;
}

interface WeeklySchedule {
  sunday?: { start: string; end: string } | null;
  monday?: { start: string; end: string } | null;
  tuesday?: { start: string; end: string } | null;
  wednesday?: { start: string; end: string } | null;
  thursday?: { start: string; end: string } | null;
  friday?: { start: string; end: string } | null;
  saturday?: { start: string; end: string } | null;
}

interface StaffModalProps {
  onClose: () => void;
}

// Day names for schedule display
const DAY_NAMES: (keyof WeeklySchedule)[] = [
  'sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'
];

const DAY_LABELS: Record<keyof WeeklySchedule, string> = {
  sunday: 'Sun',
  monday: 'Mon',
  tuesday: 'Tue',
  wednesday: 'Wed',
  thursday: 'Thu',
  friday: 'Fri',
  saturday: 'Sat',
};

// Format currency
function formatCurrency(cents: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
  }).format(cents / 100);
}

// Format time (24h to 12h)
function formatTime(time: string): string {
  const [hours, minutes] = time.split(':').map(Number);
  const h = hours! % 12 || 12;
  const period = hours! >= 12 ? 'PM' : 'AM';
  return `${h}:${String(minutes).padStart(2, '0')} ${period}`;
}

// Get status color
function getStatusColor(status: 'busy' | 'free' | 'off'): string {
  switch (status) {
    case 'busy': return 'bg-[#FF9500]';
    case 'free': return 'bg-[#34C759]';
    case 'off': return 'bg-[#8E8E93]';
  }
}

// Get status label
function getStatusLabel(status: 'busy' | 'free' | 'off'): string {
  switch (status) {
    case 'busy': return 'Busy';
    case 'free': return 'Available';
    case 'off': return 'Off Today';
  }
}

/**
 * Staff Row Component
 */
function StaffRow({ 
  staff, 
  isLast,
  onClick 
}: { 
  staff: StaffMember; 
  isLast: boolean;
  onClick: () => void;
}) {
  const initials = staff.name.split(' ').map(n => n[0]).join('').toUpperCase();
  
  return (
    <motion.div
      initial={{ opacity: 0, x: -10 }}
      animate={{ opacity: 1, x: 0 }}
      className="flex items-center pl-4 min-h-[72px] active:bg-gray-50 transition-colors cursor-pointer"
      onClick={onClick}
    >
      {/* Avatar */}
      <div className="relative">
        {staff.avatarUrl ? (
          <img 
            src={staff.avatarUrl} 
            alt={staff.name}
            className="w-12 h-12 rounded-full object-cover mr-3"
          />
        ) : (
          <div className="w-12 h-12 rounded-full bg-gradient-to-br from-[#a18cd1] to-[#fbc2eb] flex items-center justify-center text-white text-[15px] font-bold mr-3 shadow-sm">
            {initials}
          </div>
        )}
        {/* Status indicator */}
        <div className={`absolute bottom-0 right-2 w-3.5 h-3.5 rounded-full border-2 border-white ${getStatusColor(staff.status)}`} />
      </div>
      
      {/* Content */}
      <div className={`flex-1 flex items-center justify-between pr-4 py-3 ${!isLast ? 'border-b border-gray-100' : ''}`}>
        <div>
          <div className="text-[17px] font-semibold text-[#1C1C1E]">{staff.name}</div>
          <div className="text-[13px] text-[#8E8E93] mt-0.5 flex items-center gap-2">
            <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[11px] font-medium ${
              staff.status === 'busy' ? 'bg-orange-100 text-orange-600' :
              staff.status === 'free' ? 'bg-green-100 text-green-600' :
              'bg-gray-100 text-gray-500'
            }`}>
              {getStatusLabel(staff.status)}
            </span>
            {staff.currentClient && (
              <span className="text-[12px]">with {staff.currentClient}</span>
            )}
          </div>
        </div>
        
        <div className="flex items-center gap-2">
          {staff.todayRevenue !== undefined && staff.todayRevenue > 0 && (
            <div className="text-right mr-2">
              <div className="text-[15px] font-medium text-[#34C759]">
                {formatCurrency(staff.todayRevenue)}
              </div>
              <div className="text-[11px] text-[#8E8E93]">
                {staff.todayAppointments} today
              </div>
            </div>
          )}
          <ChevronRight className="w-4 h-4 text-[#C7C7CC]" />
        </div>
      </div>
    </motion.div>
  );
}

/**
 * Empty State Component
 */
function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center py-20 px-8">
      <div className="w-16 h-16 rounded-full bg-[#F2F2F7] flex items-center justify-center mb-4">
        <User className="w-8 h-8 text-[#8E8E93]" />
      </div>
      <h3 className="text-[17px] font-semibold text-[#1C1C1E] mb-1">
        No Staff Members
      </h3>
      <p className="text-[15px] text-[#8E8E93] text-center">
        Add staff members to manage your team
      </p>
    </div>
  );
}

/**
 * Schedule Grid Component
 */
function ScheduleGrid({ schedule }: { schedule: WeeklySchedule | null }) {
  const today = new Date().getDay();
  
  return (
    <div className="grid grid-cols-7 gap-1">
      {DAY_NAMES.map((day, index) => {
        const daySchedule = schedule?.[day];
        const isToday = index === today;
        const isWorking = !!daySchedule;
        
        return (
          <div 
            key={day}
            className={`
              text-center p-2 rounded-lg
              ${isToday ? 'bg-[#007AFF]/10 ring-1 ring-[#007AFF]' : ''}
              ${!isWorking ? 'opacity-40' : ''}
            `}
          >
            <div className={`text-[11px] font-medium ${isToday ? 'text-[#007AFF]' : 'text-[#8E8E93]'}`}>
              {DAY_LABELS[day]}
            </div>
            {isWorking ? (
              <div className="text-[10px] text-[#1C1C1E] mt-1">
                {formatTime(daySchedule!.start).replace(' ', '')}<br/>
                {formatTime(daySchedule!.end).replace(' ', '')}
              </div>
            ) : (
              <div className="text-[10px] text-[#8E8E93] mt-1">Off</div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/**
 * Staff Detail View Component
 */
function StaffDetail({ 
  staff, 
  onBack 
}: { 
  staff: StaffMember; 
  onBack: () => void;
}) {
  const initials = staff.name.split(' ').map(n => n[0]).join('').toUpperCase();
  
  return (
    <motion.div
      initial={{ x: '100%' }}
      animate={{ x: 0 }}
      exit={{ x: '100%' }}
      transition={{ type: 'spring', stiffness: 300, damping: 30 }}
      className="absolute inset-0 bg-[#F2F2F7] overflow-y-auto"
    >
      <ModalHeader
        title={staff.name}
        leftAction={<BackButton onClick={onBack} label="Staff" />}
      />
      
      <div className="p-4">
        {/* Profile Card */}
        <div className="bg-white rounded-[22px] p-6 shadow-[0_4px_20px_rgba(0,0,0,0.03)] mb-4">
          <div className="flex flex-col items-center">
            {staff.avatarUrl ? (
              <img 
                src={staff.avatarUrl} 
                alt={staff.name}
                className="w-24 h-24 rounded-full object-cover mb-3 shadow-lg"
              />
            ) : (
              <div className="w-24 h-24 rounded-full bg-gradient-to-br from-[#a18cd1] to-[#fbc2eb] flex items-center justify-center text-white text-3xl font-bold mb-3 shadow-lg">
                {initials}
              </div>
            )}
            <h2 className="text-[22px] font-semibold text-[#1C1C1E]">{staff.name}</h2>
            
            {/* Rating */}
            {staff.rating !== null && (
              <div className="flex items-center gap-1 mt-2">
                <Star className="w-4 h-4 text-[#FFD60A] fill-[#FFD60A]" />
                <span className="text-[15px] font-medium text-[#1C1C1E]">
                  {Number(staff.rating).toFixed(1)}
                </span>
                <span className="text-[13px] text-[#8E8E93]">
                  ({staff.reviewCount} reviews)
                </span>
              </div>
            )}
            
            {/* Status Badge */}
            <div className={`mt-3 px-3 py-1 rounded-full text-[13px] font-medium ${
              staff.status === 'busy' ? 'bg-orange-100 text-orange-600' :
              staff.status === 'free' ? 'bg-green-100 text-green-600' :
              'bg-gray-100 text-gray-500'
            }`}>
              {getStatusLabel(staff.status)}
              {staff.currentClient && ` - with ${staff.currentClient}`}
            </div>
          </div>
        </div>
        
        {/* Bio */}
        {staff.bio && (
          <div className="bg-white rounded-[16px] p-4 shadow-[0_4px_20px_rgba(0,0,0,0.03)] mb-4">
            <div className="text-[13px] text-[#8E8E93] uppercase font-medium mb-2">About</div>
            <p className="text-[15px] text-[#1C1C1E] leading-relaxed">{staff.bio}</p>
          </div>
        )}
        
        {/* Specialties */}
        {staff.specialties && staff.specialties.length > 0 && (
          <div className="bg-white rounded-[16px] p-4 shadow-[0_4px_20px_rgba(0,0,0,0.03)] mb-4">
            <div className="text-[13px] text-[#8E8E93] uppercase font-medium mb-2">Specialties</div>
            <div className="flex flex-wrap gap-2">
              {staff.specialties.map((specialty, index) => (
                <span 
                  key={index}
                  className="px-3 py-1 bg-[#F2F2F7] rounded-full text-[13px] text-[#1C1C1E]"
                >
                  {specialty}
                </span>
              ))}
            </div>
          </div>
        )}
        
        {/* Today's Stats */}
        <div className="grid grid-cols-2 gap-4 mb-4">
          <div className="bg-white rounded-[16px] p-4 shadow-[0_4px_20px_rgba(0,0,0,0.03)]">
            <div className="flex items-center gap-2 text-[13px] text-[#8E8E93] uppercase font-medium">
              <DollarSign className="w-4 h-4" />
              Today
            </div>
            <div className="text-[28px] font-bold text-[#34C759] mt-1">
              {formatCurrency(staff.todayRevenue || 0)}
            </div>
          </div>
          <div className="bg-white rounded-[16px] p-4 shadow-[0_4px_20px_rgba(0,0,0,0.03)]">
            <div className="flex items-center gap-2 text-[13px] text-[#8E8E93] uppercase font-medium">
              <Calendar className="w-4 h-4" />
              Appointments
            </div>
            <div className="text-[28px] font-bold text-[#1C1C1E] mt-1">
              {staff.todayAppointments || 0}
            </div>
          </div>
        </div>
        
        {/* Weekly Schedule */}
        <div className="bg-white rounded-[16px] p-4 shadow-[0_4px_20px_rgba(0,0,0,0.03)]">
          <div className="flex items-center gap-2 text-[13px] text-[#8E8E93] uppercase font-medium mb-3">
            <Clock className="w-4 h-4" />
            Weekly Schedule
          </div>
          <ScheduleGrid schedule={staff.weeklySchedule} />
        </div>
      </div>
    </motion.div>
  );
}

/**
 * Loading Skeleton
 */
function LoadingSkeleton() {
  return (
    <div className="animate-pulse">
      {[1, 2, 3, 4].map((i) => (
        <div key={i} className="flex items-center px-4 py-4">
          <div className="w-12 h-12 rounded-full bg-gray-200 mr-3" />
          <div className="flex-1">
            <div className="h-4 bg-gray-200 rounded w-32 mb-2" />
            <div className="h-3 bg-gray-100 rounded w-20" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function StaffModal({ onClose }: StaffModalProps) {
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedStaff, setSelectedStaff] = useState<StaffMember | null>(null);

  // Fetch staff data
  const fetchStaff = useCallback(async () => {
    try {
      setLoading(true);
      
      // Fetch staff availability which includes technician data
      const response = await fetch('/api/staff/availability');
      if (response.ok) {
        const result = await response.json();
        const technicians = result.data?.technicians || [];
        
        // Also fetch today's appointments to calculate stats
        const apptResponse = await fetch('/api/appointments?date=today&status=completed,confirmed,in_progress');
        const apptResult = apptResponse.ok ? await apptResponse.json() : { data: { appointments: [] } };
        const appointments = apptResult.data?.appointments || [];
        
        // Calculate stats per technician
        const now = new Date();
        const staffData: StaffMember[] = technicians.map((tech: {
          id: string;
          name: string;
          bio: string | null;
          avatarUrl: string | null;
          specialties: string[] | null;
          rating: string | null;
          reviewCount: number;
          weeklySchedule: WeeklySchedule | null;
        }) => {
          // Get this tech's appointments
          const techAppts = appointments.filter((a: { technicianId: string }) => a.technicianId === tech.id);
          
          // Calculate today's revenue from completed appointments
          const todayRevenue = techAppts
            .filter((a: { status: string }) => a.status === 'completed')
            .reduce((sum: number, a: { totalPrice: number }) => sum + (a.totalPrice || 0), 0);
          
          // Check if currently in an appointment
          const currentAppt = techAppts.find((a: { status: string; startTime: string; endTime: string }) => {
            if (a.status !== 'in_progress' && a.status !== 'confirmed') return false;
            const start = new Date(a.startTime);
            const end = new Date(a.endTime);
            return now >= start && now <= end;
          });
          
          // Determine status
          const dayOfWeek = now.getDay();
          const dayName = DAY_NAMES[dayOfWeek];
          const schedule = tech.weeklySchedule as WeeklySchedule | null;
          const isWorkingToday = schedule && dayName ? !!schedule[dayName] : false;
          
          let status: 'busy' | 'free' | 'off' = 'off';
          if (isWorkingToday) {
            status = currentAppt ? 'busy' : 'free';
          }
          
          return {
            id: tech.id,
            name: tech.name,
            bio: tech.bio,
            avatarUrl: tech.avatarUrl,
            specialties: tech.specialties || [],
            rating: tech.rating ? parseFloat(tech.rating) : null,
            reviewCount: tech.reviewCount || 0,
            weeklySchedule: schedule,
            status,
            currentClient: currentAppt?.clientName,
            todayRevenue,
            todayAppointments: techAppts.length,
          };
        });
        
        setStaff(staffData);
      }
    } catch (error) {
      console.error('Failed to fetch staff:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStaff();
  }, [fetchStaff]);

  // Count by status
  const availableCount = staff.filter(s => s.status === 'free').length;
  const busyCount = staff.filter(s => s.status === 'busy').length;

  return (
    <div className="min-h-full w-full bg-[#F2F2F7] text-black font-sans flex flex-col relative">
      {/* Header */}
      <div className="sticky top-0 z-20 bg-[#F2F2F7]/80 backdrop-blur-md">
        <ModalHeader
          title="Staff"
          subtitle={`${availableCount} available, ${busyCount} busy`}
          leftAction={<BackButton onClick={onClose} label="Back" />}
        />
      </div>

      {/* Status Summary */}
      <div className="px-4 py-3 flex gap-3">
        <div className="flex items-center gap-2 px-3 py-1.5 bg-green-100 rounded-full">
          <div className="w-2 h-2 rounded-full bg-[#34C759]" />
          <span className="text-[13px] font-medium text-green-700">{availableCount} Available</span>
        </div>
        <div className="flex items-center gap-2 px-3 py-1.5 bg-orange-100 rounded-full">
          <div className="w-2 h-2 rounded-full bg-[#FF9500]" />
          <span className="text-[13px] font-medium text-orange-700">{busyCount} Busy</span>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto pb-10">
        {loading ? (
          <LoadingSkeleton />
        ) : staff.length === 0 ? (
          <EmptyState />
        ) : (
          <div className="bg-white mx-4 rounded-[10px] overflow-hidden shadow-sm">
            {staff.map((member, index) => (
              <StaffRow
                key={member.id}
                staff={member}
                isLast={index === staff.length - 1}
                onClick={() => setSelectedStaff(member)}
              />
            ))}
          </div>
        )}
      </div>

      {/* Staff Detail Overlay */}
      <AnimatePresence>
        {selectedStaff && (
          <StaffDetail 
            staff={selectedStaff} 
            onBack={() => setSelectedStaff(null)} 
          />
        )}
      </AnimatePresence>
    </div>
  );
}

