'use client';

import { AnimatePresence, motion } from 'framer-motion';
import {
  Check,
  ChevronLeft,
  Crown,
  DollarSign,
  Droplets,
  FileText,
  Gem,
  Gift,
  Lock,
  Palette,
  Sparkles,
  Star,
} from 'lucide-react';
import Image from 'next/image';
import { useParams, useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import type { LucideIcon } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import RedeemSheet from '@/components/RedeemSheet';
import { useSalon } from '@/providers/SalonProvider';
import { themeVars } from '@/theme';

// --- Premium Color Palette ---
const colors = {
  espresso: '#3F2B24', // Primary text - warm brown
  taupe: '#8A7E78', // Secondary text
  gold: '#D6A249', // Accent gold
  ivory: '#FDF7F0', // Background
  cream: '#FFF8E1', // Soft cream
  peach: '#FFE0B2', // Soft peach
};

// --- Types ---
interface Reward {
  id: string;
  title: string;
  subtitle: string;
  points: number;
  tier: string;
  image?: string;
  icon?: LucideIcon;
  gradient?: string;
}

// --- Data: The Full, Complete Reward Ladder (13 Items) ---
const REWARDS: Reward[] = [
  // TIER 1 - 2,500 pts (Small Treats)
  {
    id: '1',
    title: '$5 OFF',
    subtitle: 'Any Service',
    points: 2500,
    tier: 'Tier 1 — Small Treats',
    icon: DollarSign,
    gradient: 'from-emerald-100/80 via-emerald-50/60 to-teal-50/40',
  },
  {
    id: '2',
    title: 'Free Cuticle Oil',
    subtitle: 'Take-home care',
    points: 2500,
    tier: 'Tier 1 — Small Treats',
    icon: Droplets,
    gradient: 'from-amber-100/80 via-orange-50/60 to-yellow-50/40',
  },
  {
    id: '3',
    title: 'Nail File + Buff',
    subtitle: 'Take-home kit',
    points: 2500,
    tier: 'Tier 1 — Small Treats',
    icon: FileText,
    gradient: 'from-pink-100/80 via-rose-50/60 to-pink-50/40',
  },

  // TIER 2 - 4,750 pts (Medium Value)
  {
    id: '4',
    title: '$10 OFF',
    subtitle: 'Any Service',
    points: 4750,
    tier: 'Tier 2 — Medium Value',
    icon: DollarSign,
    gradient: 'from-emerald-200/80 via-emerald-100/60 to-teal-100/40',
  },
  {
    id: '5',
    title: 'Free Gel Removal',
    subtitle: 'Add-on service',
    points: 4750,
    tier: 'Tier 2 — Medium Value',
    icon: Sparkles,
    gradient: 'from-violet-100/80 via-purple-50/60 to-fuchsia-50/40',
  },
  {
    id: '6',
    title: 'Free Basic Nail Art',
    subtitle: '2 fingers (Simple)',
    points: 4750,
    tier: 'Tier 2 — Medium Value',
    icon: Palette,
    gradient: 'from-indigo-100/80 via-blue-50/60 to-sky-50/40',
  },

  // TIER 3 - 8,750 pts (High Value)
  {
    id: '7',
    title: '$20 OFF',
    subtitle: 'Any Service',
    points: 8750,
    tier: 'Tier 3 — High Value',
    icon: DollarSign,
    gradient: 'from-emerald-300/80 via-emerald-200/60 to-teal-100/40',
  },
  {
    id: '8',
    title: 'French Tip Add-On',
    subtitle: 'Classic or colored tips',
    points: 8750,
    tier: 'Tier 3 — High Value',
    image: '/assets/images/biab-french.jpg',
  },
  {
    id: '9',
    title: 'Gel Polish Change',
    subtitle: 'Color refresh only',
    points: 8750,
    tier: 'Tier 3 — High Value',
    icon: Palette,
    gradient: 'from-rose-200/80 via-pink-100/60 to-red-50/40',
  },

  // TIER 4 - 20,000 pts (Premium)
  {
    id: '10',
    title: '$50 OFF',
    subtitle: 'Service Credit',
    points: 20000,
    tier: 'Tier 4 — Premium',
    icon: Gift,
    gradient: 'from-amber-200/80 via-yellow-100/60 to-orange-100/40',
  },
  {
    id: '11',
    title: 'Free Pedicure',
    subtitle: 'Classic Pedicure',
    points: 20000,
    tier: 'Tier 4 — Premium',
    icon: Sparkles,
    gradient: 'from-cyan-100/80 via-sky-50/60 to-blue-50/40',
  },

  // TIER 5 - 25,000 pts (Luxury Hero)
  {
    id: '12',
    title: 'Free Gel Manicure',
    subtitle: 'Full Service',
    points: 25000,
    tier: 'Tier 5 — Luxury Hero',
    image: '/assets/images/biab-medium.webp',
  },

  // TIER 6 - 38,500 pts (Top Value)
  {
    id: '13',
    title: '$100 Credit',
    subtitle: 'The Ultimate Reward',
    points: 38500,
    tier: 'Tier 6 — Top Status',
    icon: Gem,
    gradient: 'from-amber-300/80 via-yellow-200/60 to-amber-100/40',
  },
];

// Default appointment context (would come from API in real app)
const DEFAULT_APPOINTMENT = {
  service: 'BIAB Medium',
  tech: 'Tiffany',
  date: 'Thu, Dec 18',
  time: '2:00 PM',
  image: '/assets/images/biab-medium.webp',
};

// Default values - in a real app these would come from API/context
const DEFAULT_POINTS = 5200;

export default function RewardsPage() {
  // These would typically come from an API or context
  const currentPoints = DEFAULT_POINTS;
  const rewards = REWARDS;
  const appointment = DEFAULT_APPOINTMENT;
  const router = useRouter();
  const params = useParams();
  const { salonName } = useSalon();
  const locale = (params?.locale as string) || 'en';
  const t = useTranslations('Rewards');
  const [selectedReward, setSelectedReward] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);
  const [isScrolled, setIsScrolled] = useState(false);
  const [isRedeemSheetOpen, setIsRedeemSheetOpen] = useState(false);

  useEffect(() => {
    setMounted(true);

    const handleScroll = () => {
      setIsScrolled(window.scrollY > 10);
    };

    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  const handleBack = () => {
    router.back();
  };

  // Group rewards by tier
  const groupedRewards = useMemo(() => {
    const groups: Record<string, Reward[]> = {};
    for (const reward of rewards) {
      if (!groups[reward.tier]) groups[reward.tier] = [];
      groups[reward.tier]!.push(reward);
    }
    return Object.entries(groups)
      .sort(([a], [b]) => {
        const numA = Number.parseInt(a.match(/Tier (\d+)/)?.[1] || '0', 10);
        const numB = Number.parseInt(b.match(/Tier (\d+)/)?.[1] || '0', 10);
        return numA - numB;
      })
      .map(([tier, tierRewards]) => [
        tier,
        tierRewards.sort((x, y) => x.points - y.points),
      ] as [string, Reward[]]);
  }, [rewards]);

  // Logic to find next goal
  const nextReward = rewards.find(r => r.points > currentPoints) || rewards[rewards.length - 1];
  const progressPercent = nextReward ? Math.min(100, (currentPoints / nextReward.points) * 100) : 100;
  const pointsRemaining = nextReward ? nextReward.points - currentPoints : 0;

  const handleApplyReward = () => {
    if (!selectedReward) return;
    setIsRedeemSheetOpen(true);
  };

  const handleRedeemConfirm = () => {
    // After confetti animation, navigate back to profile
    router.push(`/${locale}/profile`);
  };

  // Get the selected reward object for the sheet
  const selectedRewardObj = rewards.find(r => r.id === selectedReward);

  // Get min points for a tier (for headline display)
  const getTierMinPoints = (tierRewards: Reward[]) => {
    return Math.min(...tierRewards.map(r => r.points));
  };

  return (
    <div
      className="relative min-h-screen font-sans selection:bg-[#D6A249]/30"
      style={{ backgroundColor: colors.ivory }}
    >
      {/* --- Premium Scroll-Reactive Header (iOS Glassmorphism) --- */}
      <header
        className={`
          fixed top-0 left-0 right-0 z-40
          flex items-center justify-between
          px-6 py-4
          transition-all duration-300 ease-in-out
          ${isScrolled
            ? 'bg-[#FDF7F0]/85 backdrop-blur-xl border-b border-white/40 shadow-sm'
            : 'bg-transparent border-b border-transparent'
          }
        `}
      >
        {/* Back Button */}
        <button
          type="button"
          onClick={handleBack}
          className={`
            flex items-center justify-center w-10 h-10 rounded-full
            transition-all duration-200 active:scale-90
            ${isScrolled
              ? 'bg-transparent'
              : 'bg-white/60 backdrop-blur-md shadow-sm'
            }
          `}
          style={{ color: colors.espresso }}
        >
          <ChevronLeft className="w-6 h-6" strokeWidth={2.5} />
        </button>

        {/* Title */}
        <div
          className={`
            absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2
            text-center transition-opacity duration-300
            ${isScrolled ? 'opacity-100' : 'opacity-0'}
          `}
        >
          <h1
            className="text-[17px] font-bold tracking-tight"
            style={{ color: colors.espresso }}
          >
            {salonName || t('title')}
          </h1>
        </div>

        {/* Spacer */}
        <div className="w-10" />
      </header>

      {/* --- Main Content --- */}
      <main className="relative z-10 pt-20 pb-40 px-5 max-w-lg mx-auto space-y-8">
        {/* --- Hero: Premium Wallet-Style Balance Card --- */}
        <motion.div
          initial={{ y: 20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
          className="relative p-1"
        >
          <div
            className="relative w-full overflow-hidden rounded-[2rem] bg-white"
            style={{
              aspectRatio: '1.7 / 1',
              boxShadow: '0 25px 50px -12px rgba(214, 162, 73, 0.25)',
            }}
          >
            {/* Pearlescent Mesh Gradient Background */}
            <div
              className="absolute rounded-full blur-[80px] opacity-60"
              style={{
                top: '-50%',
                left: '-20%',
                width: '80%',
                height: '100%',
                backgroundColor: colors.ivory,
              }}
            />
            <div
              className="absolute rounded-full blur-[60px] opacity-70"
              style={{
                bottom: '-20%',
                right: '-10%',
                width: '60%',
                height: '80%',
                backgroundColor: colors.cream,
              }}
            />
            <div
              className="absolute rounded-full blur-[70px] opacity-20"
              style={{
                top: '20%',
                right: '10%',
                width: '30%',
                height: '50%',
                backgroundColor: colors.peach,
              }}
            />

            {/* Watermark Crown */}
            <Crown
              className="absolute -right-8 -top-8 w-64 h-64 rotate-12 opacity-[0.03]"
              style={{ color: colors.gold }}
              strokeWidth={1}
            />

            {/* Content */}
            <div className="relative h-full flex flex-col justify-between p-6">
              {/* Header Row */}
              <div className="flex justify-between items-start">
                <div className="flex flex-col gap-1">
                  <span
                    className="text-[10px] font-bold tracking-[0.2em] uppercase"
                    style={{ color: colors.taupe }}
                  >
                    {t('available_balance')}
                  </span>
                  <div className="flex items-center gap-2">
                    <div
                      className="h-1.5 w-1.5 rounded-full"
                      style={{ backgroundColor: colors.gold }}
                    />
                    <span
                      className="text-xs font-medium tracking-wide"
                      style={{ color: colors.gold }}
                    >
                      Gold Member
                    </span>
                  </div>
                </div>

                {/* Crown Badge */}
                <div
                  className="w-10 h-10 rounded-full flex items-center justify-center backdrop-blur-md border shadow-sm"
                  style={{
                    backgroundColor: 'rgba(255, 255, 255, 0.5)',
                    borderColor: 'rgba(255, 255, 255, 0.6)',
                  }}
                >
                  <Crown
                    className="w-5 h-5"
                    style={{ color: colors.gold }}
                    fill="currentColor"
                    fillOpacity={0.2}
                  />
                </div>
              </div>

              {/* Big Balance Number */}
              <div className="flex items-baseline gap-1 mt-2">
                <span
                  className="text-6xl font-light tracking-tighter"
                  style={{ color: colors.espresso }}
                >
                  {currentPoints.toLocaleString()}
                </span>
                <span
                  className="text-lg font-medium mb-1.5"
                  style={{ color: colors.taupe }}
                >
                  {t('pts')}
                </span>
              </div>

              {/* Progress Section */}
              <div className="flex flex-col gap-3 mt-auto">
                {/* Text details */}
                <div
                  className="flex justify-between items-end text-xs font-medium"
                  style={{ color: colors.taupe }}
                >
                  <span>
                    {t('next_reward')}:{' '}
                    <strong style={{ color: colors.espresso }}>
                      {nextReward?.points.toLocaleString()}
                    </strong>
                  </span>
                  <span style={{ color: colors.gold }}>
                    {t('points_away', {
                      points: pointsRemaining.toLocaleString(),
                      reward: nextReward?.title,
                    })}
                  </span>
                </div>

                {/* Progress Bar */}
                <div
                  className="h-2.5 w-full rounded-full overflow-hidden"
                  style={{
                    backgroundColor: '#F5EFE9',
                    boxShadow: 'inset 0 1px 2px rgba(0,0,0,0.06)',
                  }}
                >
                  <motion.div
                    initial={{ width: 0 }}
                    animate={{ width: mounted ? `${progressPercent}%` : '0%' }}
                    transition={{ duration: 1.5, ease: 'easeOut' }}
                    className="h-full rounded-full"
                    style={{
                      background: `linear-gradient(to right, ${colors.gold}, #FBC02D)`,
                      boxShadow: '0 0 10px rgba(214, 162, 73, 0.4)',
                    }}
                  />
                </div>
              </div>
            </div>
          </div>
        </motion.div>

        {/* --- Tiered Rewards Sections --- */}
        {groupedRewards.map(([tierName, tierRewards], tierIndex) => {
          const tierMinPoints = getTierMinPoints(tierRewards);

          return (
            <motion.section
              key={tierName}
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{
                duration: 0.5,
                delay: 0.2 + tierIndex * 0.1,
                ease: [0.16, 1, 0.3, 1],
              }}
            >
              {/* Tier Headline */}
              <div className="mb-4 flex items-center justify-between px-1">
                <h2
                  className="font-serif text-xl tracking-tight"
                  style={{ color: colors.espresso }}
                >
                  {tierName}
                </h2>
                <span
                  className="text-[10px] font-bold tracking-widest uppercase"
                  style={{ color: colors.taupe }}
                >
                  {tierMinPoints.toLocaleString()} {t('pts')}
                </span>
              </div>

              {/* Rewards Grid - iOS Widget Style */}
              <div className="grid grid-cols-2 gap-4">
                {tierRewards.map((reward, cardIndex) => {
                  const isLocked = currentPoints < reward.points;
                  const isSelected = selectedReward === reward.id;
                  const IconComponent = reward.icon || Star;

                  // --- LOCKED STATE: Frosted Glass Tease ---
                  if (isLocked) {
                    return (
                      <motion.div
                        key={reward.id}
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{
                          duration: 0.4,
                          delay: 0.3 + tierIndex * 0.1 + cardIndex * 0.05,
                        }}
                        className="group relative w-full rounded-[1.75rem] overflow-hidden cursor-pointer"
                        style={{
                          aspectRatio: '4 / 5',
                          boxShadow: '0 4px 20px -10px rgba(0,0,0,0.08)',
                        }}
                      >
                        {/* Background - Image or Gradient */}
                        {reward.image ? (
                          <Image
                            src={reward.image}
                            alt={reward.title}
                            fill
                            className="object-cover transition-transform duration-700 group-hover:scale-110"
                          />
                        ) : (
                          <div
                            className={`absolute inset-0 bg-gradient-to-br ${reward.gradient || 'from-gray-100 to-gray-50'}`}
                          >
                            {/* Centered icon for gradient backgrounds */}
                            <div className="absolute inset-0 flex items-center justify-center">
                              <IconComponent
                                className="w-16 h-16 opacity-20"
                                style={{ color: colors.espresso }}
                              />
                            </div>
                          </div>
                        )}

                        {/* Frost Layer */}
                        <div className="absolute inset-0 bg-white/10 backdrop-blur-md transition-all duration-500 group-hover:backdrop-blur-[3px]" />

                        {/* Lock Icon */}
                        <div className="absolute inset-0 flex items-center justify-center z-10">
                          <div
                            className="h-14 w-14 rounded-full flex items-center justify-center backdrop-blur-xl border transition-transform group-hover:scale-105"
                            style={{
                              backgroundColor: 'rgba(255, 255, 255, 0.2)',
                              borderColor: 'rgba(255, 255, 255, 0.4)',
                              boxShadow: '0 8px 16px rgba(0,0,0,0.1)',
                            }}
                          >
                            <Lock className="w-6 h-6 text-white drop-shadow-md" strokeWidth={2.5} />
                          </div>
                        </div>

                        {/* Bottom Content */}
                        <div
                          className="absolute bottom-0 inset-x-0 p-5 pt-12"
                          style={{
                            background: `linear-gradient(to top, ${colors.espresso}cc, transparent)`,
                          }}
                        >
                          <div className="flex flex-col gap-1">
                            <span className="text-[10px] font-bold tracking-[0.15em] text-white/90 uppercase">
                              {reward.points.toLocaleString()} {t('pts')}
                            </span>
                            <h3 className="text-white font-medium text-[17px] leading-tight drop-shadow-sm">
                              {reward.title}
                            </h3>
                            <p className="text-white/70 text-xs font-light truncate">
                              {reward.subtitle}
                            </p>
                          </div>
                        </div>
                      </motion.div>
                    );
                  }

                  // --- UNLOCKED STATE: Clean Luxury ---
                  return (
                    <motion.button
                      key={reward.id}
                      type="button"
                      initial={{ opacity: 0, y: 20 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{
                        duration: 0.4,
                        delay: 0.3 + tierIndex * 0.1 + cardIndex * 0.05,
                      }}
                      onClick={() => setSelectedReward(isSelected ? null : reward.id)}
                      className={`
                        group relative w-full rounded-[1.75rem] p-5 overflow-hidden
                        flex flex-col justify-between text-left
                        active:scale-[0.98] transition-all duration-200
                        ${isSelected ? 'ring-2 ring-offset-2' : ''}
                      `}
                      style={{
                        aspectRatio: '4 / 5',
                        boxShadow: '0 4px 20px -10px rgba(0,0,0,0.05)',
                        // @ts-expect-error - CSS custom properties
                        '--tw-ring-color': colors.gold,
                        '--tw-ring-offset-color': colors.ivory,
                      }}
                    >
                      {/* Background Gradient */}
                      <div
                        className={`absolute inset-0 bg-gradient-to-br ${reward.gradient || 'from-gray-100 to-gray-50'} backdrop-blur-md`}
                      />

                      {/* Subtle ring */}
                      <div
                        className="absolute inset-0 rounded-[1.75rem]"
                        style={{
                          boxShadow: 'inset 0 0 0 1px rgba(0,0,0,0.05)',
                        }}
                      />

                      {/* Content */}
                      <div className="relative flex flex-col h-full justify-between">
                        {/* Top Row: Points & Icon */}
                        <div className="flex justify-between items-start">
                          <span
                            className="inline-flex items-center justify-center h-6 px-2.5 text-[10px] font-bold tracking-widest uppercase rounded-full backdrop-blur-md border shadow-sm"
                            style={{
                              backgroundColor: 'rgba(255, 255, 255, 0.6)',
                              borderColor: 'rgba(255, 255, 255, 0.4)',
                              color: colors.taupe,
                            }}
                          >
                            {reward.points.toLocaleString()} {t('pts_label')}
                          </span>

                          {/* Glass Icon Circle */}
                          <div
                            className={`h-10 w-10 rounded-full flex items-center justify-center backdrop-blur-xl shadow-sm transition-all duration-200 ${
                              isSelected ? 'scale-0' : 'scale-100'
                            }`}
                            style={{
                              backgroundColor: 'rgba(255, 255, 255, 0.7)',
                              color: colors.espresso,
                            }}
                          >
                            <IconComponent className="w-5 h-5" />
                          </div>

                          {/* Checkmark when selected */}
                          <div
                            className={`absolute right-0 top-0 h-10 w-10 rounded-full flex items-center justify-center shadow-sm transition-all duration-200 ${
                              isSelected ? 'scale-100' : 'scale-0'
                            }`}
                            style={{
                              backgroundColor: colors.gold,
                            }}
                          >
                            <Check className="w-5 h-5 text-white" strokeWidth={3} />
                          </div>
                        </div>

                        {/* Bottom Row: Info & Action */}
                        <div className="flex flex-col gap-3">
                          <div>
                            <h3
                              className="text-[19px] font-bold leading-tight mb-0.5"
                              style={{ color: colors.espresso }}
                            >
                              {reward.title}
                            </h3>
                            <p
                              className="text-[13px] font-medium"
                              style={{ color: colors.taupe }}
                            >
                              {reward.subtitle}
                            </p>
                          </div>

                          {/* Tactile Button */}
                          <div
                            className="w-full py-3 rounded-xl text-[13px] font-semibold tracking-wide text-center border transition-all duration-200 group-active:scale-[0.96]"
                            style={{
                              backgroundColor: isSelected ? colors.gold : 'white',
                              borderColor: isSelected ? colors.gold : '#F0E6DE',
                              color: isSelected ? 'white' : colors.espresso,
                              boxShadow: isSelected 
                                ? '0 4px 12px rgba(214, 162, 73, 0.3)' 
                                : '0 2px 8px -2px rgba(63, 43, 36, 0.1)',
                            }}
                          >
                            {isSelected ? t('selected') : t('redeem')}
                          </div>
                        </div>
                      </div>
                    </motion.button>
                  );
                })}
              </div>
            </motion.section>
          );
        })}
      </main>

      {/* --- Floating Dynamic Island Dock --- */}
      <AnimatePresence>
        <motion.div
          initial={{ y: 100, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1], delay: 0.3 }}
          className="fixed bottom-6 left-0 right-0 z-50 flex justify-center px-4"
        >
          <div
            className="w-full max-w-md flex items-center justify-between p-3 pr-4 rounded-[2rem] border backdrop-blur-xl"
            style={{
              backgroundColor: 'rgba(253, 247, 240, 0.85)',
              backdropFilter: 'blur(20px) saturate(150%)',
              WebkitBackdropFilter: 'blur(20px) saturate(150%)',
              borderColor: 'rgba(255, 255, 255, 0.4)',
              boxShadow: '0 20px 40px -12px rgba(63, 43, 36, 0.15), 0 0 0 1px rgba(255, 255, 255, 0.5)',
            }}
          >
            {/* Left: Image & Info */}
            <div className="flex items-center gap-3.5">
              {/* Thumbnail */}
              <div className="relative h-12 w-12 shrink-0 overflow-hidden rounded-2xl shadow-inner group">
                <Image
                  src={appointment.image}
                  alt={appointment.service}
                  fill
                  className="object-cover transition-transform duration-500 group-hover:scale-110"
                />
                <div
                  className="absolute inset-0 rounded-2xl"
                  style={{ boxShadow: 'inset 0 0 0 1px rgba(0,0,0,0.05)' }}
                />
              </div>

              {/* Text Stack */}
              <div className="flex flex-col justify-center">
                <span
                  className="text-[10px] font-bold tracking-[0.15em] uppercase mb-0.5"
                  style={{ color: colors.gold }}
                >
                  {t('appointment')}
                </span>
                <h4
                  className="text-[15px] font-semibold leading-none mb-1"
                  style={{ color: colors.espresso }}
                >
                  {appointment.service}
                </h4>
                <div
                  className="flex items-center gap-1.5 text-xs"
                  style={{ color: colors.taupe }}
                >
                  <span>{appointment.date}</span>
                  <span
                    className="w-0.5 h-0.5 rounded-full"
                    style={{ backgroundColor: `${colors.taupe}80` }}
                  />
                  <span>{appointment.time || '2:00 PM'}</span>
                </div>
              </div>
            </div>

            {/* Right: Action Button - Tactile Style */}
            <button
              type="button"
              disabled={!selectedReward}
              onClick={handleApplyReward}
              className={`
                relative overflow-hidden px-5 py-3 rounded-xl
                text-[13px] font-semibold tracking-wide
                transition-all duration-200
                ${selectedReward 
                  ? 'active:scale-[0.96] hover:border-[#D6A249]/50' 
                  : 'cursor-not-allowed opacity-50'
                }
              `}
              style={{
                backgroundColor: selectedReward ? colors.gold : 'white',
                color: selectedReward ? 'white' : colors.espresso,
                boxShadow: selectedReward
                  ? '0 8px 20px rgba(214, 162, 73, 0.3)'
                  : '0 2px 8px -2px rgba(63, 43, 36, 0.1)',
                border: selectedReward ? 'none' : '1px solid #F0E6DE',
              }}
            >
              {selectedReward ? t('apply') : t('redeem')}
            </button>
          </div>
        </motion.div>
      </AnimatePresence>

      {/* --- Slide-to-Confirm Redeem Sheet --- */}
      <RedeemSheet
        isOpen={isRedeemSheetOpen}
        onClose={() => setIsRedeemSheetOpen(false)}
        onConfirm={handleRedeemConfirm}
        rewardTitle={selectedRewardObj?.title || ''}
        pointsCost={selectedRewardObj?.points || 0}
      />
    </div>
  );
}
