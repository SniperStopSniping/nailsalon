'use client';

import type { Easing } from 'framer-motion';
import {
  AnimatePresence,
  motion,
  useMotionValue,
  useReducedMotion,
  useSpring,
  useTransform,
} from 'framer-motion';
import {
  Calendar,
  ChevronRight,
  CreditCard,
  Fingerprint,
  Gift,
  Home,
  Image as ImageIcon,
  LogOut,
  MapPin,
  RefreshCw,
  Share2,
  Sparkles,
  Star,
  User,
} from 'lucide-react';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import React, { useCallback, useEffect, useRef, useState } from 'react';

import { ConfettiPopup } from '@/components/ConfettiPopup';
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
  clientPhone: string;
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

// --- Animation Variants ---
const meshVariant = {
  animate: {
    scale: [1, 1.1, 0.9, 1],
    x: [0, 20, -20, 0],
    y: [0, -20, 20, 0],
    rotate: [0, 10, -10, 0],
    transition: {
      duration: 15,
      repeat: Infinity,
      ease: 'easeInOut' as Easing,
    },
  },
};

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
      className="mb-1 text-[9px] uppercase tracking-widest text-[var(--n5-ink-main)] opacity-60 font-body"
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
              className="self-end text-[10px] font-bold tabular-nums text-[var(--n5-accent)] font-body"
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
 * 1. PARALLAX MEMBER CARD (GOD MODE - OPTIMIZED)
 * Features: Mouse Tilt + Mobile Gyroscope + Breathing Mesh + Reduced Motion Support
 */
