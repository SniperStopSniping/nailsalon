'use client';

import { motion } from 'framer-motion';
import { Camera, ChevronLeft, Loader2, Star } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';

import type { StaffStatus } from '@/models/Schema';
import { useSalon } from '@/providers/SalonProvider';

import { StaffStatusToggle } from './StaffStatusToggle';
import { ClientsTab } from './tabs/ClientsTab';
import { EarningsTab } from './tabs/EarningsTab';
import { OverviewTab } from './tabs/OverviewTab';
import { ScheduleTab } from './tabs/ScheduleTab';
import { ServicesTab } from './tabs/ServicesTab';
import { SettingsTab } from './tabs/SettingsTab';

// =============================================================================
// Types
// =============================================================================

type TabId = 'overview' | 'schedule' | 'services' | 'clients' | 'earnings' | 'settings';

type TechnicianDetail = {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  avatarUrl: string | null;
  bio: string | null;
  role: string | null;
  skillLevel: string | null;
  languages: string[] | null;
  specialties: string[] | null;
  currentStatus: string | null;
  isActive: boolean;
  acceptingNewClients: boolean;
  rating: number | null;
  reviewCount: number;
  commissionRate: number;
  payType: string | null;
  hourlyRate: number | null;
  salaryAmount: number | null;
  displayOrder: number | null;
  notes: string | null;
  userId: string | null;
  hiredAt: string | null;
  terminatedAt: string | null;
  returnDate: string | null;
  onboardingStatus: string | null;
  weeklySchedule: Record<string, { start: string; end: string } | null> | null;
  createdAt: string;
  updatedAt: string;
};

type TechnicianStats = {
  today: {
    appointments: number;
    completed: number;
    revenue: number;
    techEarned: number;
    salonEarned: number;
  };
  thisWeek: {
    appointments: number;
    revenue: number;
    techEarned: number;
    salonEarned: number;
  };
  thisMonth: {
    appointments: number;
    revenue: number;
    techEarned: number;
    salonEarned: number;
  };
  totalClients: number;
};

type StaffDetailPageProps = {
  staffId: string;
  onBack: () => void;
  onUpdate?: () => void;
};

// =============================================================================
// Tab Configuration
// =============================================================================

const TABS: { id: TabId; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'schedule', label: 'Schedule' },
  { id: 'services', label: 'Services' },
  { id: 'clients', label: 'Clients' },
  { id: 'earnings', label: 'Earnings' },
  { id: 'settings', label: 'Settings' },
];

// =============================================================================
// Component
// =============================================================================

