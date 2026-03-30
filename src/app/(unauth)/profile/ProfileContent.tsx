'use client';

import { AnimatePresence, motion } from 'framer-motion';
import {
  Calendar,
  Check,
  ChevronRight,
  CreditCard,
  Fingerprint,
  Gift,
  Image as ImageIcon,
  LogOut,
  Mail,
  MapPin,
  Pencil,
  RefreshCw,
  Share2,
  Sparkles,
  Star,
  User,
} from 'lucide-react';
import Image from 'next/image';
import { useParams, useRouter } from 'next/navigation';
import React, { useCallback, useEffect, useRef, useState } from 'react';

import { ConfettiPopup } from '@/components/ConfettiPopup';
import { SectionCard } from '@/components/ui/section-card';
import { StateCard } from '@/components/ui/state-card';
import { useClientSession } from '@/hooks/useClientSession';
import { appendSalonSlug, buildChangeAppointmentUrl } from '@/libs/bookingParams';
import { buildGoogleMapsDirectionsUrl, openGoogleMapsDirections } from '@/libs/directions';
import { useSalon } from '@/providers/SalonProvider';
import { n5 } from '@/theme';
import { cn } from '@/utils/Helpers';

// --- Types ---
type SettingsItem = {
  label: string;
  icon: React.ElementType;
  badge?: string;
  onClick?: () => void;
};

type AppointmentData = {
  id: string;
  startTime: string;
  endTime: string;
  status: string;
  totalPrice: number;
  totalDurationMinutes: number;
  locationId: string | null;
};

type AppointmentLocationData = {
  id: string;
  name: string;
  address: string | null;
  city: string | null;
  state: string | null;
  zipCode: string | null;
};

type ServiceData = {
  id: string;
  name: string;
  price: number;
  duration: number;
  imageUrl: string | null;
};

type TechnicianData = {
  id: string;
  name: string;
  avatarUrl: string | null;
};

type NextAppointmentResponse = {
  data: {
    appointment: AppointmentData | null;
    services: ServiceData[];
    technician: TechnicianData | null;
    location: AppointmentLocationData | null;
  };
};

// Simple web haptic helper
const triggerHaptic = () => {
  if (typeof navigator !== 'undefined' && navigator.vibrate) {
    navigator.vibrate(10);
  }
};

// Helper functions for date/time formatting
function formatDateWithTime(isoString: string): string {
  const date = new Date(isoString);
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const hours = date.getHours();
  const minutes = date.getMinutes();
  const ampm = hours >= 12 ? 'PM' : 'AM';
  const hour12 = hours % 12 || 12;
  return `${months[date.getMonth()]} ${date.getDate()} · ${hour12}:${minutes.toString().padStart(2, '0')} ${ampm}`;
}

// --- Subcomponents ---

const StatItem = ({
  label,
  value,
  highlight,
  isProgress,
  progressValue,
}: {
  label: string;
  value: string;
  highlight?: boolean;
  isProgress?: boolean;
  progressValue?: number;
}) => (
  <div className="flex h-full flex-col justify-end">
    <span
      className="font-body mb-1 text-[9px] uppercase tracking-widest text-[var(--n5-ink-main)] opacity-60"
    >
      {label}
    </span>
    {isProgress
      ? (
          <div className="flex flex-col space-y-1">
            <div className="flex items-center space-x-2">
              <div
                className="h-1.5 w-full overflow-hidden bg-[var(--n5-accent-soft)]"
                style={{ borderRadius: n5.radiusPill }}
              >
                <motion.div
                  initial={{ width: 0 }}
                  animate={{ width: `${progressValue || 0}%` }}
                  transition={{ duration: 1.5, ease: 'easeOut' }}
                  className="h-full bg-[var(--n5-accent)]"
                />
              </div>
            </div>
            <span
              className="font-body self-end text-[10px] font-bold tabular-nums text-[var(--n5-accent)]"
            >
              {value}
            </span>
          </div>
        )
      : (
          <span
            className={cn(
              'text-lg font-bold tabular-nums leading-none font-body',
              highlight ? 'text-[var(--n5-accent)]' : 'text-[var(--n5-ink-main)]',
            )}
          >
            {value}
          </span>
        )}
  </div>
);

/**
 * 1. MEMBER SUMMARY CARD
 */