const MemberCard = ({
  userName,
  profileImage,
  userStats,
  activePoints,
  onImageClick,
  profileImageInputRef,
  onProfileImageChange,
}: {
  userName: string;
  profileImage: string | null;
  userStats: { totalVisits: number; tier: string; savedAmount: number };
  activePoints: number;
  onImageClick: () => void;
  profileImageInputRef: React.RefObject<HTMLInputElement | null>;
  onProfileImageChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
}) => {
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const shouldReduceMotion = useReducedMotion();

  // Calculate progress to next reward (2500 pts)
  const progressPercent = Math.min(100, (activePoints / 2500) * 100);

  // Gyroscope Logic for Mobile
  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }
    if (shouldReduceMotion) {
      return;
    }

    const handleOrientation = (e: DeviceOrientationEvent) => {
      const gamma = e.gamma;
      const beta = e.beta;

      if (gamma === null || beta === null) {
        return;
      }

      const clampedX = Math.min(Math.max(gamma, -20), 20);
      const clampedY = Math.min(Math.max(beta, -20), 20);
      x.set(clampedX * 2);
      y.set(clampedY * 2);
    };

    window.addEventListener('deviceorientation', handleOrientation);
    return () => window.removeEventListener('deviceorientation', handleOrientation);
  }, [x, y, shouldReduceMotion]);

  const rotateX = useTransform(y, [-100, 100], [5, -5]);
  const rotateY = useTransform(x, [-100, 100], [-5, 5]);

  const springConfig = { damping: 25, stiffness: 150 };
  const rotateXSpring = useSpring(rotateX, springConfig);
  const rotateYSpring = useSpring(rotateY, springConfig);

  function handleMouseMove(event: React.MouseEvent<HTMLDivElement, MouseEvent>) {
    if (shouldReduceMotion) {
      return;
    }
    const rect = event.currentTarget.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    x.set(event.clientX - centerX);
    y.set(event.clientY - centerY);
  }

  function handleMouseLeave() {
    x.set(0);
    y.set(0);
  }

  return (
    <motion.div
      style={{
        rotateX: shouldReduceMotion ? 0 : rotateXSpring,
        rotateY: shouldReduceMotion ? 0 : rotateYSpring,
        perspective: 1000,
      }}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      className="group relative z-10 aspect-[1.58/1] w-full cursor-grab select-none active:cursor-grabbing"
      aria-label="Gold Member Card showing stats and savings"
      role="region"
    >
      {/* Container with Luxury Layered Shadow */}
      <div
        className="absolute inset-0 border-[1.5px] bg-[var(--n5-bg-card)] transition-transform duration-500 hover:scale-[1.02]"
        style={{
          borderRadius: n5.radiusCard,
          boxShadow: n5.shadowLg,
          borderColor: 'var(--n5-border)',
        }}
      >
        {/* A. Animated Mesh Background */}
        <div
          className="absolute inset-0 overflow-hidden"
          style={{ borderRadius: n5.radiusCard }}
        >
          {!shouldReduceMotion && (
            <>
              <motion.div
                variants={meshVariant}
                animate="animate"
                className="absolute -top-1/2 left-[-20%] h-full w-4/5 rounded-full opacity-80 blur-[80px] bg-[var(--n5-bg-highlight)]"
              />
              <motion.div
                variants={meshVariant}
                animate="animate"
                transition={{ delay: 2, duration: 18, repeat: Infinity, ease: 'easeInOut' }}
                className="absolute bottom-[-20%] right-[-10%] h-4/5 w-3/5 rounded-full opacity-50 mix-blend-multiply blur-[60px] bg-[var(--n5-accent-soft)]"
              />
              <motion.div
                variants={meshVariant}
                animate="animate"
                transition={{ delay: 5, duration: 20, repeat: Infinity, ease: 'easeInOut' }}
                className="absolute right-[10%] top-[20%] h-3/5 w-2/5 rounded-full opacity-20 blur-[90px] bg-[var(--n5-accent)]"
              />
            </>
          )}
        </div>

        {/* B. Glass Surface */}
        <div
          className="absolute inset-0 bg-[var(--n5-bg-card)]/30 backdrop-blur-[20px]"
          style={{ borderRadius: n5.radiusCard }}
        />

        {/* C. Content Layer */}
        <div
          className="relative flex h-full flex-col justify-between text-[var(--n5-ink-main)]"
          style={{ padding: n5.spaceLg }}
        >
          {/* Top Row */}
          <div className="flex items-start justify-between">
            <div className="flex items-center space-x-2">
              <Sparkles className="size-4 text-[var(--n5-accent)]" />
              <span className="text-[10px] font-bold uppercase tracking-[0.2em] opacity-90 font-body">
                {userStats.tier}
                {' '}
                Member
              </span>
            </div>
            {/* Salon Logo */}
            <div
              className="flex size-10 items-center justify-center border bg-[var(--n5-bg-card)]/40 shadow-sm backdrop-blur-md"
              style={{
                borderRadius: n5.radiusPill,
                borderColor: 'var(--n5-border)',
              }}
            >
              <span className="font-heading text-xs font-bold text-[var(--n5-ink-main)]">N5</span>
            </div>
          </div>

          {/* Middle Row */}
          <div className="flex items-center space-x-4">
            <div className="relative">
              <div
                className="absolute -inset-1 rounded-full opacity-60 blur-sm"
                style={{ background: `linear-gradient(to right, var(--n5-accent), var(--n5-bg-highlight))` }}
              />
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
                className="relative size-16 overflow-hidden rounded-full border-[3px] border-white shadow-sm"
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
                        className="flex size-full items-center justify-center text-2xl"
                        style={{ background: `linear-gradient(to bottom right, var(--n5-accent-soft), var(--n5-accent))` }}
                      >
                        👤
                      </div>
                    )}
              </button>
              <div
                className="absolute bottom-0 right-0 z-10 size-4 rounded-full border-2 border-white shadow-sm bg-[var(--n5-success)]"
              />
            </div>
            <div>
              <h2 className="font-heading text-2xl font-semibold leading-none tracking-tight">
                {userName}
              </h2>
              <p
                className="mt-1 text-[11px] font-medium uppercase tracking-wide text-[var(--n5-ink-muted)] font-body"
              >
                Saved $
                {userStats.savedAmount}
                {' '}
                this year
              </p>
            </div>
          </div>

          {/* Bottom Stats */}
          <div
            className="grid grid-cols-3 gap-4 pt-4"
            style={{ borderTopWidth: 1, borderColor: 'var(--n5-border-muted)' }}
          >
            <StatItem label="Visits" value={userStats.totalVisits.toString()} />
            <StatItem label="Points" value={activePoints >= 1000 ? `${(activePoints / 1000).toFixed(1)}k` : activePoints.toString()} highlight />
            <StatItem label="Next Reward" value={`${Math.round(progressPercent)}%`} isProgress progressValue={progressPercent} />
          </div>
        </div>
      </div>
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
  loading,
  onManageBooking,
  onBookNow,
}: {
  appointment: AppointmentData | null;
  services: ServiceData[];
  technician: TechnicianData | null;
  loading: boolean;
  onManageBooking: () => void;
  onBookNow: () => void;
}) => {
  if (loading) {
    return (
      <div
        className="mt-6 h-40 w-full animate-pulse bg-[var(--n5-bg-card)]/50"
        style={{ borderRadius: n5.radiusCard }}
      />
    );
  }

  if (!appointment) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2 }}
        className="relative mt-6 w-full overflow-hidden bg-[var(--n5-bg-card)] text-center"
        style={{
          borderRadius: n5.radiusCard,
          boxShadow: n5.shadowSm,
          padding: n5.spaceLg,
        }}
        aria-label="No upcoming appointments"
      >
        <div className="mb-2 text-3xl">📅</div>
        <p className="mb-3 text-[var(--n5-ink-muted)] font-body">No upcoming appointments</p>
        <button
          type="button"
          onClick={() => {
            triggerHaptic();
            onBookNow();
          }}
          aria-label="Book your first appointment"
          className="px-6 py-3 text-[13px] font-semibold tracking-wide text-[var(--n5-ink-inverse)] transition-all active:scale-[0.96] bg-[var(--n5-accent)] font-body"
          style={{
            borderRadius: n5.radiusMd,
            boxShadow: n5.shadowSm,
          }}
        >
          Book Your First Appointment
        </button>
      </motion.div>
    );
  }

  const serviceName = services.map(s => s.name).join(' + ') || 'Appointment';
  const techName = technician?.name || 'Any Artist';
  const price = `$${(appointment.totalPrice / 100).toFixed(0)}`;

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.2 }}
      className="relative mt-6 w-full overflow-hidden bg-[var(--n5-bg-card)]"
      style={{
        borderRadius: n5.radiusCard,
        boxShadow: n5.shadowSm,
        padding: n5.spaceLg,
      }}
      aria-label={`Upcoming appointment: ${serviceName} with ${techName}`}
    >
      <motion.div
        animate={{ opacity: [0, 0.5, 0] }}
        transition={{ duration: 4, repeat: Infinity, ease: 'easeInOut' }}
        className="pointer-events-none absolute inset-0"
        style={{
          borderRadius: n5.radiusCard,
          borderWidth: 1.5,
          borderColor: 'var(--n5-accent)',
        }}
      />

      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center space-x-2 text-[var(--n5-accent)]">
          <Calendar className="size-4" strokeWidth={2.5} />
          <span className="text-[11px] font-bold uppercase tracking-wider font-body">Upcoming</span>
        </div>
        <span
          className="px-3 py-1 text-xs font-semibold text-[var(--n5-ink-main)] bg-[var(--n5-bg-surface)] font-body"
          style={{ borderRadius: n5.radiusPill }}
        >
          {formatDateWithTime(appointment.startTime)}
        </span>
      </div>

      <div className="flex items-start space-x-4">
        <div
          className="relative size-14 overflow-hidden shadow-sm"
          style={{ borderRadius: n5.radiusMd }}
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
                <div
                  className="flex size-full items-center justify-center text-xl bg-[var(--n5-bg-surface)]"
                >
                  💅
                </div>
              )}
        </div>
        <div className="flex-1">
          <h3
            className="font-heading text-lg font-semibold leading-tight text-[var(--n5-ink-main)]"
          >
            {serviceName}
          </h3>
          <p
            className="mt-1 text-sm font-medium text-[var(--n5-ink-muted)] font-body"
          >
            with
            {' '}
            {techName}
            {' '}
            ·
            {' '}
            {price}
          </p>
        </div>
      </div>

      <div className="mt-5 grid grid-cols-2 gap-3">
        <button
          type="button"
          onClick={() => {
            triggerHaptic();
            onManageBooking();
          }}
          aria-label={`Manage booking for ${serviceName}`}
          className="flex min-h-[48px] items-center justify-center py-3 text-xs font-bold text-[var(--n5-ink-inverse)] transition-all active:scale-[0.98] bg-[var(--n5-accent)] font-body"
          style={{
            borderRadius: n5.radiusMd,
            boxShadow: n5.shadowSm,
          }}
        >
          Manage Booking
        </button>
        <button
          type="button"
          onClick={triggerHaptic}
          aria-label="Get directions to salon"
          className="flex min-h-[48px] items-center justify-center space-x-1 py-3 text-xs font-bold transition-all active:scale-[0.98] bg-transparent text-[var(--n5-ink-main)] font-body"
          style={{
            borderRadius: n5.radiusMd,
            borderWidth: 1,
            borderColor: 'var(--n5-border)',
          }}
        >
          <MapPin className="size-3" />
          <span>Directions</span>
        </button>
      </div>
    </motion.div>
  );
};

