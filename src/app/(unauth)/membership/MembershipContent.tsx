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
  Award,
  Calendar,
  ChevronRight,
  Crown,
  Gift,
  Home,
  Lock,
  Palette,
  RefreshCw,
  Sparkles,
  Star,
  User,
  Zap,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import React, { useCallback, useEffect, useState } from 'react';

import { useSalon } from '@/providers/SalonProvider';
import { n5 } from '@/theme';
import { cn } from '@/utils/Helpers';

// --- Types ---

type TierKey = 'silver' | 'gold' | 'platinum' | 'vip';

type MembershipTier = {
  key: TierKey;
  name: string;
  minVisits: number;
  maxVisits: number | null;
  pointsMultiplier: number;
  icon: React.ElementType;
  colorClass: string;
  bgClass: string;
};

type MemberPerk = {
  id: string;
  title: string;
  description: string;
  icon: React.ElementType;
  tier: TierKey;
  frequency?: string;
};

// --- Data ---

const TIERS: MembershipTier[] = [
  {
    key: 'silver',
    name: 'Silver',
    minVisits: 0,
    maxVisits: 10,
    pointsMultiplier: 3,
    icon: Star,
    colorClass: 'text-[#9CA3AF]',
    bgClass: 'bg-[#F3F4F6]',
  },
  {
    key: 'gold',
    name: 'Gold',
    minVisits: 10,
    maxVisits: 25,
    pointsMultiplier: 5,
    icon: Award,
    colorClass: 'text-[var(--n5-accent)]',
    bgClass: 'bg-[var(--n5-accent-soft)]',
  },
  {
    key: 'platinum',
    name: 'Platinum',
    minVisits: 25,
    maxVisits: 50,
    pointsMultiplier: 7,
    icon: Sparkles,
    colorClass: 'text-[#7B4EA3]',
    bgClass: 'bg-[#F3E5F5]',
  },
  {
    key: 'vip',
    name: 'VIP',
    minVisits: 50,
    maxVisits: null,
    pointsMultiplier: 10,
    icon: Crown,
    colorClass: 'text-[#D6A249]',
    bgClass: 'bg-gradient-to-r from-[#FFF8E1] to-[#FFE0B2]',
  },
];

const PERKS: MemberPerk[] = [
  // Silver perks
  { id: 'silver-1', title: '3% Points Back', description: 'Earn points on all services', icon: Sparkles, tier: 'silver' },
  { id: 'silver-2', title: 'Seasonal Promos', description: 'Access to exclusive seasonal offers', icon: Gift, tier: 'silver' },
  { id: 'silver-3', title: 'Free Cuticle Oil', description: 'Take-home care product', icon: Gift, tier: 'silver', frequency: '1x per year' },

  // Gold perks
  { id: 'gold-1', title: '5% Points Back', description: 'Increased earn rate on all services', icon: Sparkles, tier: 'gold' },
  { id: 'gold-2', title: 'Priority Booking', description: 'First access during busy seasons', icon: Calendar, tier: 'gold' },
  { id: 'gold-3', title: 'Free Nail Repair', description: 'Complimentary fix for chips or breaks', icon: Zap, tier: 'gold', frequency: '1x per month' },
  { id: 'gold-4', title: 'Birthday French Add-on', description: 'Free French tips in your birthday month', icon: Gift, tier: 'gold', frequency: 'Birthday month' },

  // Platinum perks
  { id: 'plat-1', title: '7% Points Back', description: 'Premium earn rate on all services', icon: Sparkles, tier: 'platinum' },
  { id: 'plat-2', title: 'Free Gel Polish Change', description: 'Swap your color anytime', icon: Palette, tier: 'platinum', frequency: '1x per month' },
  { id: 'plat-3', title: '10% Off Nail Art', description: 'Discount on all nail art services', icon: Palette, tier: 'platinum' },
  { id: 'plat-4', title: 'VIP Queue', description: 'Jump ahead for last-minute bookings', icon: Zap, tier: 'platinum' },

  // VIP perks
  { id: 'vip-1', title: '10% Points Back', description: 'Maximum earn rate on all services', icon: Sparkles, tier: 'vip' },
  { id: 'vip-2', title: 'Complimentary Upgrades', description: 'Free upgrades on select services', icon: Crown, tier: 'vip' },
  { id: 'vip-3', title: 'Exclusive Events', description: 'Invitations to VIP-only salon events', icon: Star, tier: 'vip' },
  { id: 'vip-4', title: 'Personal Concierge', description: 'Dedicated booking assistance', icon: User, tier: 'vip' },
];