const MemberCard = ({
  userName,
  userEmail,
  profileImage,
  userStats,
  activePoints,
  pendingPoints,
  pendingAppointments,
  onImageClick,
  profileImageInputRef,
  onProfileImageChange,
  onEditProfile,
}: {
  userName: string;
  userEmail: string | null;
  profileImage: string | null;
  userStats: { totalVisits: number; tier: string; savedAmount: number };
  activePoints: number;
  pendingPoints: number;
  pendingAppointments: number;
  onImageClick: () => void;
  profileImageInputRef: React.RefObject<HTMLInputElement | null>;
  onProfileImageChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onEditProfile: () => void;
}) => {
  const progressPercent = Math.min(100, (activePoints / 2500) * 100);

  return (
    <motion.div
      className="mt-1"
      aria-label="Gold Member Card showing stats and savings"
      role="region"
    >
      <SectionCard
        className="border-[var(--n5-border)] bg-[var(--n5-bg-card)]"
        contentClassName="space-y-5"
      >
        <div className="flex items-start gap-4">
          <div className="relative">
            <input
              ref={profileImageInputRef as React.RefObject<HTMLInputElement>}
              type="file"
              accept="image/*"
              onChange={onProfileImageChange}
              className="hidden"
              aria-label="Upload profile image"
            />
            <button
              type="button"
              onClick={onImageClick}
              className="relative size-16 overflow-hidden border shadow-sm"
              style={{
                borderRadius: n5.radiusPill,
                borderColor: 'var(--n5-border)',
              }}
              aria-label="Change profile picture"
            >
              {profileImage
                ? (
                    <Image
                      src={profileImage}
                      alt="Profile"
                      fill
                      className="object-cover"
                      unoptimized
                    />
                  )
                : (
                    <div
                      className="flex size-full items-center justify-center"
                      style={{ background: 'color-mix(in srgb, var(--n5-accent) 18%, white)' }}
                    >
                      <User className="size-7 text-[var(--n5-accent)]" />
                    </div>
                  )}
            </button>
          </div>

          <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="font-body text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--n5-ink-muted)]">
                  {userStats.tier}
                  {' '}
                  member
                </p>
                <h2 className="font-heading mt-1 truncate text-2xl font-semibold tracking-tight text-[var(--n5-ink-main)]">
                  {userName}
                </h2>
                {userEmail && (
                  <p className="font-body mt-1 truncate text-sm text-[var(--n5-ink-muted)]">
                    {userEmail}
                  </p>
                )}
              </div>
              <button
                type="button"
                onClick={() => {
                  triggerHaptic();
                  onEditProfile();
                }}
                className="flex size-9 shrink-0 items-center justify-center border bg-white text-[var(--n5-ink-muted)] transition-colors hover:text-[var(--n5-accent)]"
                style={{
                  borderRadius: n5.radiusPill,
                  borderColor: 'var(--n5-border)',
                }}
                aria-label="Edit profile"
              >
                <Pencil className="size-4" />
              </button>
            </div>

            <div className="mt-3 flex flex-wrap gap-2">
              <span
                className="font-body px-3 py-1 text-[11px] font-semibold text-[var(--n5-ink-main)]"
                style={{
                  borderRadius: n5.radiusPill,
                  backgroundColor: 'var(--n5-bg-page)',
                }}
              >
                Saved $
                {userStats.savedAmount}
                {' '}
                this year
              </span>
            </div>
          </div>
        </div>

        <div
          className="grid grid-cols-3 gap-3 border-t pt-4"
          style={{ borderColor: 'var(--n5-border-muted)' }}
        >
          <StatItem label="Visits" value={userStats.totalVisits.toString()} />
          <StatItem label="Points" value={activePoints >= 1000 ? `${(activePoints / 1000).toFixed(1)}k` : activePoints.toString()} highlight />
          <StatItem label="Next Reward" value={`${Math.round(progressPercent)}%`} isProgress progressValue={progressPercent} />
        </div>

        {pendingPoints > 0 && (
          <div
            className="rounded-xl border px-4 py-3"
            style={{
              borderColor: 'var(--n5-border)',
              backgroundColor: 'color-mix(in srgb, var(--n5-accent) 6%, white)',
            }}
          >
            <p className="font-body text-[10px] font-bold uppercase tracking-[0.16em] text-[var(--n5-ink-muted)]">
              Pending points
            </p>
            <p className="font-body mt-1 text-sm font-semibold text-[var(--n5-ink-main)]">
              +
              {pendingPoints.toLocaleString()}
              {' '}
              pts
              {pendingAppointments > 0 ? ` from ${pendingAppointments} booked ${pendingAppointments === 1 ? 'visit' : 'visits'}` : ''}
            </p>
            <p className="font-body mt-1 text-xs text-[var(--n5-ink-muted)]">
              These points move into your active balance after the salon marks the appointment complete.
            </p>
          </div>
        )}
      </SectionCard>
    </motion.div>
  );
};

/**
 * 2. APPOINTMENT TICKET
 */