/**
 * 3. QUICK ACTIONS GRID
 */
const QuickActions = ({ onNavigate }: { onNavigate: (path: string) => void }) => {
  const actions = [
    { label: 'Book', icon: Calendar, path: '/book' },
    { label: 'Rewards', icon: Gift, hasUpdate: true, path: '/rewards' },
    { label: 'Gallery', icon: ImageIcon, path: '/gallery' },
    { label: 'Style ID', icon: Fingerprint, path: '/preferences' },
  ];

  return (
    <div className="mt-8 grid grid-cols-4 gap-3" role="group" aria-label="Quick Actions">
      {actions.map((item, i) => (
        <motion.button
          key={item.label}
          type="button"
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: 0.3 + (i * 0.1) }}
          whileTap={{ scale: 0.95 }}
          onClick={() => {
            triggerHaptic();
            onNavigate(item.path);
          }}
          aria-label={`Open ${item.label}`}
          className="group relative flex flex-col items-center"
        >
          <div
            className="relative flex size-[4.5rem] items-center justify-center border border-transparent bg-[var(--n5-bg-card)] transition-all duration-300 hover:border-[var(--n5-border-accent)]/30 hover:shadow-lg text-[var(--n5-ink-main)]"
            style={{
              borderRadius: n5.radiusMd,
              boxShadow: n5.shadowSm,
            }}
          >
            <item.icon strokeWidth={1.5} className="size-7 transition-colors duration-300 group-hover:text-[var(--n5-accent)]" />
            {item.hasUpdate && (
              <span className="absolute right-3 top-3 size-2 rounded-full bg-[var(--n5-error)] ring-2 ring-white" />
            )}
          </div>
          <span
            className="mt-2 text-[10px] font-bold uppercase tracking-wide transition-colors text-[var(--n5-ink-muted)] group-hover:text-[var(--n5-ink-main)] font-body"
          >
            {item.label}
          </span>
        </motion.button>
      ))}
    </div>
  );
};

