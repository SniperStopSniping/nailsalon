'use client';

/**
 * RewardsModal Component
 *
 * iOS-style loyalty program modal.
 * Features:
 * - Reward stats overview
 * - Active rewards list
 * - Referral tracking
 * - Points breakdown
 */

import {
  CheckCircle,
  Clock,
  Gift,
  TrendingUp,
  Users,
} from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

import { BackButton, ModalHeader } from './AppModal';

type RewardsModalProps = {
  onClose: () => void;
};

// Types
type RewardData = {
  id: string;
  clientPhone: string;
  clientName: string | null;
  type: 'referral_referee' | 'referral_referrer';
  points: number;
  status: 'active' | 'used' | 'expired';
  eligibleServiceName: string | null;
  expiresAt: string | null;
  createdAt: string;
};

type ReferralData = {
  id: string;
  referrerPhone: string;
  referrerName: string | null;
  refereePhone: string | null;
  refereeName: string | null;
  status: 'sent' | 'claimed' | 'booked' | 'reward_earned' | 'expired';
  createdAt: string;
  claimedAt: string | null;
};

// Status badge colors
function getStatusColor(status: string): { bg: string; text: string } {
  switch (status) {
    case 'active':
    case 'claimed':
    case 'booked':
      return { bg: 'bg-green-100', text: 'text-green-600' };
    case 'reward_earned':
      return { bg: 'bg-blue-100', text: 'text-blue-600' };
    case 'used':
      return { bg: 'bg-gray-100', text: 'text-gray-500' };
    case 'expired':
      return { bg: 'bg-red-100', text: 'text-red-500' };
    case 'sent':
      return { bg: 'bg-orange-100', text: 'text-orange-600' };
    default:
      return { bg: 'bg-gray-100', text: 'text-gray-500' };
  }
}

// Format phone
function formatPhone(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  if (digits.length === 10) {
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  }
  return phone;
}

/**
 * Stats Card Component
 */
function StatsCard({
  icon: Icon,
  label,
  value,
  color,
}: {
  icon: typeof Gift;
  label: string;
  value: string | number;
  color: string;
}) {
  return (
    <div className="rounded-[16px] bg-white p-4 shadow-[0_4px_20px_rgba(0,0,0,0.03)]">
      <div className={`size-10 rounded-[10px] bg-gradient-to-br ${color} mb-3 flex items-center justify-center`}>
        <Icon className="size-5 text-white" />
      </div>
      <div className="text-[13px] font-medium uppercase text-[#8E8E93]">{label}</div>
      <div className="mt-0.5 text-[28px] font-bold text-[#1C1C1E]">{value}</div>
    </div>
  );
}

/**
 * Tab Selector Component
 */
function TabSelector({
  active,
  onChange,
}: {
  active: 'rewards' | 'referrals';
  onChange: (tab: 'rewards' | 'referrals') => void;
}) {
  return (
    <div className="mb-4 flex rounded-lg bg-[#767680]/10 p-0.5">
      <button
        type="button"
        onClick={() => onChange('rewards')}
        className={`
          flex flex-1 items-center justify-center gap-2 rounded-[6px] py-2 text-[14px] font-medium transition-all
          ${active === 'rewards'
      ? 'bg-white text-black shadow-sm'
      : 'bg-transparent text-gray-500'
    }
        `}
      >
        <Gift className="size-4" />
        Rewards
      </button>
      <button
        type="button"
        onClick={() => onChange('referrals')}
        className={`
          flex flex-1 items-center justify-center gap-2 rounded-[6px] py-2 text-[14px] font-medium transition-all
          ${active === 'referrals'
      ? 'bg-white text-black shadow-sm'
      : 'bg-transparent text-gray-500'
    }
        `}
      >
        <Users className="size-4" />
        Referrals
      </button>
    </div>
  );
}

/**
 * Reward Row Component
 */
