'use client';

import { useParams, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

import { useSalon } from '@/providers/SalonProvider';
import { themeVars } from '@/theme';

type Referral = {
  id: string;
  name: string;
  phone: string;
  status: 'pending' | 'booked' | 'completed';
  dateReferred: string;
  rewardEarned?: number;
  firstVisitDate?: string;
};

const REFERRALS: Referral[] = [
  {
    id: '1',
    name: 'Emma Wilson',
    phone: '•••• 4521',
    status: 'completed',
    dateReferred: 'Nov 10, 2025',
    rewardEarned: 15,
    firstVisitDate: 'Nov 18, 2025',
  },
  {
    id: '2',
    name: 'Sophie Chen',
    phone: '•••• 8834',
    status: 'completed',
    dateReferred: 'Oct 5, 2025',
    rewardEarned: 15,
    firstVisitDate: 'Oct 12, 2025',
  },
  {
    id: '3',
    name: 'Mia Johnson',
    phone: '•••• 2290',
    status: 'booked',
    dateReferred: 'Nov 28, 2025',
    firstVisitDate: 'Dec 5, 2025',
  },
  {
    id: '4',
    name: 'Olivia Brown',
    phone: '•••• 7763',
    status: 'pending',
    dateReferred: 'Dec 1, 2025',
  },
];

export default function MyReferralsPage() {
  const router = useRouter();
  const params = useParams();
  const { salonName } = useSalon();
  const locale = (params?.locale as string) || 'en';
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const handleBack = () => {
    router.back();
  };

  const handleInviteMore = () => {
    router.push(`/${locale}/invite`);
  };

  const getStatusStyles = (status: Referral['status']) => {
    switch (status) {
      case 'completed':
        return {
          bg: 'bg-gradient-to-r from-emerald-50 to-emerald-100',
          text: 'text-emerald-700',
          border: 'border-emerald-200',
          icon: '✓',
        };
      case 'booked':
        return {
          bg: 'bg-gradient-to-r from-blue-50 to-blue-100',
          text: 'text-blue-700',
          border: 'border-blue-200',
          icon: '📅',
        };
      case 'pending':
        return {
          bg: 'bg-gradient-to-r from-amber-50 to-amber-100',
          text: 'text-amber-700',
          border: 'border-amber-200',
          icon: '⏳',
        };
      default:
        return {
          bg: 'bg-neutral-50',
          text: 'text-neutral-700',
          border: 'border-neutral-200',
          icon: '•',
        };
    }
  };

  const getStatusLabel = (status: Referral['status']) => {
    switch (status) {
      case 'completed':
        return 'Reward Earned';
      case 'booked':
        return 'Visit Scheduled';
      case 'pending':
        return 'Invite Sent';
      default:
        return status;
    }
  };

  // Calculate stats
  const completedReferrals = REFERRALS.filter(r => r.status === 'completed');
  const totalEarned = completedReferrals.reduce(
    (sum, r) => sum + (r.rewardEarned || 0),
    0,
  );
  const pendingRewards = REFERRALS.filter(
    r => r.status === 'booked',
  ).length * 15;

  return (
    <div
      className="min-h-screen pb-10"
      style={{
        background: `linear-gradient(to bottom, color-mix(in srgb, ${themeVars.background} 95%, white), ${themeVars.background}, color-mix(in srgb, ${themeVars.background} 95%, ${themeVars.primaryDark}))`,
      }}
    >
      <div className="mx-auto flex w-full max-w-[430px] flex-col px-4">
        {/* Top bar with back button */}
        <div
          className="relative flex items-center pb-2 pt-6"
          style={{
            opacity: mounted ? 1 : 0,
            transform: mounted ? 'translateY(0)' : 'translateY(-8px)',
            transition: 'opacity 300ms ease-out, transform 300ms ease-out',
          }}
        >
          <button
            type="button"
            onClick={handleBack}
            aria-label="Go back"
            className="z-10 flex size-11 items-center justify-center rounded-full transition-all duration-200 hover:bg-white/60 active:scale-95"
          >
            <svg
              width="22"
              height="22"
              viewBox="0 0 20 20"
              fill="none"
              aria-hidden="true"
            >
              <path
                d="M12.5 15L7.5 10L12.5 5"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>

          <div
            className="absolute left-1/2 -translate-x-1/2 text-lg font-semibold tracking-tight"
            style={{ color: themeVars.accent }}
          >
            {salonName}
          </div>
        </div>

        {/* Title section */}
        <div
          className="pb-6 pt-4 text-center"
          style={{
            opacity: mounted ? 1 : 0,
            transform: mounted ? 'translateY(0)' : 'translateY(10px)',
            transition:
              'opacity 300ms ease-out 100ms, transform 300ms ease-out 100ms',
          }}
        >
          <h1
            className="text-3xl font-bold tracking-tight"
            style={{ color: themeVars.titleText }}
          >
            My Referrals
          </h1>
          <p className="mt-1 text-base italic text-neutral-500">
            Share the love, earn rewards
          </p>
        </div>

        {/* Stats Summary Card */}
        <div
          className="mb-6 overflow-hidden rounded-2xl shadow-xl"
          style={{
            background: `linear-gradient(to bottom right, ${themeVars.accent}, color-mix(in srgb, ${themeVars.accent} 70%, black))`,
            opacity: mounted ? 1 : 0,
            transform: mounted
              ? 'translateY(0) scale(1)'
              : 'translateY(10px) scale(0.97)',
            transition:
              'opacity 300ms ease-out 150ms, transform 300ms ease-out 150ms',
          }}
        >
          <div className="px-6 py-5">
            <div className="flex items-center justify-between">
              <div className="flex-1 text-center">
                <div className="text-3xl font-bold text-white">
                  {REFERRALS.length}
                </div>
                <div className="mt-0.5 text-sm text-white/70">Friends Invited</div>
              </div>
              <div className="h-12 w-px bg-white/20" />
              <div className="flex-1 text-center">
                <div className="text-3xl font-bold" style={{ color: themeVars.primary }}>
                  $
                  {totalEarned}
                </div>
                <div className="mt-0.5 text-sm text-white/70">Earned</div>
              </div>
              <div className="h-12 w-px bg-white/20" />
              <div className="flex-1 text-center">
                <div className="text-3xl font-bold text-white/90">
                  $
                  {pendingRewards}
                </div>
                <div className="mt-0.5 text-sm text-white/70">Pending</div>
              </div>
            </div>
          </div>
        </div>

        {/* How it works card */}
        <div
          className="mb-6 overflow-hidden rounded-2xl bg-white shadow-[0_4px_20px_rgba(0,0,0,0.06)]"
          style={{
            borderWidth: '1px',
            borderStyle: 'solid',
            borderColor: themeVars.cardBorder,
            opacity: mounted ? 1 : 0,
            transform: mounted
              ? 'translateY(0) scale(1)'
              : 'translateY(10px) scale(0.97)',
            transition:
              'opacity 300ms ease-out 200ms, transform 300ms ease-out 200ms',
          }}
        >
          <div
            className="h-1"
            style={{
              background: `linear-gradient(to right, ${themeVars.primaryDark}, ${themeVars.primary})`,
              width: mounted ? '100%' : '0%',
              transition: 'width 500ms ease-out 300ms',
            }}
          />
          <div className="p-5">
            <h2 className="mb-4 text-lg font-bold text-neutral-900">
              How It Works
            </h2>
            <div className="space-y-4">
              <div className="flex items-start gap-4">
                <div
                  className="flex size-10 shrink-0 items-center justify-center rounded-full"
                  style={{ backgroundColor: themeVars.background }}
                >
                  <span className="text-lg">💌</span>
                </div>
                <div>
                  <div className="font-semibold text-neutral-900">
                    Invite a Friend
                  </div>
                  <div className="mt-0.5 text-sm text-neutral-500">
                    Share your referral link or enter their number
                  </div>
                </div>
              </div>
              <div className="flex items-start gap-4">
                <div
                  className="flex size-10 shrink-0 items-center justify-center rounded-full"
                  style={{ backgroundColor: themeVars.background }}
                >
                  <span className="text-lg">💅</span>
                </div>
                <div>
                  <div className="font-semibold text-neutral-900">
                    They Book & Visit
                  </div>
                  <div className="mt-0.5 text-sm text-neutral-500">
                    Your friend gets $10 off their first visit
                  </div>
                </div>
              </div>
              <div className="flex items-start gap-4">
                <div
                  className="flex size-10 shrink-0 items-center justify-center rounded-full"
                  style={{
                    background: `linear-gradient(to bottom right, ${themeVars.primary}, ${themeVars.primaryDark})`,
                  }}
                >
                  <span className="text-lg">🎁</span>
                </div>
                <div>
                  <div className="font-semibold text-neutral-900">
                    You Earn $15
                  </div>
                  <div className="mt-0.5 text-sm text-neutral-500">
                    Credit added automatically after their visit
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Invite More Button */}
        <button
          type="button"
          onClick={handleInviteMore}
          className="mb-6 w-full rounded-full px-6 py-4 text-lg font-bold text-neutral-900 shadow-lg transition-all duration-200 ease-out hover:scale-[1.02] hover:shadow-xl active:scale-[0.98]"
          style={{
            background: `linear-gradient(to right, ${themeVars.primary}, ${themeVars.primaryDark})`,
            opacity: mounted ? 1 : 0,
            transform: mounted ? 'translateY(0)' : 'translateY(10px)',
            transition:
              'opacity 300ms ease-out 250ms, transform 300ms ease-out 250ms',
          }}
        >
          Invite More Friends
        </button>

        {/* Referrals List */}
        <div
          className="mb-4"
          style={{
            opacity: mounted ? 1 : 0,
            transition: 'opacity 300ms ease-out 300ms',
          }}
        >
          <h2 className="mb-3 px-1 text-lg font-bold text-neutral-900">
            Your Referrals
          </h2>
        </div>

        <div className="space-y-3">
          {REFERRALS.map((referral, index) => {
            const statusStyles = getStatusStyles(referral.status);
            return (
              <div
                key={referral.id}
                className="overflow-hidden rounded-2xl bg-white shadow-[0_4px_20px_rgba(0,0,0,0.06)]"
                style={{
                  borderWidth: '1px',
                  borderStyle: 'solid',
                  borderColor: themeVars.cardBorder,
                  opacity: mounted ? 1 : 0,
                  transform: mounted
                    ? 'translateY(0) scale(1)'
                    : 'translateY(15px) scale(0.98)',
                  transition: `opacity 300ms ease-out ${350 + index * 60}ms, transform 300ms ease-out ${350 + index * 60}ms`,
                }}
              >
                <div className="p-4">
                  <div className="flex items-center justify-between">
                    {/* Avatar and Name */}
                    <div className="flex items-center gap-3">
                      <div
                        className="flex size-12 items-center justify-center rounded-full"
                        style={{
                          background: `linear-gradient(to bottom right, ${themeVars.accentSelected}, color-mix(in srgb, ${themeVars.accentSelected} 80%, ${themeVars.accent}))`,
                        }}
                      >
                        <span className="text-lg font-bold" style={{ color: themeVars.accent }}>
                          {referral.name.charAt(0)}
                        </span>
                      </div>
                      <div>
                        <div className="font-bold text-neutral-900">
                          {referral.name}
                        </div>
                        <div className="text-sm text-neutral-500">
                          {referral.phone}
                        </div>
                      </div>
                    </div>

                    {/* Status Badge */}
                    <div
                      className={`rounded-full px-3 py-1.5 text-xs font-bold ${statusStyles.bg} ${statusStyles.text} border ${statusStyles.border}`}
                    >
                      {statusStyles.icon}
                      {' '}
                      {getStatusLabel(referral.status)}
                    </div>
                  </div>

                  {/* Details */}
                  <div className="mt-4 border-t border-neutral-100 pt-3">
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-neutral-500">Invited</span>
                      <span className="font-medium text-neutral-700">
                        {referral.dateReferred}
                      </span>
                    </div>

                    {referral.firstVisitDate && (
                      <div className="mt-2 flex items-center justify-between text-sm">
                        <span className="text-neutral-500">
                          {referral.status === 'booked'
                            ? 'Scheduled Visit'
                            : 'First Visit'}
                        </span>
                        <span className="font-medium text-neutral-700">
                          {referral.firstVisitDate}
                        </span>
                      </div>
                    )}

                    {referral.rewardEarned && (
                      <div className="mt-3 flex items-center justify-between border-t border-neutral-100 pt-3">
                        <span className="font-semibold text-neutral-900">
                          Reward Earned
                        </span>
                        <span className="text-lg font-bold text-emerald-600">
                          +$
                          {referral.rewardEarned}
                        </span>
                      </div>
                    )}

                    {referral.status === 'booked' && (
                      <div className="mt-3 flex items-center justify-between border-t border-neutral-100 pt-3">
                        <span className="font-semibold text-neutral-900">
                          Pending Reward
                        </span>
                        <span className="text-lg font-bold text-blue-600">
                          $15
                        </span>
                      </div>
                    )}

                    {referral.status === 'pending' && (
                      <div className="mt-3 border-t border-neutral-100 pt-3">
                        <div className="flex items-center gap-2 text-sm font-medium text-amber-600">
                          <span>⏳</span>
                          <span>Waiting for them to book</span>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Empty state */}
        {REFERRALS.length === 0 && (
          <div
            className="overflow-hidden rounded-2xl bg-white shadow-[0_4px_20px_rgba(0,0,0,0.06)]"
            style={{
              borderWidth: '1px',
              borderStyle: 'solid',
              borderColor: themeVars.cardBorder,
            }}
          >
            <div className="px-6 py-12 text-center">
              <div
                className="mx-auto mb-4 flex size-20 items-center justify-center rounded-full"
                style={{
                  background: `linear-gradient(to bottom right, ${themeVars.background}, color-mix(in srgb, ${themeVars.background} 80%, ${themeVars.primaryDark}))`,
                }}
              >
                <span className="text-4xl">💌</span>
              </div>
              <p className="text-lg font-semibold text-neutral-700">
                No referrals yet
              </p>
              <p className="mb-4 mt-1 text-sm text-neutral-500">
                Invite friends and earn $15 for each one who visits!
              </p>
              <button
                type="button"
                onClick={handleInviteMore}
                className="rounded-full px-6 py-3 text-base font-bold text-neutral-900 shadow-sm transition-all duration-200 hover:scale-[1.02] hover:shadow-md active:scale-[0.98]"
                style={{ backgroundColor: themeVars.primary }}
              >
                Start Inviting
              </button>
            </div>
          </div>
        )}

        {/* Bottom spacing */}
        <div className="h-6" />
      </div>
    </div>
  );
}