/**
 * 4. SETTINGS LIST
 */
const SettingsGroup = ({ title, items }: { title: string; items: SettingsItem[] }) => (
  <div className="mt-8">
    <h3
      className="mb-2 px-4 text-xs font-bold uppercase tracking-widest opacity-80 text-[var(--n5-ink-muted)] font-heading"
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
              className="p-2 transition-colors group-hover:text-[var(--n5-accent-hover)] bg-[var(--n5-bg-surface)] text-[var(--n5-accent)]"
              style={{ borderRadius: n5.radiusSm }}
            >
              <item.icon size={18} strokeWidth={2} />
            </div>
            <span
              className="text-[15px] font-medium text-[var(--n5-ink-main)] font-body"
            >
              {item.label}
            </span>
          </div>
          <div className="flex items-center space-x-2">
            {item.badge && (
              <span
                className="px-2 py-1 text-[10px] font-bold bg-[var(--n5-success)]/10 text-[var(--n5-success)] font-body"
                style={{ borderRadius: n5.radiusPill }}
              >
                {item.badge}
              </span>
            )}
            <ChevronRight
              size={16}
              className="transition-colors group-hover:text-[var(--n5-accent)] text-[var(--n5-ink-muted)]"
            />
          </div>
        </button>
      ))}
    </div>
  </div>
);