function RewardRow({
  reward,
  isLast,
}: {
  reward: RewardData;
  isLast: boolean;
}) {
  const statusColors = getStatusColor(reward.status);
  const createdDate = new Date(reward.createdAt);
  const formattedDate = createdDate.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  });

  const typeLabel = reward.type === 'referral_referrer' ? 'Referrer Reward' : 'New Client Reward';

  return (
    <div className={`flex items-center px-4 py-3 ${!isLast ? 'border-b border-gray-100' : ''}`}>
      <div className="mr-3 flex size-10 items-center justify-center rounded-full bg-gradient-to-br from-[#84fab0] to-[#8fd3f4]">
        <Gift className="size-5 text-white" />
      </div>

      <div className="min-w-0 flex-1">
        <div className="truncate text-[15px] font-medium text-[#1C1C1E]">
          {reward.clientName || formatPhone(reward.clientPhone)}
        </div>
        <div className="mt-0.5 flex items-center gap-2 text-[13px] text-[#8E8E93]">
          <span>{typeLabel}</span>
          <span>•</span>
          <span>{formattedDate}</span>
        </div>
      </div>

      <div className="text-right">
        <div className={`rounded-full px-2 py-0.5 text-[12px] font-medium ${statusColors.bg} ${statusColors.text} capitalize`}>
          {reward.status}
        </div>
        {reward.eligibleServiceName && (
          <div className="mt-1 text-[11px] text-[#8E8E93]">
            {reward.eligibleServiceName}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Referral Row Component
 */
function ReferralRow({
  referral,
  isLast,
}: {
  referral: ReferralData;
  isLast: boolean;
}) {
  const statusColors = getStatusColor(referral.status);
  const createdDate = new Date(referral.createdAt);
  const formattedDate = createdDate.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  });

  return (
    <div className={`flex items-center px-4 py-3 ${!isLast ? 'border-b border-gray-100' : ''}`}>
      <div className="mr-3 flex size-10 items-center justify-center rounded-full bg-gradient-to-br from-[#43e97b] to-[#38f9d7]">
        <Users className="size-5 text-white" />
      </div>

      <div className="min-w-0 flex-1">
        <div className="truncate text-[15px] font-medium text-[#1C1C1E]">
          {referral.referrerName || formatPhone(referral.referrerPhone)}
        </div>
        <div className="mt-0.5 flex items-center gap-1 text-[13px] text-[#8E8E93]">
          <span>→</span>
          <span className="truncate">
            {referral.refereeName || (referral.refereePhone ? formatPhone(referral.refereePhone) : 'Pending')}
          </span>
        </div>
      </div>

      <div className="text-right">
        <div className={`rounded-full px-2 py-0.5 text-[12px] font-medium ${statusColors.bg} ${statusColors.text} capitalize`}>
          {referral.status.replace('_', ' ')}
        </div>
        <div className="mt-1 text-[11px] text-[#8E8E93]">{formattedDate}</div>
      </div>
    </div>
  );
}

/**
 * Empty State Component
 */
function EmptyState({ type }: { type: 'rewards' | 'referrals' }) {
  return (
    <div className="flex flex-col items-center justify-center px-8 py-16">
      <div className="mb-4 flex size-16 items-center justify-center rounded-full bg-[#F2F2F7]">
        {type === 'rewards'
          ? (
              <Gift className="size-8 text-[#8E8E93]" />
            )
          : (
              <Users className="size-8 text-[#8E8E93]" />
            )}
      </div>
      <h3 className="mb-1 text-[17px] font-semibold text-[#1C1C1E]">
        No
        {' '}
        {type === 'rewards' ? 'Rewards' : 'Referrals'}
        {' '}
        Yet
      </h3>
      <p className="text-center text-[15px] text-[#8E8E93]">
        {type === 'rewards'
          ? 'Rewards will appear here when clients earn them'
          : 'Referrals will appear here when clients share their links'}
      </p>
    </div>
  );
}

/**
 * Loading Skeleton
 */
function LoadingSkeleton() {
  return (
    <div className="animate-pulse">
      {[1, 2, 3, 4].map(i => (
        <div key={i} className="flex items-center px-4 py-3">
          <div className="mr-3 size-10 rounded-full bg-gray-200" />
          <div className="flex-1">
            <div className="mb-2 h-4 w-32 rounded bg-gray-200" />
            <div className="h-3 w-24 rounded bg-gray-100" />
          </div>
          <div className="h-5 w-16 rounded bg-gray-200" />
        </div>
      ))}
    </div>
  );
}

export function RewardsModal({ onClose }: RewardsModalProps) {
  const [activeTab, setActiveTab] = useState<'rewards' | 'referrals'>('rewards');
  const [rewards, setRewards] = useState<RewardData[]>([]);
  const [referrals, setReferrals] = useState<ReferralData[]>([]);
  const [loading, setLoading] = useState(true);

  // Fetch data
  const fetchData = useCallback(async () => {
    try {
      setLoading(true);

      // Fetch rewards
      const rewardsRes = await fetch('/api/rewards');
      if (rewardsRes.ok) {
        const rewardsData = await rewardsRes.json();
        setRewards(rewardsData.data?.rewards || []);
      }

      // Fetch referrals
      const referralsRes = await fetch('/api/referrals');
      if (referralsRes.ok) {
        const referralsData = await referralsRes.json();
        setReferrals(referralsData.data?.referrals || []);
      }
    } catch (error) {
      console.error('Failed to fetch rewards data:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Calculate stats
  const activeRewards = rewards.filter(r => r.status === 'active').length;
  const usedRewards = rewards.filter(r => r.status === 'used').length;
  const pendingReferrals = referrals.filter(r => r.status === 'sent' || r.status === 'claimed').length;
  const completedReferrals = referrals.filter(r => r.status === 'reward_earned').length;

  return (
    <div className="flex min-h-full w-full flex-col bg-[#F2F2F7] font-sans text-black">
      {/* Header */}
      <div className="sticky top-0 z-20 bg-[#F2F2F7]/80 backdrop-blur-md">
        <ModalHeader
          title="Rewards"
          subtitle="Loyalty Program"
          leftAction={<BackButton onClick={onClose} label="Back" />}
        />
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-4 pb-10">
        {/* Stats Grid */}
        <div className="mb-6 grid grid-cols-2 gap-4">
          <StatsCard
            icon={Gift}
            label="Active Rewards"
            value={activeRewards}
            color="from-[#84fab0] to-[#8fd3f4]"
          />
          <StatsCard
            icon={CheckCircle}
            label="Redeemed"
            value={usedRewards}
            color="from-[#a18cd1] to-[#fbc2eb]"
          />
          <StatsCard
            icon={Clock}
            label="Pending Referrals"
            value={pendingReferrals}
            color="from-[#f6d365] to-[#fda085]"
          />
          <StatsCard
            icon={TrendingUp}
            label="Completed"
            value={completedReferrals}
            color="from-[#43e97b] to-[#38f9d7]"
          />
        </div>

        {/* Tab Selector */}
        <TabSelector active={activeTab} onChange={setActiveTab} />

        {/* Content */}
        {loading
          ? (
              <div className="overflow-hidden rounded-[16px] bg-white shadow-[0_4px_20px_rgba(0,0,0,0.03)]">
                <LoadingSkeleton />
              </div>
            )
          : activeTab === 'rewards'
            ? (
                rewards.length === 0
                  ? (
                      <EmptyState type="rewards" />
                    )
                  : (
                      <div className="overflow-hidden rounded-[16px] bg-white shadow-[0_4px_20px_rgba(0,0,0,0.03)]">
                        {rewards.map((reward, index) => (
                          <RewardRow
                            key={reward.id}
                            reward={reward}
                            isLast={index === rewards.length - 1}
                          />
                        ))}
                      </div>
                    )
              )
            : (
                referrals.length === 0
                  ? (
                      <EmptyState type="referrals" />
                    )
                  : (
                      <div className="overflow-hidden rounded-[16px] bg-white shadow-[0_4px_20px_rgba(0,0,0,0.03)]">
                        {referrals.map((referral, index) => (
                          <ReferralRow
                            key={referral.id}
                            referral={referral}
                            isLast={index === referrals.length - 1}
                          />
                        ))}
                      </div>
                    )
              )}
      </div>
    </div>
  );
}