const AppointmentTicket = ({
  appointment,
  services,
  technician,
  location,
  loading,
  onManageBooking,
  onOpenDirections,
  onBookNow,
}: {
  appointment: AppointmentData | null;
  services: ServiceData[];
  technician: TechnicianData | null;
  location: AppointmentLocationData | null;
  loading: boolean;
  onManageBooking: () => void;
  onOpenDirections: () => void;
  onBookNow: () => void;
}) => {
  if (loading) {
    return (
      <SectionCard className="mt-6 border-[var(--n5-border)] bg-[var(--n5-bg-card)]">
        <div className="space-y-3">
          <div className="h-4 w-32 animate-pulse rounded bg-[var(--n5-bg-surface)]/80" />
          <div className="h-16 animate-pulse rounded-2xl bg-[var(--n5-bg-surface)]/80" />
          <div className="grid grid-cols-2 gap-3">
            <div className="h-11 animate-pulse rounded-xl bg-[var(--n5-bg-surface)]/80" />
            <div className="h-11 animate-pulse rounded-xl bg-[var(--n5-bg-surface)]/80" />
          </div>
        </div>
      </SectionCard>
    );
  }

  if (!appointment) {
    return (
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}>
        <StateCard
          className="mt-6 border-[var(--n5-border)] bg-[var(--n5-bg-card)]"
          icon="📅"
          title="Nothing booked yet"
          description="When you are ready, reserve your next appointment."
          action={(
            <button
              type="button"
              onClick={() => {
                triggerHaptic();
                onBookNow();
              }}
              aria-label="Book an appointment"
              className="font-body mt-2 bg-[var(--n5-accent)] px-6 py-3 text-[13px] font-semibold tracking-wide text-[var(--n5-ink-inverse)] transition-all active:scale-[0.96]"
              style={{
                borderRadius: n5.radiusMd,
                boxShadow: n5.shadowSm,
              }}
            >
              Book an appointment
            </button>
          )}
        />
      </motion.div>
    );
  }

  const serviceName = services.map(s => s.name).join(' + ') || 'Appointment';
  const techName = technician?.name || 'Any Artist';
  const price = `$${(appointment.totalPrice / 100).toFixed(0)}`;
  const directionsUrl = buildGoogleMapsDirectionsUrl(location);

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.2 }}
      aria-label={`Upcoming appointment: ${serviceName} with ${techName}`}
    >
      <SectionCard
        className="mt-6 border-[var(--n5-border)] bg-[var(--n5-bg-card)]"
        title="Upcoming appointment"
        description={formatDateWithTime(appointment.startTime)}
        actions={(
          <span
            className="font-body px-3 py-1 text-xs font-semibold text-[var(--n5-ink-main)]"
            style={{
              borderRadius: n5.radiusPill,
              backgroundColor: 'var(--n5-bg-page)',
            }}
          >
            {price}
          </span>
        )}
        contentClassName="space-y-4"
      >
        <div className="flex items-start gap-4">
          <div
            className="relative size-14 overflow-hidden border"
            style={{ borderRadius: n5.radiusMd, borderColor: 'var(--n5-border)' }}
          >
            {services[0]?.imageUrl
              ? (
                  <Image
                    src={services[0].imageUrl}
                    alt={serviceName}
                    fill
                    className="object-cover"
                  />
                )
              : (
                  <div className="flex size-full items-center justify-center bg-[var(--n5-bg-surface)] text-xl">
                    💅
                  </div>
                )}
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="font-heading text-lg font-semibold leading-tight text-[var(--n5-ink-main)]">
              {serviceName}
            </h3>
            <p className="font-body mt-1 text-sm text-[var(--n5-ink-muted)]">
              with
              {' '}
              {techName}
            </p>
          </div>
        </div>

        <div className={`grid gap-3 ${directionsUrl ? 'grid-cols-2' : 'grid-cols-1'}`}>
          <button
            type="button"
            data-testid="profile-manage-booking"
            onClick={() => {
              triggerHaptic();
              onManageBooking();
            }}
            aria-label={`Manage booking for ${serviceName}`}
            className="font-body flex min-h-[48px] items-center justify-center bg-[var(--n5-accent)] py-3 text-sm font-bold text-[var(--n5-ink-inverse)] transition-all active:scale-[0.98]"
            style={{
              borderRadius: n5.radiusMd,
              boxShadow: n5.shadowSm,
            }}
          >
            Manage booking
          </button>
          {directionsUrl && (
            <button
              type="button"
              onClick={() => {
                triggerHaptic();
                onOpenDirections();
              }}
              aria-label="Get directions to salon"
              className="font-body flex min-h-[48px] items-center justify-center space-x-1 border py-3 text-sm font-semibold text-[var(--n5-ink-main)] transition-all active:scale-[0.98]"
              style={{
                borderRadius: n5.radiusMd,
                borderColor: 'var(--n5-border)',
              }}
            >
              <MapPin className="size-4" />
              <span>Directions</span>
            </button>
          )}
        </div>
      </SectionCard>
    </motion.div>
  );
};

/**
 * 3. QUICK ACTIONS GRID
 */