// --- Helper Functions ---

const triggerHaptic = () => {
  if (typeof navigator !== 'undefined' && navigator.vibrate) {
    navigator.vibrate(10);
  }
};

function getTierForVisits(visits: number): MembershipTier {
  for (let i = TIERS.length - 1; i >= 0; i--) {
    if (visits >= TIERS[i]!.minVisits) {
      return TIERS[i]!;
    }
  }
  return TIERS[0]!;
}

function getNextTier(currentTier: TierKey): MembershipTier | null {
  const currentIndex = TIERS.findIndex(t => t.key === currentTier);
  if (currentIndex < TIERS.length - 1) {
    return TIERS[currentIndex + 1]!;
  }
  return null;
}

function isTierUnlocked(perkTier: TierKey, currentTier: TierKey): boolean {
  const tierOrder: TierKey[] = ['silver', 'gold', 'platinum', 'vip'];
  return tierOrder.indexOf(perkTier) <= tierOrder.indexOf(currentTier);
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

/**
 * Tier Hero Card - Displays current membership status with parallax effect
 */
const TierHeroCard = ({
  tier,
  visits,
  pointsEarned,
  savedAmount,
  nextTier,
}: {
  tier: MembershipTier;
  visits: number;
  pointsEarned: number;
  savedAmount: number;
  nextTier: MembershipTier | null;
}) => {
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const shouldReduceMotion = useReducedMotion();

  const visitsToNext = nextTier ? nextTier.minVisits - visits : 0;
  const progressPercent = nextTier
    ? Math.min(100, ((visits - tier.minVisits) / (nextTier.minVisits - tier.minVisits)) * 100)
    : 100;

  // Gyroscope Logic for Mobile
  useEffect(() => {
    if (typeof window === 'undefined' || shouldReduceMotion) return;

    const handleOrientation = (e: DeviceOrientationEvent) => {
      const gamma = e.gamma;
      const beta = e.beta;
      if (gamma === null || beta === null) return;

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

  function handleMouseMove(event: React.MouseEvent<HTMLDivElement>) {
    if (shouldReduceMotion) return;
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

  const TierIcon = tier.icon;

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
      aria-label={`${tier.name} Member Card`}
      role="region"
    >
      <div
        className="absolute inset-0 border-[1.5px] bg-[var(--n5-bg-card)] transition-transform duration-500 hover:scale-[1.02]"
        style={{
          borderRadius: n5.radiusCard,
          boxShadow: n5.shadowLg,
          borderColor: 'var(--n5-border)',
        }}
      >
        {/* Animated Mesh Background */}
        <div className="absolute inset-0 overflow-hidden" style={{ borderRadius: n5.radiusCard }}>
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

        {/* Glass Surface */}
        <div
          className="absolute inset-0 bg-[var(--n5-bg-card)]/30 backdrop-blur-[20px]"
          style={{ borderRadius: n5.radiusCard }}
        />

        {/* Content Layer */}
        <div className="relative flex h-full flex-col justify-between text-[var(--n5-ink-main)]" style={{ padding: n5.spaceLg }}>
          {/* Top Row */}
          <div className="flex items-start justify-between">
            <div className="flex items-center space-x-2">
              <TierIcon className={cn('size-5', tier.colorClass)} />
              <span className="text-[10px] font-bold uppercase tracking-[0.2em] opacity-90 font-body">
                {tier.name} Member
              </span>
            </div>
            <div
              className={cn(
                'flex items-center space-x-1 px-3 py-1 border shadow-sm backdrop-blur-md',
                tier.bgClass,
              )}
              style={{ borderRadius: n5.radiusPill, borderColor: 'var(--n5-border)' }}
            >
              <span className="text-[10px] font-bold font-body">{tier.pointsMultiplier}% Back</span>
            </div>
          </div>

          {/* Middle Row - Stats */}
          <div className="grid grid-cols-3 gap-4">
            <div className="flex flex-col">
              <span className="text-[9px] uppercase tracking-widest text-[var(--n5-ink-main)] opacity-60 font-body">
                Visits
              </span>
              <span className="text-2xl font-bold tabular-nums leading-none font-heading text-[var(--n5-ink-main)]">
                {visits}
              </span>
            </div>
            <div className="flex flex-col">
              <span className="text-[9px] uppercase tracking-widest text-[var(--n5-ink-main)] opacity-60 font-body">
                Points
              </span>
              <span className="text-2xl font-bold tabular-nums leading-none font-heading text-[var(--n5-accent)]">
                {pointsEarned >= 1000 ? `${(pointsEarned / 1000).toFixed(1)}k` : pointsEarned}
              </span>
            </div>
            <div className="flex flex-col">
              <span className="text-[9px] uppercase tracking-widest text-[var(--n5-ink-main)] opacity-60 font-body">
                Saved
              </span>
              <span className="text-2xl font-bold tabular-nums leading-none font-heading text-[var(--n5-success)]">
                ${savedAmount}
              </span>
            </div>
          </div>

          {/* Bottom Row - Progress */}
          <div className="space-y-2" style={{ borderTopWidth: 1, borderColor: 'var(--n5-border-muted)', paddingTop: n5.spaceMd }}>
            <div className="flex items-center justify-between text-[10px] font-body">
              <span className="text-[var(--n5-ink-muted)]">
                {nextTier ? `${visitsToNext} visits to ${nextTier.name}` : 'Maximum tier reached!'}
              </span>
              <span className="font-bold text-[var(--n5-accent)]">{Math.round(progressPercent)}%</span>
            </div>
            <div
              className="h-1.5 w-full overflow-hidden bg-[var(--n5-accent-soft)]"
              style={{ borderRadius: n5.radiusPill }}
            >
              <motion.div
                initial={{ width: 0 }}
                animate={{ width: `${progressPercent}%` }}
                transition={{ duration: 1.5, ease: 'easeOut' }}
                className="h-full bg-[var(--n5-accent)]"
              />
            </div>
          </div>
        </div>
      </div>
    </motion.div>
  );
};

/**
 * Tier Progress Timeline - Shows all tiers with current highlighted
 */
const TierProgressTimeline = ({ currentTier, visits }: { currentTier: MembershipTier; visits: number }) => {
  return (
    <div className="mt-8">
      <h3 className="mb-4 px-1 text-xs font-bold uppercase tracking-widest text-[var(--n5-ink-muted)] font-heading">
        Membership Ladder
      </h3>
      <div
        className="overflow-hidden bg-[var(--n5-bg-card)]"
        style={{ borderRadius: n5.radiusCard, boxShadow: n5.shadowSm }}
      >
        {TIERS.map((tier, index) => {
          const isCurrentTier = tier.key === currentTier.key;
          const isUnlocked = visits >= tier.minVisits;
          const TierIcon = tier.icon;

          return (
            <div
              key={tier.key}
              className={cn(
                'relative flex items-center p-4 transition-colors',
                isCurrentTier && 'bg-[var(--n5-accent-soft)]',
                !isCurrentTier && isUnlocked && 'bg-[var(--n5-bg-surface)]',
                !isUnlocked && 'opacity-50',
              )}
              style={{
                borderBottomWidth: index < TIERS.length - 1 ? 1 : 0,
                borderColor: 'var(--n5-border-muted)',
              }}
            >
              {/* Left icon */}
              <div
                className={cn(
                  'flex size-10 items-center justify-center',
                  tier.bgClass,
                )}
                style={{ borderRadius: n5.radiusMd }}
              >
                <TierIcon className={cn('size-5', tier.colorClass)} strokeWidth={2} />
              </div>

              {/* Content */}
              <div className="ml-3 flex-1">
                <div className="flex items-center space-x-2">
                  <span className="text-[15px] font-semibold text-[var(--n5-ink-main)] font-body">
                    {tier.name}
                  </span>
                  {isCurrentTier && (
                    <span
                      className="px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider bg-[var(--n5-accent)] text-[var(--n5-ink-inverse)] font-body"
                      style={{ borderRadius: n5.radiusPill }}
                    >
                      Current
                    </span>
                  )}
                </div>
                <span className="text-[12px] text-[var(--n5-ink-muted)] font-body">
                  {tier.minVisits}
                  {tier.maxVisits ? `–${tier.maxVisits}` : '+'} visits · {tier.pointsMultiplier}% points back
                </span>
              </div>

              {/* Right indicator */}
              {!isUnlocked && <Lock className="size-4 text-[var(--n5-ink-muted)]" />}
              {isUnlocked && !isCurrentTier && (
                <div className="flex size-5 items-center justify-center rounded-full bg-[var(--n5-success)]">
                  <svg className="size-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};

/**
 * Perks List - Grouped perks with lock states
 */
const PerksList = ({ currentTier }: { currentTier: MembershipTier }) => {
  const groupedPerks = TIERS.map(tier => ({
    tier,
    perks: PERKS.filter(perk => perk.tier === tier.key),
  }));

  return (
    <div className="mt-8 space-y-6">
      <h3 className="px-1 text-xs font-bold uppercase tracking-widest text-[var(--n5-ink-muted)] font-heading">
        Your Member Perks
      </h3>

      {groupedPerks.map(({ tier, perks }) => {
        const isUnlocked = isTierUnlocked(tier.key, currentTier.key);
        const TierIcon = tier.icon;

        return (
          <div key={tier.key}>
            {/* Tier Header */}
            <div className="mb-2 flex items-center space-x-2 px-1">
              <TierIcon className={cn('size-4', tier.colorClass)} />
              <span className="text-[13px] font-semibold text-[var(--n5-ink-main)] font-body">
                {tier.name} Perks
              </span>
              {!isUnlocked && (
                <span className="text-[10px] text-[var(--n5-ink-muted)] font-body">
                  · Unlocks at {tier.minVisits} visits
                </span>
              )}
            </div>

            {/* Perks Cards */}
            <div
              className={cn('overflow-hidden bg-[var(--n5-bg-card)]', !isUnlocked && 'opacity-60')}
              style={{ borderRadius: n5.radiusCard, boxShadow: n5.shadowSm }}
            >
              {perks.map((perk, index) => {
                const PerkIcon = perk.icon;
                return (
                  <div
                    key={perk.id}
                    className={cn(
                      'relative flex items-center p-4 transition-colors',
                      isUnlocked && 'hover:bg-[var(--n5-bg-surface)]',
                    )}
                    style={{
                      borderBottomWidth: index < perks.length - 1 ? 1 : 0,
                      borderColor: 'var(--n5-border-muted)',
                    }}
                  >
                    {/* Icon */}
                    <div
                      className={cn(
                        'flex size-10 items-center justify-center',
                        isUnlocked ? 'bg-[var(--n5-bg-surface)] text-[var(--n5-accent)]' : 'bg-[var(--n5-bg-selected)] text-[var(--n5-ink-muted)]',
                      )}
                      style={{ borderRadius: n5.radiusSm }}
                    >
                      <PerkIcon size={18} strokeWidth={2} />
                    </div>

                    {/* Content */}
                    <div className="ml-3 flex-1">
                      <span className="text-[15px] font-medium text-[var(--n5-ink-main)] font-body">
                        {perk.title}
                      </span>
                      <p className="text-[12px] text-[var(--n5-ink-muted)] font-body">
                        {perk.description}
                      </p>
                    </div>

                    {/* Frequency Badge / Lock */}
                    {isUnlocked ? (
                      perk.frequency && (
                        <span
                          className="px-2 py-1 text-[10px] font-bold bg-[var(--n5-success)]/10 text-[var(--n5-success)] font-body"
                          style={{ borderRadius: n5.radiusPill }}
                        >
                          {perk.frequency}
                        </span>
                      )
                    ) : (
                      <Lock className="size-4 text-[var(--n5-ink-muted)]" />
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
};

/**
 * Floating Dock Navigation
 */
const FloatingDock = ({ onBookNow, onHome, onProfile }: { onBookNow: () => void; onHome: () => void; onProfile: () => void }) => (
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
    <button
      type="button"
      onClick={() => {
        triggerHaptic();
        onProfile();
      }}
      className="p-2 transition-colors hover:text-[var(--n5-ink-main)] text-[var(--n5-ink-muted)]"
      aria-label="Go to Profile"
    >
      <User strokeWidth={2} className="size-6" />
    </button>
  </div>
);

/**
 * Skeleton Loader
 */
const MembershipSkeleton = () => (
  <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-6">
    <div className="aspect-[1.58/1] w-full animate-pulse bg-[var(--n5-bg-card)]/50" style={{ borderRadius: n5.radiusCard }} />
    <div className="h-48 w-full animate-pulse bg-[var(--n5-bg-card)]/50" style={{ borderRadius: n5.radiusCard }} />
    <div className="h-64 w-full animate-pulse bg-[var(--n5-bg-card)]/50" style={{ borderRadius: n5.radiusCard }} />
  </motion.div>
);

// --- MAIN PAGE ---

export default function MembershipContent() {
  const router = useRouter();
  const { salonName, salonSlug } = useSalon();
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [loading, setLoading] = useState(true);

  // User data (in production, would come from API)
  const [visits] = useState(12);
  const [pointsEarned, setPointsEarned] = useState(2400);
  const [savedAmount] = useState(340);
  const [clientPhone, setClientPhone] = useState('');

  // Load client phone from cookie
  useEffect(() => {
    const clientPhoneCookie = document.cookie.split('; ').find(row => row.startsWith('client_phone='));
    if (clientPhoneCookie) {
      const phone = decodeURIComponent(clientPhoneCookie.split('=')[1] || '');
      if (phone) {
        setClientPhone(phone);
      }
    }
  }, []);

  // Fetch membership data
  useEffect(() => {
    async function fetchMembershipData() {
      if (!clientPhone || !salonSlug) {
        setLoading(false);
        return;
      }

      const normalizedPhone = clientPhone.replace(/\D/g, '').replace(/^1(\d{10})$/, '$1');
      if (normalizedPhone.length !== 10) {
        setLoading(false);
        return;
      }

      try {
        // Fetch rewards data which includes visit stats
        const response = await fetch(
          `/api/rewards?phone=${encodeURIComponent(normalizedPhone)}&salonSlug=${encodeURIComponent(salonSlug)}`,
        );
        if (response.ok) {
          const data = await response.json();
          if (data.meta?.activePoints !== undefined) {
            setPointsEarned(data.meta.activePoints);
          }
          // In a real app, visits and savedAmount would come from the API
        }
      } catch (error) {
        console.error('Failed to fetch membership data:', error);
      } finally {
        setLoading(false);
      }
    }

    if (clientPhone && salonSlug) {
      fetchMembershipData();
    } else {
      // Use demo data after short delay to simulate loading
      setTimeout(() => setLoading(false), 500);
    }
  }, [clientPhone, salonSlug]);

  const currentTier = getTierForVisits(visits);
  const nextTier = getNextTier(currentTier.key);

  const handleRefresh = useCallback(() => {
    triggerHaptic();
    setIsRefreshing(true);
    setTimeout(() => {
      setIsRefreshing(false);
      triggerHaptic();
    }, 1500);
  }, []);

  const handleBack = useCallback(() => {
    triggerHaptic();
    router.back();
  }, [router]);

  const handleNavigate = useCallback(
    (path: string) => {
      router.push(path);
    },
    [router],
  );

  return (
    <div className="min-h-screen bg-[var(--n5-bg-page)]" style={{ fontFamily: n5.fontBody }}>
      {/* Navbar */}
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
        <span className="font-heading text-lg font-semibold tracking-tight text-[var(--n5-ink-main)]">
          Membership
        </span>
        <button
          type="button"
          onClick={handleRefresh}
          aria-label="Refresh Membership"
          className="flex size-10 items-center justify-center transition-transform active:rotate-180 text-[var(--n5-ink-main)]"
        >
          <RefreshCw className={cn('size-5', isRefreshing && 'animate-spin text-[var(--n5-accent)]')} />
        </button>
      </nav>

      {/* Main Scroll Content */}
      <main className="mx-auto max-w-lg space-y-2 px-5 pb-28 pt-28">
        <AnimatePresence mode="wait">
          {loading || isRefreshing ? (
            <MembershipSkeleton key="skeleton" />
          ) : (
            <motion.div key="content" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
              <TierHeroCard
                tier={currentTier}
                visits={visits}
                pointsEarned={pointsEarned}
                savedAmount={savedAmount}
                nextTier={nextTier}
              />

              <TierProgressTimeline currentTier={currentTier} visits={visits} />

              <PerksList currentTier={currentTier} />

              {/* How Points Work Link */}
              <motion.button
                type="button"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.3 }}
                onClick={() => handleNavigate('/rewards')}
                className="mt-8 flex w-full items-center justify-center space-x-2 py-4 text-sm font-semibold transition-colors bg-[var(--n5-bg-card)] text-[var(--n5-ink-main)] font-body hover:bg-[var(--n5-bg-surface)]"
                style={{ borderRadius: n5.radiusMd, boxShadow: n5.shadowSm }}
              >
                <Gift className="size-4 text-[var(--n5-accent)]" />
                <span>View Rewards & Points</span>
                <ChevronRight className="size-4 text-[var(--n5-ink-muted)]" />
              </motion.button>

              {/* Footer */}
              <div className="pt-10 text-center opacity-40">
                <p className="font-heading text-[10px] italic text-[var(--n5-ink-main)]">
                  {salonName || 'Nail Salon No.5'} · Est 2024
                </p>
                <p className="mt-1 text-[9px] text-[var(--n5-ink-muted)] font-body">
                  Membership benefits subject to availability
                </p>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      <FloatingDock
        onBookNow={() => handleNavigate('/book/service')}
        onHome={() => handleNavigate('/book/service')}
        onProfile={() => handleNavigate('/profile')}
      />
    </div>
  );
}