/**
 * 5. FLOATING DOCK
 */
const FloatingDock = ({ onBookNow, onHome }: { onBookNow: () => void; onHome: () => void }) => (
  <div
    className="fixed bottom-6 left-1/2 z-50 flex h-16 w-[90%] max-w-[400px] -translate-x-1/2 items-center justify-between px-8"
    style={{
      backgroundColor: 'var(--n5-bg-card)',
      backdropFilter: 'blur(20px) saturate(150%)',
      WebkitBackdropFilter: 'blur(20px) saturate(150%)',
      borderWidth: 1,
      borderColor: 'var(--n5-border)',
      boxShadow: n5.shadowDock,
      borderRadius: n5.radiusCard,
    }}
    role="navigation"
    aria-label="Bottom Navigation"
  >
    <button
      type="button"
      onClick={() => {
        triggerHaptic();
        onHome();
      }}
      className="p-2 transition-colors hover:text-[var(--n5-ink-main)] text-[var(--n5-ink-muted)]"
      aria-label="Go to Home"
    >
      <Home strokeWidth={2} className="size-6" />
    </button>
    <button
      type="button"
      onClick={() => {
        triggerHaptic();
        onBookNow();
      }}
      aria-label="Book a new appointment"
      className="min-w-[120px] px-6 py-3 text-sm font-bold transition-transform active:scale-95 bg-[var(--n5-ink-main)] text-[var(--n5-ink-inverse)] font-body"
      style={{
        borderRadius: n5.radiusButton,
        boxShadow: n5.shadowSm,
      }}
    >
      Book Now
    </button>
    <div className="relative p-2">
      <button
        type="button"
        className="text-[var(--n5-accent)]"
        aria-label="View Profile (Current Page)"
      >
        <User strokeWidth={2} className="size-6" />
      </button>
      <div
        className="absolute bottom-1 left-1/2 size-1 -translate-x-1/2 rounded-full bg-[var(--n5-accent)]"
      />
    </div>
  </div>
);

/**
 * 6. SKELETON LOADER (For Refresh State)
 */
const ProfileSkeleton = () => (
  <motion.div
    initial={{ opacity: 0 }}
    animate={{ opacity: 1 }}
    exit={{ opacity: 0 }}
    className="space-y-6"
  >
    <div
      className="aspect-[1.58/1] w-full animate-pulse bg-[var(--n5-bg-card)]/50"
      style={{ borderRadius: n5.radiusCard }}
    />
    <div
      className="h-40 w-full animate-pulse bg-[var(--n5-bg-card)]/50"
      style={{ borderRadius: n5.radiusCard }}
    />
    <div className="grid grid-cols-4 gap-3">
      {[1, 2, 3, 4].map(i => (
        <div
          key={i}
          className="size-[4.5rem] animate-pulse bg-[var(--n5-bg-card)]/50"
          style={{ borderRadius: n5.radiusMd }}
        />
      ))}
    </div>
  </motion.div>
);