const QuickActions = ({ onNavigate }: { onNavigate: (path: string) => void }) => {
  const actions = [
    { label: 'Book', icon: Calendar, path: '/book' },
    { label: 'Rewards', icon: Gift, path: '/rewards' },
    { label: 'Gallery', icon: ImageIcon, path: '/gallery' },
    { label: 'Style ID', icon: Fingerprint, path: '/preferences' },
  ];

  return (
    <SectionCard
      title="Quick links"
      className="mt-6 border-[var(--n5-border)] bg-[var(--n5-bg-card)]"
      contentClassName="grid grid-cols-2 gap-3 pt-0"
    >
      {actions.map((item, i) => (
        <motion.button
          key={item.label}
          type="button"
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 + (i * 0.06) }}
          whileTap={{ scale: 0.98 }}
          onClick={() => {
            triggerHaptic();
            onNavigate(item.path);
          }}
          aria-label={`Open ${item.label}`}
          className="group flex items-center gap-3 rounded-2xl border px-4 py-3 text-left transition-colors hover:bg-[var(--n5-bg-surface)]"
          style={{ borderColor: 'var(--n5-border-muted)' }}
        >
          <div
            className="flex size-10 shrink-0 items-center justify-center"
            style={{
              borderRadius: n5.radiusMd,
              backgroundColor: 'var(--n5-bg-page)',
            }}
          >
            <item.icon strokeWidth={1.6} className="size-5 text-[var(--n5-accent)]" />
          </div>
          <span className="font-body text-sm font-semibold text-[var(--n5-ink-main)]">
            {item.label}
          </span>
        </motion.button>
      ))}
    </SectionCard>
  );
};

/**
 * 4. SETTINGS LIST
 */
const SettingsGroup = ({ title, items }: { title: string; items: SettingsItem[] }) => (
  <div className="mt-8">
    <h3
      className="font-heading mb-2 px-4 text-xs font-bold uppercase tracking-widest text-[var(--n5-ink-muted)] opacity-80"
    >
      {title}
    </h3>
    <div
      className="overflow-hidden bg-[var(--n5-bg-card)]"
      style={{
        borderRadius: n5.radiusCard,
        boxShadow: n5.shadowSm,
      }}
    >
      {items.map((item, i) => (
        <button
          type="button"
          key={item.label}
          onClick={() => {
            triggerHaptic();
            item.onClick?.();
          }}
          aria-label={`Go to ${item.label}`}
          className="group flex min-h-[56px] w-full cursor-pointer items-center justify-between p-4 transition-colors last:border-0 hover:bg-[var(--n5-bg-surface)] active:bg-[var(--n5-bg-selected)]"
          style={{ borderBottomWidth: i < items.length - 1 ? 1 : 0, borderColor: 'var(--n5-border-muted)' }}
        >
          <div className="flex items-center space-x-3">
            <div
              className="bg-[var(--n5-bg-surface)] p-2 text-[var(--n5-accent)] transition-colors group-hover:text-[var(--n5-accent-hover)]"
              style={{ borderRadius: n5.radiusSm }}
            >
              <item.icon size={18} strokeWidth={2} />
            </div>
            <span
              className="font-body text-[15px] font-medium text-[var(--n5-ink-main)]"
            >
              {item.label}
            </span>
          </div>
          <div className="flex items-center space-x-2">
            {item.badge && (
              <span
                className="bg-[var(--n5-success)]/10 font-body px-2 py-1 text-[10px] font-bold text-[var(--n5-success)]"
                style={{ borderRadius: n5.radiusPill }}
              >
                {item.badge}
              </span>
            )}
            <ChevronRight
              size={16}
              className="text-[var(--n5-ink-muted)] transition-colors group-hover:text-[var(--n5-accent)]"
            />
          </div>
        </button>
      ))}
    </div>
  </div>
);

/**
 * 5. PROFILE COMPLETE BANNER
 * Shown when user hasn't completed their profile (missing name or email)
 */
const ProfileCompleteBanner = ({ onComplete }: { onComplete: () => void }) => (
  <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }}>
    <SectionCard
      title="Complete your profile"
      description="Add your name and email to earn a 2,500-point profile reward."
      className="mt-4 border-[var(--n5-border)] bg-[var(--n5-bg-card)]"
      actions={<Gift className="size-5 text-[var(--n5-accent)]" />}
      contentClassName="pt-0"
    >
      <button
        type="button"
        onClick={() => {
          triggerHaptic();
          onComplete();
        }}
        className="font-body flex w-full items-center justify-center gap-2 bg-[var(--n5-accent)] py-3 text-[13px] font-bold text-white transition-all active:scale-[0.98]"
        style={{
          borderRadius: n5.radiusMd,
          boxShadow: n5.shadowSm,
        }}
      >
        <Sparkles className="size-4" />
        Finish profile
      </button>
    </SectionCard>
  </motion.div>
);

/**
 * 6. PROFILE EDIT SHEET
 * Bottom sheet modal for editing name and email
 */
