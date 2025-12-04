'use client';

import Image from 'next/image';
import { useParams, useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';

import { useSalon } from '@/providers/SalonProvider';
import { themeVars } from '@/theme';

type Reward = {
  id: string;
  label: string;
  value: number;
  description: string;
  icon: string;
  isActive: boolean;
};

const USER_REWARDS: Reward[] = [
  {
    id: '5-off',
    label: '$5 OFF',
    value: 5,
    description: 'Any service',
    icon: '🎫',
    isActive: true,
  },
  {
    id: '10-off',
    label: '$10 OFF',
    value: 10,
    description: 'Any service',
    icon: '🎟️',
    isActive: true,
  },
  {
    id: 'free-biab',
    label: 'FREE Fill',
    value: 65,
    description: 'BIAB Refill',
    icon: '💎',
    isActive: false,
  },
  {
    id: 'vip',
    label: 'VIP Priority',
    value: 0,
    description: 'Skip the wait',
    icon: '⭐',
    isActive: true,
  },
];

export default function RewardsPage() {
  const router = useRouter();
  const params = useParams();
  const { salonName } = useSalon();
  const locale = (params?.locale as string) || 'en';
  const t = useTranslations('Rewards');
  const [selectedReward, setSelectedReward] = useState<string | null>(null);
  const [rewardApplied, setRewardApplied] = useState(false);
  const [uploadStatus, setUploadStatus] = useState<{
    success: boolean;
    message: string;
  } | null>(null);
  const [mounted, setMounted] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  const appointmentDetails = {
    serviceId: 'biab-medium',
    service: 'BIAB Medium',
    techId: 'tiffany',
    techName: 'Tiffany',
    date: '2025-12-18',
    time: '14:00',
    displayDate: 'Thu, Dec 18',
    displayTime: '2:00 PM',
    originalPrice: 75,
  };

  const getDiscountAmount = () => {
    if (!selectedReward) {
      return 0;
    }
    const reward = USER_REWARDS.find(r => r.id === selectedReward);
    if (!reward) {
      return 0;
    }
    return reward.value;
  };

  const discountAmount = rewardApplied ? getDiscountAmount() : 0;
  const finalPrice = Math.max(
    0,
    appointmentDetails.originalPrice - discountAmount,
  );

  useEffect(() => {
    setRewardApplied(false);
  }, [selectedReward]);

  const handleBack = () => {
    router.back();
  };

  const handleApplyReward = () => {
    if (!selectedReward) {
      return;
    }
    setRewardApplied(true);
  };

  const handleUploadPhoto = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) {
      return;
    }

    if (!file.type.startsWith('image/')) {
      setUploadStatus({
        success: false,
        message: t('invalid_image'),
      });
      setTimeout(() => setUploadStatus(null), 3000);
      return;
    }

    if (file.size > 10 * 1024 * 1024) {
      setUploadStatus({
        success: false,
        message: t('image_too_large'),
      });
      setTimeout(() => setUploadStatus(null), 3000);
      return;
    }

    setUploadStatus({
      success: true,
      message: t('photo_uploaded'),
    });

    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }

    setTimeout(() => {
      setUploadStatus(null);
    }, 3000);
  };

  const handleGoogleReview = () => {
    window.open(
      'https://www.google.com/maps/place/Nail+Salon+No.5',
      '_blank',
    );
  };

  const activeRewards = USER_REWARDS.filter(r => r.isActive);
  const totalPoints = 240;
  const nextRewardPoints = 300;
  const progressPercent = (totalPoints / nextRewardPoints) * 100;

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
            className="z-10 flex size-11 items-center justify-center rounded-full transition-all duration-200 hover:bg-white/60 active:scale-95"
          >
            <svg
              width="22"
              height="22"
              viewBox="0 0 20 20"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
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
            {t('title')}
          </h1>
          <p className="mt-1 text-base text-neutral-500">
            {t('welcome', { name: 'Sarah' })}
            {' '}
            ✨
          </p>
        </div>

        {/* Points Summary Card */}
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
            <div className="mb-4 flex items-center justify-between">
              <div>
                <div className="text-sm text-white/70">Your Points</div>
                <div className="text-4xl font-bold text-white">{totalPoints}</div>
              </div>
              <div className="flex size-16 items-center justify-center rounded-full bg-white/20">
                <span className="text-3xl">💎</span>
              </div>
            </div>
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-white/70">
                  {nextRewardPoints - totalPoints}
                  {' '}
                  pts to FREE BIAB Fill
                </span>
                <span className="font-semibold" style={{ color: themeVars.primary }}>
                  {nextRewardPoints}
                  {' '}
                  pts
                </span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-white/20">
                <div
                  className="h-full rounded-full transition-all duration-700"
                  style={{
                    background: `linear-gradient(to right, ${themeVars.primary}, ${themeVars.primaryDark})`,
                    width: mounted ? `${progressPercent}%` : '0%',
                  }}
                />
              </div>
            </div>
          </div>
        </div>

        {/* Available Rewards */}
        <div
          className="mb-6"
          style={{
            opacity: mounted ? 1 : 0,
            transition: 'opacity 300ms ease-out 200ms',
          }}
        >
          <h2 className="mb-3 px-1 text-lg font-bold text-neutral-900">
            {t('your_rewards')}
          </h2>
          <div className="grid grid-cols-2 gap-3">
            {activeRewards.map((reward, index) => {
              const isSelected = selectedReward === reward.id;
              return (
                <button
                  key={reward.id}
                  type="button"
                  onClick={() =>
                    setSelectedReward(
                      selectedReward === reward.id ? null : reward.id,
                    )}
                  className="rounded-2xl p-4 text-left transition-all duration-200"
                  style={{
                    transform: isSelected ? 'scale(1.02)' : undefined,
                    background: isSelected
                      ? `linear-gradient(to bottom right, ${themeVars.primary}, ${themeVars.primaryDark})`
                      : 'white',
                    boxShadow: isSelected
                      ? '0 10px 15px -3px rgb(0 0 0 / 0.1)'
                      : '0 4px 20px rgba(0,0,0,0.06)',
                    borderWidth: isSelected ? 0 : '1px',
                    borderStyle: 'solid',
                    borderColor: isSelected ? 'transparent' : themeVars.cardBorder,
                    opacity: mounted ? 1 : 0,
                    transition: `opacity 300ms ease-out ${250 + index * 50}ms, transform 300ms ease-out ${250 + index * 50}ms`,
                  }}
                  onMouseEnter={(e) => {
                    if (!isSelected) {
                      e.currentTarget.style.transform = 'scale(1.01)';
                      e.currentTarget.style.boxShadow = '0 10px 15px -3px rgb(0 0 0 / 0.1)';
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (!isSelected) {
                      e.currentTarget.style.transform = '';
                      e.currentTarget.style.boxShadow = '0 4px 20px rgba(0,0,0,0.06)';
                    }
                  }}
                >
                  <div className="mb-2 text-2xl">{reward.icon}</div>
                  <div className="text-lg font-bold text-neutral-900">
                    {reward.label}
                  </div>
                  <div
                    className={`text-sm ${
                      isSelected
                        ? 'text-neutral-700'
                        : 'text-neutral-500'
                    }`}
                  >
                    {reward.description}
                  </div>
                  {isSelected && (
                    <div className="mt-2 flex items-center gap-1 text-xs font-bold text-neutral-800">
                      <svg
                        width="14"
                        height="14"
                        viewBox="0 0 24 24"
                        fill="none"
                        xmlns="http://www.w3.org/2000/svg"
                      >
                        <path
                          d="M20 6L9 17L4 12"
                          stroke="currentColor"
                          strokeWidth="3"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                      Selected
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* Apply to Appointment Card */}
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
              'opacity 300ms ease-out 350ms, transform 300ms ease-out 350ms',
          }}
        >
          <div
            className="h-1"
            style={{
              background: `linear-gradient(to right, ${themeVars.primaryDark}, ${themeVars.primary})`,
              width: mounted ? '100%' : '0%',
              transition: 'width 500ms ease-out 400ms',
            }}
          />
          <div className="p-5">
            <h3 className="mb-4 text-lg font-bold text-neutral-900">
              {t('apply_to_appointment')}
            </h3>

            {/* Appointment Preview */}
            <div
              className="mb-4 flex items-center gap-4 rounded-xl p-4"
              style={{
                background: `color-mix(in srgb, ${themeVars.background} 95%, white)`,
              }}
            >
              <div className="relative size-14 shrink-0 overflow-hidden rounded-xl bg-white shadow-sm">
                <Image
                  src="/assets/images/biab-medium.webp"
                  alt={appointmentDetails.service}
                  fill
                  className="object-cover"
                />
              </div>
              <div className="min-w-0 flex-1">
                <div className="font-bold text-neutral-900">
                  {appointmentDetails.service}
                </div>
                <div className="flex items-center gap-1 text-sm text-neutral-600">
                  <span style={{ color: themeVars.accent }}>✦</span>
                  {appointmentDetails.techName}
                </div>
                <div className="text-sm text-neutral-500">
                  {appointmentDetails.displayDate}
                  {' '}
                  ·
                  {appointmentDetails.displayTime}
                </div>
              </div>
            </div>

            {/* Price Breakdown */}
            {rewardApplied
              ? (
                  <div className="mb-4 space-y-3 rounded-xl border border-emerald-200 bg-gradient-to-br from-emerald-50 to-emerald-100 p-4">
                    <div className="flex items-center justify-between">
                      <span className="text-neutral-600">{t('original_price')}</span>
                      <span className="font-semibold text-neutral-700">
                        $
                        {appointmentDetails.originalPrice}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-neutral-600">{t('reward_applied_label')}</span>
                      <span className="font-bold text-emerald-600">
                        -$
                        {discountAmount}
                      </span>
                    </div>
                    <div className="flex items-center justify-between border-t border-emerald-200 pt-3">
                      <span className="text-lg font-bold text-neutral-900">
                        {t('new_total')}
                      </span>
                      <span className="text-2xl font-bold" style={{ color: themeVars.accent }}>
                        $
                        {finalPrice}
                      </span>
                    </div>
                  </div>
                )
              : (
                  <div className="mb-4 flex items-center justify-between rounded-xl bg-neutral-50 p-4">
                    <span className="text-neutral-600">Service Price</span>
                    <span className="text-xl font-bold text-neutral-900">
                      $
                      {appointmentDetails.originalPrice}
                    </span>
                  </div>
                )}

            {/* Apply Button */}
            <button
              type="button"
              onClick={handleApplyReward}
              disabled={!selectedReward || rewardApplied}
              className="w-full rounded-full px-6 py-3.5 text-lg font-bold shadow-sm transition-all duration-200 ease-out"
              style={{
                background: rewardApplied
                  ? '#22c55e'
                  : selectedReward
                    ? `linear-gradient(to right, ${themeVars.primary}, ${themeVars.primaryDark})`
                    : '#e5e5e5',
                color: rewardApplied ? 'white' : selectedReward ? '#171717' : '#a3a3a3',
                cursor: !selectedReward || rewardApplied ? 'not-allowed' : 'pointer',
                transform: selectedReward && !rewardApplied ? undefined : 'scale(1)',
              }}
              onMouseEnter={(e) => {
                if (selectedReward && !rewardApplied) {
                  e.currentTarget.style.transform = 'scale(1.02)';
                  e.currentTarget.style.boxShadow = '0 4px 6px -1px rgb(0 0 0 / 0.1)';
                }
              }}
              onMouseLeave={(e) => {
                if (selectedReward && !rewardApplied) {
                  e.currentTarget.style.transform = 'scale(1)';
                  e.currentTarget.style.boxShadow = '';
                }
              }}
            >
              {rewardApplied ? `✓ ${t('reward_applied')}` : t('apply_reward')}
            </button>

            {rewardApplied && (
              <p className="mt-3 text-center text-base font-medium text-emerald-600">
                {t('reward_applied_success')}
              </p>
            )}

            <button
              type="button"
              onClick={() =>
                router.push(
                  `/${locale}/change-appointment?serviceIds=${appointmentDetails.serviceId}&techId=${appointmentDetails.techId}&date=${appointmentDetails.date}&time=${appointmentDetails.time}`,
                )}
              className="mt-4 w-full text-base font-medium transition-colors"
              style={{ color: themeVars.accent }}
              onMouseEnter={(e) => {
                e.currentTarget.style.opacity = '0.8';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.opacity = '1';
              }}
            >
              {t('change_appointment')}
            </button>
          </div>
        </div>

        {/* Earn More Rewards Card */}
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
              'opacity 300ms ease-out 400ms, transform 300ms ease-out 400ms',
          }}
        >
          <div className="p-5">
            <h3 className="mb-2 text-lg font-bold text-neutral-900">
              {t('earn_more_rewards')}
            </h3>
            <p className="mb-5 text-base text-neutral-600">
              {t('earn_more_description')}
            </p>

            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              onChange={handleFileChange}
              className="hidden"
            />

            <div className="space-y-3">
              <button
                type="button"
                onClick={handleUploadPhoto}
                className="flex w-full items-center justify-center gap-3 rounded-full px-6 py-3.5 text-lg font-bold text-neutral-900 shadow-sm transition-all duration-200 hover:scale-[1.02] hover:shadow-md active:scale-[0.98]"
                style={{
                  background: `linear-gradient(to right, ${themeVars.primary}, ${themeVars.primaryDark})`,
                }}
              >
                <span className="text-xl">📸</span>
                {t('upload_photo')}
              </button>

              {uploadStatus && (
                <p
                  className={`text-center text-base font-medium ${
                    uploadStatus.success ? 'text-emerald-600' : 'text-red-600'
                  }`}
                >
                  {uploadStatus.message}
                </p>
              )}

              <button
                type="button"
                onClick={handleGoogleReview}
                className="flex w-full items-center justify-center gap-3 rounded-full border-2 bg-white px-6 py-3.5 text-lg font-bold text-neutral-700 shadow-sm transition-all duration-200 hover:scale-[1.02] hover:bg-neutral-50 active:scale-[0.98]"
                style={{
                  borderColor: themeVars.cardBorder,
                }}
              >
                <span className="text-xl">⭐</span>
                {t('leave_google_review')}
              </button>
            </div>
          </div>
        </div>

        {/* Past Nails Gallery */}
        <div
          className="mb-6"
          style={{
            opacity: mounted ? 1 : 0,
            transition: 'opacity 300ms ease-out 450ms',
          }}
        >
          <div className="mb-3 flex items-center justify-between px-1">
            <h2 className="text-lg font-bold text-neutral-900">
              {t('your_past_nails')}
            </h2>
            <button
              type="button"
              onClick={() => router.push(`/${locale}/gallery`)}
              className="text-sm font-semibold transition-colors"
              style={{ color: themeVars.accent }}
              onMouseEnter={(e) => {
                e.currentTarget.style.opacity = '0.8';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.opacity = '1';
              }}
            >
              {t('view_all_photos')}
              {' '}
              →
            </button>
          </div>
          <div className="grid grid-cols-3 gap-3">
            {[
              { id: '1', imageUrl: '/assets/images/gel-x-extensions.jpg' },
              { id: '2', imageUrl: '/assets/images/biab-medium.webp' },
              { id: '3', imageUrl: '/assets/images/biab-french.jpg' },
            ].map((photo, index) => (
              <button
                key={photo.id}
                type="button"
                onClick={() => router.push(`/${locale}/gallery`)}
                className="relative aspect-square overflow-hidden rounded-2xl shadow-md transition-all duration-200 hover:scale-[1.03]"
                style={{
                  background: `linear-gradient(to bottom right, color-mix(in srgb, ${themeVars.background} 80%, ${themeVars.primaryDark}), color-mix(in srgb, ${themeVars.selectedBackground} 90%, ${themeVars.primaryDark}))`,
                  opacity: mounted ? 1 : 0,
                  transform: mounted ? 'scale(1)' : 'scale(0.9)',
                  transition: `opacity 300ms ease-out ${500 + index * 50}ms, transform 300ms ease-out ${500 + index * 50}ms`,
                }}
              >
                <Image
                  src={photo.imageUrl}
                  alt="Past nails"
                  fill
                  className="object-cover"
                />
              </button>
            ))}
          </div>
        </div>

        {/* Bottom spacing */}
        <div className="h-6" />
      </div>
    </div>
  );
}