// --- MAIN PAGE ---

export default function ProfileContent() {
  const router = useRouter();
  const { salonName, salonSlug } = useSalon();
  const [isRefreshing, setIsRefreshing] = useState(false);

  // User data
  const [userName, setUserName] = useState('Guest');
  const [clientPhone, setClientPhone] = useState('');
  const [profileImage, setProfileImage] = useState<string | null>(null);
  const profileImageInputRef = useRef<HTMLInputElement | null>(null);

  // Appointment data
  const [nextAppointment, setNextAppointment] = useState<AppointmentData | null>(null);
  const [nextAppointmentServices, setNextAppointmentServices] = useState<ServiceData[]>([]);
  const [nextAppointmentTech, setNextAppointmentTech] = useState<TechnicianData | null>(null);
  const [appointmentLoading, setAppointmentLoading] = useState(true);

  // Rewards
  const [activePoints, setActivePoints] = useState(0);

  // Invite state
  const [showConfetti, setShowConfetti] = useState(false);

  // Stats (some will be from API in production)
  const userStats = {
    totalVisits: 12,
    memberSince: 'March 2024',
    tier: 'Gold',
    savedAmount: 340,
  };

  // Load client name and phone from cookie
  useEffect(() => {
    const clientNameCookie = document.cookie
      .split('; ')
      .find(row => row.startsWith('client_name='));
    if (clientNameCookie) {
      const name = decodeURIComponent(clientNameCookie.split('=')[1] || '');
      if (name) {
        setUserName(name);
      }
    }

    const clientPhoneCookie = document.cookie
      .split('; ')
      .find(row => row.startsWith('client_phone='));
    if (clientPhoneCookie) {
      const phone = decodeURIComponent(clientPhoneCookie.split('=')[1] || '');
      if (phone) {
        setClientPhone(phone);
      }
    }
  }, []);

  // Fetch next appointment
  useEffect(() => {
    async function fetchNextAppointment() {
      if (!clientPhone) {
        setAppointmentLoading(false);
        return;
      }

      try {
        const response = await fetch(`/api/client/next-appointment?phone=${encodeURIComponent(clientPhone)}`, {
          cache: 'no-store',
        });
        if (response.ok) {
          const data: NextAppointmentResponse = await response.json();
          setNextAppointment(data.data?.appointment || null);
          setNextAppointmentServices(data.data?.services || []);
          setNextAppointmentTech(data.data?.technician || null);
        }
      } catch (error) {
        console.error('Failed to fetch next appointment:', error);
      } finally {
        setAppointmentLoading(false);
      }
    }

    if (clientPhone) {
      fetchNextAppointment();
    } else {
      setAppointmentLoading(false);
    }
  }, [clientPhone]);

  // Fetch rewards/points
  useEffect(() => {
    async function fetchRewards() {
      if (!clientPhone || !salonSlug) {
        return;
      }

      const normalizedPhone = clientPhone.replace(/\D/g, '').replace(/^1(\d{10})$/, '$1');
      if (normalizedPhone.length !== 10) {
        return;
      }

      try {
        const response = await fetch(`/api/rewards?phone=${encodeURIComponent(normalizedPhone)}&salonSlug=${encodeURIComponent(salonSlug)}`);
        if (response.ok) {
          const data = await response.json();
          setActivePoints(data.meta?.activePoints || 0);
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
    const serviceIds = nextAppointmentServices.map(s => s.id).join(',');
    const techId = nextAppointmentTech?.id || 'any';
    const apptDate = new Date(nextAppointment.startTime);
    const dateStr = apptDate.toISOString().split('T')[0];
    const hours = apptDate.getHours();
    const mins = apptDate.getMinutes().toString().padStart(2, '0');
    const timeStr = `${hours}:${mins}`;
    router.push(
      `/change-appointment?serviceIds=${serviceIds}&techId=${techId}&date=${dateStr}&time=${timeStr}&clientPhone=${encodeURIComponent(nextAppointment.clientPhone)}&originalAppointmentId=${encodeURIComponent(nextAppointment.id)}`,
    );
  }, [nextAppointment, nextAppointmentServices, nextAppointmentTech, router]);

  const handleNavigate = useCallback((path: string) => {
    router.push(path);
  }, [router]);

  const handleLogout = useCallback(async () => {
    triggerHaptic();
    await fetch('/api/auth/logout', { method: 'POST' });
    router.push('/book');
  }, [router]);

  const experienceItems: SettingsItem[] = [
    { label: 'Beauty Profile', icon: User, onClick: () => handleNavigate('/preferences') },
    { label: 'Refer a Friend', icon: Share2, badge: '$35 OFF', onClick: () => handleNavigate('/invite') },
    { label: 'Rate Your Experience', icon: Star, badge: '$25 OFF', onClick: () => window.open('https://www.google.com/maps/place/Nail+Salon+No.5', '_blank') },
  ];

  const accountItems: SettingsItem[] = [
    { label: 'Membership Benefits', icon: Sparkles, onClick: () => handleNavigate('/membership') },
    { label: 'Payment Methods', icon: CreditCard, onClick: () => handleNavigate('/payment-methods') },
  ];

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
          className="flex size-10 items-center justify-center bg-[var(--n5-bg-card)] shadow-sm transition-transform active:scale-90 text-[var(--n5-ink-main)]"
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
          className="flex size-10 items-center justify-center transition-transform active:rotate-180 text-[var(--n5-ink-main)]"
        >
          <RefreshCw className={cn('size-5', isRefreshing && 'animate-spin text-[var(--n5-accent)]')} />
        </button>
      </nav>

      {/* Main Scroll Content */}
      <main
        className="mx-auto max-w-lg space-y-2 px-5 pb-28 pt-28"
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
                    profileImage={profileImage}
                    userStats={userStats}
                    activePoints={activePoints}
                    onImageClick={handleProfileImageClick}
                    profileImageInputRef={profileImageInputRef}
                    onProfileImageChange={handleProfileImageChange}
                  />
                  <AppointmentTicket
                    appointment={nextAppointment}
                    services={nextAppointmentServices}
                    technician={nextAppointmentTech}
                    loading={appointmentLoading}
                    onManageBooking={handleManageBooking}
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
                      · Est 2024
                    </p>
                    <p
                      className="mt-1 text-[9px] text-[var(--n5-ink-muted)] font-body"
                    >
                      Version 2.0 (Luxury Build)
                    </p>
                  </div>

                  {/* Sign Out Button */}
                  <button
                    type="button"
                    onClick={handleLogout}
                    aria-label="Sign Out"
                    className="mt-6 flex w-full items-center justify-center space-x-2 py-4 text-sm font-bold shadow-sm transition-transform active:scale-[0.98] bg-[var(--n5-error)]/10 text-[var(--n5-error)] font-body"
                    style={{ borderRadius: n5.radiusMd }}
                  >
                    <LogOut className="size-4" />
                    <span>Sign Out</span>
                  </button>
                </motion.div>
              )}
        </AnimatePresence>
      </main>

      <FloatingDock
        onBookNow={() => handleNavigate('/book')}
        onHome={() => handleNavigate('/book')}
      />

      {/* Confetti Popup */}
      <ConfettiPopup
        isOpen={showConfetti}
        onClose={() => setShowConfetti(false)}
        title="You just gifted your friend a FREE manicure!"
        message="They'll receive a text with your referral. When they book, you both win!"
        emoji="🎊"
        autoDismissMs={4000}
      />
    </div>
  );
}