const ProfileEditSheet = ({
  isOpen,
  onClose,
  initialName,
  initialEmail,
  onSave,
  isLoading,
}: {
  isOpen: boolean;
  onClose: () => void;
  initialName: string;
  initialEmail: string;
  onSave: (name: string, email: string) => Promise<void>;
  isLoading: boolean;
}) => {
  const [name, setName] = useState(initialName === 'Guest' ? '' : initialName);
  const [email, setEmail] = useState(initialEmail);
  const [nameError, setNameError] = useState('');
  const [emailError, setEmailError] = useState('');
  const sheetRef = useRef<HTMLDivElement>(null);

  // Reset form when sheet opens
  useEffect(() => {
    if (isOpen) {
      setName(initialName === 'Guest' ? '' : initialName);
      setEmail(initialEmail);
      setNameError('');
      setEmailError('');
      setTimeout(() => sheetRef.current?.focus(), 50);
    }
  }, [isOpen, initialName, initialEmail]);

  // Escape key handler
  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (!isLoading && e.key === 'Escape') {
        onClose();
      }
    };
    if (isOpen) {
      window.addEventListener('keydown', handleEsc);
    }
    return () => window.removeEventListener('keydown', handleEsc);
  }, [isOpen, onClose, isLoading]);

  const validateEmail = (emailValue: string) => {
    const emailRegex = /^[^\s@]+@[^\s@][^\s.@]*\.[^\s@]+$/;
    return emailRegex.test(emailValue);
  };

  const handleSubmit = async () => {
    // Validate
    let hasError = false;

    if (!name.trim()) {
      setNameError('Please enter your name');
      hasError = true;
    } else {
      setNameError('');
    }

    if (!email.trim()) {
      setEmailError('Please enter your email');
      hasError = true;
    } else if (!validateEmail(email)) {
      setEmailError('Please enter a valid email');
      hasError = true;
    } else {
      setEmailError('');
    }

    if (hasError) {
      return;
    }

    await onSave(name.trim(), email.trim());
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={!isLoading ? onClose : undefined}
            className="fixed inset-0 z-[60] backdrop-blur-sm"
            style={{ backgroundColor: `color-mix(in srgb, var(--n5-ink-main) 40%, transparent)` }}
            aria-hidden="true"
          />

          {/* Sheet */}
          <motion.div
            ref={sheetRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="edit-profile-title"
            tabIndex={-1}
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', damping: 25, stiffness: 200 }}
            className="fixed inset-x-0 bottom-0 z-[70] overflow-hidden bg-[var(--n5-bg-card)] p-6 pb-10 outline-none"
            style={{
              borderRadius: `${n5.radiusCard} ${n5.radiusCard} 0 0`,
              boxShadow: n5.shadowLg,
            }}
          >
            {/* Handle */}
            <div className="mx-auto mb-6 h-1.5 w-12 rounded-full bg-[var(--n5-border-muted)]" />

            {/* Header */}
            <div className="mb-6 text-center">
              <div
                className="mx-auto mb-4 flex size-16 items-center justify-center rounded-full border border-[var(--n5-border)] shadow-sm"
                style={{
                  background: `linear-gradient(to top right, var(--n5-bg-page), white)`,
                }}
              >
                <User className="size-7 text-[var(--n5-accent)]" />
              </div>
              <h2 id="edit-profile-title" className="font-heading text-xl tracking-tight text-[var(--n5-ink-main)]">
                Complete your profile
              </h2>
              <p className="font-body mt-1 text-[13px] text-[var(--n5-ink-muted)]">
                Add your details to earn your 2,500-point profile reward.
              </p>
            </div>

            {/* Form */}
            <form
              onSubmit={(e) => {
                e.preventDefault(); handleSubmit();
              }}
              className="space-y-4"
            >
              {/* Name Input */}
              <div>
                <label
                  htmlFor="profile-name"
                  className="font-body mb-1.5 block text-xs font-semibold uppercase tracking-wider text-[var(--n5-ink-muted)]"
                >
                  Name
                </label>
                <div className="relative">
                  <User className="absolute left-4 top-1/2 size-4 -translate-y-1/2 text-[var(--n5-ink-muted)]" />
                  <input
                    id="profile-name"
                    type="text"
                    value={name}
                    onChange={e => setName(e.target.value)}
                    placeholder="Your name"
                    className={cn(
                      'w-full rounded-xl border bg-[var(--n5-bg-surface)] py-3.5 pl-11 pr-4 text-[15px] text-[var(--n5-ink-main)] placeholder:text-[var(--n5-ink-muted)]/50 outline-none transition-all font-body',
                      nameError
                        ? 'border-[var(--n5-error)] focus:border-[var(--n5-error)]'
                        : 'border-[var(--n5-border)] focus:border-[var(--n5-accent)]',
                    )}
                    disabled={isLoading}
                  />
                </div>
                {nameError && (
                  <p className="font-body mt-1 text-xs text-[var(--n5-error)]">{nameError}</p>
                )}
              </div>

              {/* Email Input */}
              <div>
                <label
                  htmlFor="profile-email"
                  className="font-body mb-1.5 block text-xs font-semibold uppercase tracking-wider text-[var(--n5-ink-muted)]"
                >
                  Email
                </label>
                <div className="relative">
                  <Mail className="absolute left-4 top-1/2 size-4 -translate-y-1/2 text-[var(--n5-ink-muted)]" />
                  <input
                    id="profile-email"
                    type="email"
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    placeholder="your@email.com"
                    className={cn(
                      'w-full rounded-xl border bg-[var(--n5-bg-surface)] py-3.5 pl-11 pr-4 text-[15px] text-[var(--n5-ink-main)] placeholder:text-[var(--n5-ink-muted)]/50 outline-none transition-all font-body',
                      emailError
                        ? 'border-[var(--n5-error)] focus:border-[var(--n5-error)]'
                        : 'border-[var(--n5-border)] focus:border-[var(--n5-accent)]',
                    )}
                    disabled={isLoading}
                  />
                </div>
                {emailError && (
                  <p className="font-body mt-1 text-xs text-[var(--n5-error)]">{emailError}</p>
                )}
              </div>

              {/* Submit Button */}
              <button
                type="submit"
                disabled={isLoading}
                className="font-body mt-6 flex w-full items-center justify-center gap-2 bg-[var(--n5-accent)] py-4 text-[14px] font-bold text-white transition-all active:scale-[0.98] disabled:opacity-60"
                style={{
                  borderRadius: n5.radiusMd,
                  boxShadow: n5.shadowSm,
                }}
              >
                {isLoading
                  ? (
                      <>
                        <div className="size-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                        Saving...
                      </>
                    )
                  : (
                      <>
                        <Check className="size-4" />
                        Save & Earn Points
                      </>
                    )}
              </button>
            </form>

            {/* Cancel Button */}
            {!isLoading && (
              <button
                type="button"
                onClick={onClose}
                className="font-body mt-3 w-full py-3 text-[13px] font-semibold text-[var(--n5-ink-muted)] transition-colors"
              >
                Cancel
              </button>
            )}
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
};

/**
 * 7. SKELETON LOADER (For Refresh State)
 */
const ProfileSkeleton = () => (
  <motion.div
    initial={{ opacity: 0 }}
    animate={{ opacity: 1 }}
    exit={{ opacity: 0 }}
    className="space-y-6"
  >
    <div
      className="bg-[var(--n5-bg-card)]/50 aspect-[1.58/1] w-full animate-pulse"
      style={{ borderRadius: n5.radiusCard }}
    />
    <div
      className="bg-[var(--n5-bg-card)]/50 h-40 w-full animate-pulse"
      style={{ borderRadius: n5.radiusCard }}
    />
    <div className="grid grid-cols-4 gap-3">
      {[1, 2, 3, 4].map(i => (
        <div
          key={i}
          className="bg-[var(--n5-bg-card)]/50 size-[4.5rem] animate-pulse"
          style={{ borderRadius: n5.radiusMd }}
        />
      ))}
    </div>
  </motion.div>
);

// --- MAIN PAGE ---

export default function ProfileContent() {
  const router = useRouter();
  const params = useParams();
  const locale = (params?.locale as string) || 'en';
  const routeSalonSlug = typeof params?.slug === 'string' ? params.slug : null;
  const { salonName, salonSlug } = useSalon();
  const {
    phone: sessionPhone,
    clientName: sessionClientName,
    clientEmail: sessionClientEmail,
  } = useClientSession();
  const [isRefreshing, setIsRefreshing] = useState(false);

  // User data
  const [userName, setUserName] = useState('Guest');
  const [clientEmail, setClientEmail] = useState('');
  const [clientPhone, setClientPhone] = useState('');
  const [profileImage, setProfileImage] = useState<string | null>(null);
  const profileImageInputRef = useRef<HTMLInputElement | null>(null);

  // Profile completion state
  const [showEditSheet, setShowEditSheet] = useState(false);
  const [isSavingProfile, setIsSavingProfile] = useState(false);

  // Derived: profile is complete if we have both name (not Guest) and email
  const isProfileComplete = userName !== 'Guest' && userName.trim() !== '' && clientEmail.trim() !== '';

  // Appointment data
  const [nextAppointment, setNextAppointment] = useState<AppointmentData | null>(null);
  const [nextAppointmentServices, setNextAppointmentServices] = useState<ServiceData[]>([]);
  const [nextAppointmentTech, setNextAppointmentTech] = useState<TechnicianData | null>(null);
  const [nextAppointmentLocation, setNextAppointmentLocation] = useState<AppointmentLocationData | null>(null);
  const [appointmentLoading, setAppointmentLoading] = useState(true);

  // Rewards
  const [activePoints, setActivePoints] = useState(0);
  const [pendingPoints, setPendingPoints] = useState(0);
  const [pendingAppointments, setPendingAppointments] = useState(0);

  // Invite state
  const [showConfetti, setShowConfetti] = useState(false);

  // Stats (some will be from API in production)
  const userStats = {
    totalVisits: 12,
    memberSince: 'March 2024',
    tier: 'Gold',
    savedAmount: 340,
  };

  useEffect(() => {
    if (sessionClientName) {
      setUserName(prev => (prev === 'Guest' || prev.trim() === '' ? sessionClientName : prev));
    } else if (!sessionPhone) {
      setUserName('Guest');
    }

    if (sessionClientEmail) {
      setClientEmail(prev => (prev.trim() === '' ? sessionClientEmail : prev));
    } else if (!sessionPhone) {
      setClientEmail('');
    }
  }, [sessionClientEmail, sessionClientName, sessionPhone]);

  useEffect(() => {
    setClientPhone(sessionPhone);
  }, [sessionPhone]);

  // Fetch next appointment
  useEffect(() => {
    async function fetchNextAppointment() {
      if (!clientPhone) {
        setAppointmentLoading(false);
        return;
      }

      try {
        const response = await fetch(`/api/client/next-appointment?salonSlug=${encodeURIComponent(salonSlug)}`, {
          cache: 'no-store',
        });
        if (response.ok) {
          const data: NextAppointmentResponse = await response.json();
          setNextAppointment(data.data?.appointment || null);
          setNextAppointmentServices(data.data?.services || []);
          setNextAppointmentTech(data.data?.technician || null);
          setNextAppointmentLocation(data.data?.location || null);
        }
      } catch (error) {
        console.error('Failed to fetch next appointment:', error);
      } finally {
        setAppointmentLoading(false);
      }
    }

    if (clientPhone && salonSlug) {
      fetchNextAppointment();
    } else {
      setAppointmentLoading(false);
    }
  }, [clientPhone, salonSlug]);

  const handleOpenDirections = useCallback(() => {
    openGoogleMapsDirections(nextAppointmentLocation);
  }, [nextAppointmentLocation]);

  // Fetch rewards/points
  useEffect(() => {
    async function fetchRewards() {
      if (!clientPhone || !salonSlug) {
        return;
      }

      try {
        const response = await fetch(`/api/rewards?salonSlug=${encodeURIComponent(salonSlug)}`);
        if (response.ok) {
          const data = await response.json();
          setActivePoints(data.meta?.activePoints || 0);
          setPendingPoints(data.meta?.pendingPoints || 0);
          setPendingAppointments(data.meta?.pendingAppointments || 0);
        }
      } catch (error) {
        console.error('Failed to fetch rewards:', error);
      }
    }

    if (clientPhone && salonSlug) {
      fetchRewards();
    }
  }, [clientPhone, salonSlug]);

  // Pull-to-Refresh
  const handleRefresh = useCallback(() => {
    triggerHaptic();
    setIsRefreshing(true);
    setTimeout(() => {
      setIsRefreshing(false);
      triggerHaptic();
    }, 2000);
  }, []);

  const handleBack = useCallback(() => {
    triggerHaptic();
    router.back();
  }, [router]);

  const handleProfileImageClick = useCallback(() => {
    profileImageInputRef.current?.click();
  }, []);

  const handleProfileImageChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !file.type.startsWith('image/')) {
      return;
    }
    const imageUrl = URL.createObjectURL(file);
    setProfileImage(imageUrl);
  }, []);

  const handleManageBooking = useCallback(() => {
    if (!nextAppointment) {
      return;
    }
    router.push(buildChangeAppointmentUrl({
      salonSlug,
      serviceIds: nextAppointmentServices.map(s => s.id),
      techId: nextAppointmentTech?.id || 'any',
      locationId: nextAppointment.locationId,
      originalAppointmentId: nextAppointment.id,
      startTime: nextAppointment.startTime,
      tenantRoute: {
        routeSalonSlug,
        locale,
      },
    }));
  }, [locale, nextAppointment, nextAppointmentServices, nextAppointmentTech, routeSalonSlug, router, salonSlug]);

  const handleNavigate = useCallback((path: string) => {
    router.push(appendSalonSlug(path, salonSlug, {
      routeSalonSlug,
      locale,
    }));
  }, [locale, routeSalonSlug, router, salonSlug]);

  const handleLogout = useCallback(async () => {
    triggerHaptic();
    await fetch('/api/auth/logout', { method: 'POST' });
    router.push(appendSalonSlug('/book', salonSlug, {
      routeSalonSlug,
      locale,
    }));
  }, [locale, routeSalonSlug, router, salonSlug]);

  const experienceItems: SettingsItem[] = [
    { label: 'Beauty Profile', icon: User, onClick: () => handleNavigate('/preferences') },
    { label: 'Refer a Friend', icon: Share2, badge: '$35 OFF', onClick: () => handleNavigate('/invite') },
    { label: 'Rate Your Experience', icon: Star, badge: '$25 OFF', onClick: () => window.open('https://www.google.com/maps/place/Nail+Salon+No.5', '_blank') },
  ];

  const accountItems: SettingsItem[] = [
    { label: 'Membership Benefits', icon: Sparkles, onClick: () => handleNavigate('/membership') },
    { label: 'Payment Methods', icon: CreditCard, onClick: () => handleNavigate('/payment-methods') },
  ];

  // Handle profile save
  const handleSaveProfile = useCallback(async (name: string, email: string) => {
    if (!clientPhone || !salonSlug) {
      return;
    }

    setIsSavingProfile(true);

    try {
      const response = await fetch('/api/client/complete-profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          firstName: name,
          email,
          salonSlug,
        }),
      });

      if (response.ok) {
        const data = await response.json();

        // Update local state
        setUserName(name);
        setClientEmail(email);

        // Close sheet
        setShowEditSheet(false);

        // Show confetti if reward was granted
        if (data.data?.rewardGranted) {
          setShowConfetti(true);

          // Refresh points to include new reward
          const rewardsResponse = await fetch(
            `/api/rewards?salonSlug=${encodeURIComponent(salonSlug)}`,
          );
          if (rewardsResponse.ok) {
            const rewardsData = await rewardsResponse.json();
            setActivePoints(rewardsData.meta?.activePoints || 0);
            setPendingPoints(rewardsData.meta?.pendingPoints || 0);
            setPendingAppointments(rewardsData.meta?.pendingAppointments || 0);
          }
        }

        triggerHaptic();
      } else {
        const errorData = await response.json();
        console.error('Failed to save profile:', errorData);
      }
    } catch (error) {
      console.error('Error saving profile:', error);
    } finally {
      setIsSavingProfile(false);
    }
  }, [clientPhone, salonSlug]);

  return (
    <div
      className="min-h-screen bg-[var(--n5-bg-page)]"
      style={{ fontFamily: n5.fontBody }}
    >
      {/* Navbar - Fixed & Blurred */}
      <nav
        className="fixed inset-x-0 top-0 z-40 flex items-center justify-between border-b px-5 pb-2 pt-12 backdrop-blur-md"
        style={{
          backgroundColor: 'color-mix(in srgb, var(--n5-bg-page) 80%, transparent)',
          borderColor: 'var(--n5-border-muted)',
        }}
      >
        <button
          type="button"
          onClick={handleBack}
          aria-label="Go back"
          className="flex size-10 items-center justify-center bg-[var(--n5-bg-card)] text-[var(--n5-ink-main)] shadow-sm transition-transform active:scale-90"
          style={{ borderRadius: n5.radiusPill }}
        >
          <ChevronRight className="size-5 rotate-180" />
        </button>
        <span
          className="font-heading text-lg font-semibold tracking-tight text-[var(--n5-ink-main)]"
        >
          Profile
        </span>
        <button
          type="button"
          onClick={handleRefresh}
          aria-label="Refresh Profile"
          className="flex size-10 items-center justify-center text-[var(--n5-ink-main)] transition-transform active:rotate-180"
        >
          <RefreshCw className={cn('size-5', isRefreshing && 'animate-spin text-[var(--n5-accent)]')} />
        </button>
      </nav>

      {/* Main Scroll Content */}
      <main
      className="mx-auto max-w-lg space-y-4 px-5 py-28"
      >
        <AnimatePresence mode="wait">
          {isRefreshing
            ? (
                <ProfileSkeleton key="skeleton" />
              )
            : (
                <motion.div
                  key="content"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                >
                  <MemberCard
                    userName={userName}
                    userEmail={clientEmail || null}
                    profileImage={profileImage}
                    userStats={userStats}
                    activePoints={activePoints}
                    pendingPoints={pendingPoints}
                    pendingAppointments={pendingAppointments}
                    onImageClick={handleProfileImageClick}
                    profileImageInputRef={profileImageInputRef}
                    onProfileImageChange={handleProfileImageChange}
                    onEditProfile={() => setShowEditSheet(true)}
                  />

                  {/* Profile Completion Banner - shown when profile is incomplete */}
                  {!isProfileComplete && clientPhone && (
                    <ProfileCompleteBanner onComplete={() => setShowEditSheet(true)} />
                  )}

                  <AppointmentTicket
                    appointment={nextAppointment}
                    services={nextAppointmentServices}
                    technician={nextAppointmentTech}
                    location={nextAppointmentLocation}
                    loading={appointmentLoading}
                    onManageBooking={handleManageBooking}
                    onOpenDirections={handleOpenDirections}
                    onBookNow={() => handleNavigate('/book')}
                  />
                  <QuickActions onNavigate={handleNavigate} />

                  <SettingsGroup title="Your Experience" items={experienceItems} />
                  <SettingsGroup title="Account" items={accountItems} />

                  {/* Footer */}
                  <div className="pt-10 text-center opacity-40">
                    <p
                      className="font-heading text-[10px] italic text-[var(--n5-ink-main)]"
                    >
                      {salonName || 'Nail Salon No.5'}
                      {' '}
                      · Client profile
                    </p>
                  </div>

                  {/* Sign Out Button */}
                  <button
                    type="button"
                    onClick={handleLogout}
                    aria-label="Sign Out"
                    className="bg-[var(--n5-error)]/10 font-body mt-6 flex w-full items-center justify-center space-x-2 py-4 text-sm font-bold text-[var(--n5-error)] shadow-sm transition-transform active:scale-[0.98]"
                    style={{ borderRadius: n5.radiusMd }}
                  >
                    <LogOut className="size-4" />
                    <span>Sign Out</span>
                  </button>
                </motion.div>
              )}
        </AnimatePresence>
      </main>

      {/* Confetti Popup */}
      <ConfettiPopup
        isOpen={showConfetti}
        onClose={() => setShowConfetti(false)}
        title="2,500 points added"
        message="Thanks for completing your profile. Your reward points are now in your balance."
        emoji="🎉"
        autoDismissMs={4000}
      />

      {/* Profile Edit Sheet */}
      <ProfileEditSheet
        isOpen={showEditSheet}
        onClose={() => setShowEditSheet(false)}
        initialName={userName}
        initialEmail={clientEmail}
        onSave={handleSaveProfile}
        isLoading={isSavingProfile}
      />
    </div>
  );
}