export function StaffDetailPage({ staffId, onBack, onUpdate }: StaffDetailPageProps) {
  const { salonSlug } = useSalon();
  const [activeTab, setActiveTab] = useState<TabId>('overview');
  const [technician, setTechnician] = useState<TechnicianDetail | null>(null);
  const [stats, setStats] = useState<TechnicianStats | null>(null);
  const [_services, setServices] = useState<{ serviceId: string; enabled: boolean; priority: number }[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Avatar upload state
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);

  // Fetch technician detail
  const fetchDetail = useCallback(async () => {
    if (!salonSlug || !staffId) {
      return;
    }

    try {
      setLoading(true);
      setError(null);

      const response = await fetch(
        `/api/admin/technicians/${staffId}?salonSlug=${salonSlug}`,
      );

      if (!response.ok) {
        throw new Error('Failed to fetch staff details');
      }

      const result = await response.json();
      setTechnician(result.data?.technician ?? null);
      setStats(result.data?.stats ?? null);
      setServices(result.data?.services ?? []);
    } catch (err) {
      console.error('Error fetching technician:', err);
      setError('Failed to load staff details');
    } finally {
      setLoading(false);
    }
  }, [salonSlug, staffId]);

  useEffect(() => {
    fetchDetail();
  }, [fetchDetail]);

  // Handle status change
  const handleStatusChange = async (newStatus: StaffStatus) => {
    if (!salonSlug || !technician) {
      return;
    }

    const response = await fetch(`/api/admin/technicians/${staffId}/status`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        salonSlug,
        currentStatus: newStatus,
      }),
    });

    if (!response.ok) {
      throw new Error('Failed to update status');
    }

    // Update local state
    setTechnician(prev =>
      prev ? { ...prev, currentStatus: newStatus } : null,
    );
    onUpdate?.();
  };

  // Handle technician update
  const handleTechnicianUpdate = (updates: Partial<TechnicianDetail>) => {
    setTechnician(prev => (prev ? { ...prev, ...updates } : null));
    onUpdate?.();
  };

  // Handle avatar upload
  const handleAvatarClick = () => {
    fileInputRef.current?.click();
  };

  const handleAvatarChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !salonSlug) {
      return;
    }

    // Validate file
    const allowedTypes = ['image/jpeg', 'image/png', 'image/webp'];
    if (!allowedTypes.includes(file.type)) {
      // eslint-disable-next-line no-alert -- validation feedback (TODO: replace with toast)
      alert('Please select a JPEG, PNG, or WebP image');
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      // eslint-disable-next-line no-alert -- validation feedback (TODO: replace with toast)
      alert('Image must be less than 5MB');
      return;
    }

    setUploadingAvatar(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('salonSlug', salonSlug);

      const response = await fetch(`/api/admin/technicians/${staffId}/avatar`, {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        const result = await response.json();
        throw new Error(result.error?.message ?? 'Failed to upload avatar');
      }

      const result = await response.json();
      setTechnician(prev =>
        prev ? { ...prev, avatarUrl: result.data?.avatarUrl } : null,
      );
      onUpdate?.();
    } catch (err) {
      console.error('Error uploading avatar:', err);
      // eslint-disable-next-line no-alert -- error feedback (TODO: replace with toast)
      alert(err instanceof Error ? err.message : 'Failed to upload avatar');
    } finally {
      setUploadingAvatar(false);
      // Reset file input
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  if (loading) {
    return (
      <motion.div
        initial={{ x: '100%' }}
        animate={{ x: 0 }}
        exit={{ x: '100%' }}
        transition={{ type: 'spring', stiffness: 300, damping: 30 }}
        className="absolute inset-0 z-10 bg-[#F2F2F7]"
      >
        <LoadingSkeleton onBack={onBack} />
      </motion.div>
    );
  }

  if (error || !technician) {
    return (
      <motion.div
        initial={{ x: '100%' }}
        animate={{ x: 0 }}
        exit={{ x: '100%' }}
        transition={{ type: 'spring', stiffness: 300, damping: 30 }}
        className="absolute inset-0 z-10 flex items-center justify-center bg-[#F2F2F7]"
      >
        <div className="px-8 text-center">
          <p className="mb-4 text-[17px] text-[#8E8E93]">{error || 'Staff not found'}</p>
          <button
            type="button"
            onClick={onBack}
            className="rounded-lg bg-[#007AFF] px-4 py-2 text-[15px] font-medium text-white"
          >
            Go Back
          </button>
        </div>
      </motion.div>
    );
  }

  const initials = technician.name
    .split(' ')
    .map(n => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);

  return (
    <motion.div
      initial={{ x: '100%' }}
      animate={{ x: 0 }}
      exit={{ x: '100%' }}
      transition={{ type: 'spring', stiffness: 300, damping: 30 }}
      className="absolute inset-0 z-10 flex flex-col overflow-hidden bg-[#F2F2F7]"
    >
      {/* Header */}
      <div className="border-b border-gray-200 bg-white">
        <div className="flex items-center px-4 py-3">
          <button
            type="button"
            onClick={onBack}
            className="mr-4 flex items-center text-[17px] text-[#007AFF]"
          >
            <ChevronLeft className="size-5" />
            <span>Staff</span>
          </button>
        </div>

        {/* Profile Header */}
        <div className="px-4 pb-4">
          <div className="flex items-start gap-4">
            {/* Avatar with Upload */}
            <div className="relative">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                onChange={handleAvatarChange}
                className="hidden"
                aria-label="Upload profile photo"
              />
              <button
                type="button"
                onClick={handleAvatarClick}
                disabled={uploadingAvatar}
                className="group relative"
              >
                {technician.avatarUrl
                  ? (
                      <img
                        src={technician.avatarUrl}
                        alt={technician.name}
                        className="size-20 rounded-full object-cover"
                      />
                    )
                  : (
                      <div className="flex size-20 items-center justify-center rounded-full bg-gradient-to-br from-[#a18cd1] to-[#fbc2eb] text-2xl font-bold text-white">
                        {initials}
                      </div>
                    )}
                {/* Upload Overlay */}
                <div className={`
                  absolute inset-0 flex items-center justify-center rounded-full
                  transition-opacity
                  ${uploadingAvatar ? 'bg-black/50' : 'bg-black/0 group-hover:bg-black/40'}
                `}
                >
                  {uploadingAvatar
                    ? (
                        <Loader2 className="size-6 animate-spin text-white" />
                      )
                    : (
                        <Camera className="size-6 text-white opacity-0 transition-opacity group-hover:opacity-100" />
                      )}
                </div>
              </button>
            </div>

            {/* Info */}
            <div className="min-w-0 flex-1">
              <h1 className="truncate text-[22px] font-bold text-[#1C1C1E]">
                {technician.name}
              </h1>
              <p className="text-[15px] capitalize text-[#8E8E93]">
                {technician.role ?? 'Technician'}
                {technician.skillLevel && technician.skillLevel !== 'standard' && (
                  <span>
                    {' '}
                    ·
                    {technician.skillLevel}
                  </span>
                )}
              </p>
              {technician.rating !== null && technician.reviewCount > 0 && (
                <div className="mt-1 flex items-center gap-1">
                  <Star className="size-4 fill-[#FFD60A] text-[#FFD60A]" />
                  <span className="text-[14px] font-medium text-[#1C1C1E]">
                    {technician.rating.toFixed(1)}
                  </span>
                  <span className="text-[13px] text-[#8E8E93]">
                    (
                    {technician.reviewCount}
                    {' '}
                    reviews)
                  </span>
                </div>
              )}
            </div>
          </div>

          {/* Status Toggle */}
          <div className="mt-4">
            <StaffStatusToggle
              currentStatus={(technician.currentStatus as StaffStatus) ?? 'available'}
              onStatusChange={handleStatusChange}
            />
          </div>
        </div>

        {/* Tab Navigation */}
        <div className="no-scrollbar flex overflow-x-auto border-t border-gray-100">
          {TABS.map(tab => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={`
                shrink-0 border-b-2 px-4 py-3 text-[15px]
                font-medium transition-colors
                ${
            activeTab === tab.id
              ? 'border-[#007AFF] text-[#007AFF]'
              : 'border-transparent text-[#8E8E93]'
            }
              `}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Tab Content */}
      <div className="flex-1 overflow-y-auto">
        {activeTab === 'overview' && (
          <OverviewTab
            technician={technician}
            stats={stats}
            onRefresh={fetchDetail}
          />
        )}
        {activeTab === 'schedule' && (
          <ScheduleTab
            technicianId={staffId}
            weeklySchedule={technician.weeklySchedule}
            onUpdate={schedule => handleTechnicianUpdate({ weeklySchedule: schedule })}
          />
        )}
        {activeTab === 'services' && (
          <ServicesTab
            technicianId={staffId}
            onUpdate={fetchDetail}
          />
        )}
        {activeTab === 'clients' && (
          <ClientsTab technicianId={staffId} />
        )}
        {activeTab === 'earnings' && (
          <EarningsTab
            technicianId={staffId}
            commissionRate={technician.commissionRate}
          />
        )}
        {activeTab === 'settings' && (
          <SettingsTab
            technician={technician}
            onUpdate={handleTechnicianUpdate}
            onDelete={onBack}
          />
        )}
      </div>
    </motion.div>
  );
}

// =============================================================================
// Loading Skeleton
// =============================================================================

function LoadingSkeleton({ onBack }: { onBack: () => void }) {
  return (
    <>
      <div className="border-b border-gray-200 bg-white">
        <div className="flex items-center px-4 py-3">
          <button
            type="button"
            onClick={onBack}
            className="flex items-center text-[17px] text-[#007AFF]"
          >
            <ChevronLeft className="size-5" />
            <span>Staff</span>
          </button>
        </div>
        <div className="animate-pulse px-4 pb-4">
          <div className="flex items-start gap-4">
            <div className="size-20 rounded-full bg-gray-200" />
            <div className="flex-1">
              <div className="mb-2 h-6 w-32 rounded bg-gray-200" />
              <div className="h-4 w-24 rounded bg-gray-100" />
            </div>
          </div>
          <div className="mt-4 h-10 rounded-lg bg-gray-100" />
        </div>
        <div className="flex gap-4 border-t border-gray-100 px-4 py-3">
          {[1, 2, 3, 4, 5, 6].map(i => (
            <div key={i} className="h-4 w-16 rounded bg-gray-100" />
          ))}
        </div>
      </div>
    </>
  );
}
