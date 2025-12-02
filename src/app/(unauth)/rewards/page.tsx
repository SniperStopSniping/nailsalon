'use client';

import { useParams, useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

import { useTranslations } from '@/providers/I18nProvider';

type Reward = {
  id: string;
  label: string;
  isActive: boolean;
};

const USER_REWARDS: Reward[] = [
  { id: '5-off', label: '$5 OFF', isActive: true },
  { id: '10-off', label: '$10 OFF', isActive: true },
  { id: 'free-biab', label: 'FREE BIAB Fill', isActive: false },
  { id: 'vip', label: 'VIP Priority', isActive: true },
];

export default function RewardsPage() {
  const router = useRouter();
  const params = useParams();
  const locale = (params?.locale as string) || 'en';
  const t = useTranslations('Rewards');
  const [selectedReward, setSelectedReward] = useState<string | null>(null);
  const [rewardApplied, setRewardApplied] = useState(false);
  const [uploadStatus, setUploadStatus] = useState<{
    success: boolean;
    message: string;
  } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Animation states
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);

  // Appointment details
  const appointmentDetails = {
    serviceId: 'biab-medium',
    service: 'BIAB Medium',
    techId: 'tiffany',
    date: '2025-12-18',
    time: '14:00',
    displayDate: 'Dec 18',
    displayTime: '2:00 PM',
    originalPrice: 75,
  };

  // Calculate discount based on selected reward
  const getDiscountAmount = () => {
    if (!selectedReward) {
      return 0;
    }
    const reward = USER_REWARDS.find(r => r.id === selectedReward);
    if (!reward) {
      return 0;
    }

    if (reward.label === '$5 OFF') {
      return 5;
    }
    if (reward.label === '$10 OFF') {
      return 10;
    }
    if (reward.label === 'FREE BIAB Fill') {
      return appointmentDetails.originalPrice;
    }
    return 0;
  };

  const discountAmount = rewardApplied ? getDiscountAmount() : 0;
  const finalPrice = Math.max(0, appointmentDetails.originalPrice - discountAmount);

  // Reset applied state when reward selection changes
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
    // TODO: Apply reward to appointment via backend
    console.log('Applying reward:', selectedReward);
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

    // Validate file type
    if (!file.type.startsWith('image/')) {
      setUploadStatus({
        success: false,
        message: t('invalid_image'),
      });
      setTimeout(() => setUploadStatus(null), 3000);
      return;
    }

    // Validate file size (max 10MB)
    if (file.size > 10 * 1024 * 1024) {
      setUploadStatus({
        success: false,
        message: t('image_too_large'),
      });
      setTimeout(() => setUploadStatus(null), 3000);
      return;
    }

    // TODO: Upload to backend
    console.log('Uploading photo:', file.name);
    setUploadStatus({
      success: true,
      message: t('photo_uploaded'),
    });

    // Reset input
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }

    // Clear success message after 3 seconds
    setTimeout(() => {
      setUploadStatus(null);
    }, 3000);
  };

  const handleGoogleReview = () => {
    // TODO: Open Google review link
    console.log('TODO: Open Google review');
    window.open(
      'https://www.google.com/maps/place/Nail+Salon+No.5',
      '_blank',
    );
  };

  const activeRewards = USER_REWARDS.filter(r => r.isActive);

  return (
    <div className="flex min-h-screen justify-center bg-[#f6ebdd] pb-10 pt-6">
      <div className="mx-auto flex w-full max-w-[430px] flex-col gap-5 px-4">
        {/* Top bar with back button */}
        <div
          className="relative flex items-center"
          style={{
            opacity: mounted ? 1 : 0,
            transform: mounted ? 'translateY(0)' : 'translateY(-8px)',
            transition: 'opacity 250ms ease-out, transform 250ms ease-out',
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

          {/* Salon name - centered */}
          <div className="absolute left-1/2 -translate-x-1/2 text-xl font-semibold tracking-tight text-[#7b4ea3]">
            Nail Salon No.5
          </div>
        </div>

        {/* Title section */}
        <div
          className="space-y-2 pt-2 text-center"
          style={{
            opacity: mounted ? 1 : 0,
            transform: mounted ? 'translateY(0)' : 'translateY(10px)',
            transition: 'opacity 250ms ease-out 100ms, transform 250ms ease-out 100ms',
          }}
        >
          <h1 className="text-3xl font-semibold tracking-tight text-[#7b4ea3]">
            {t('title')}
          </h1>
          <p className="text-xl text-neutral-600">
            {t('welcome', { name: 'Sarah' })}
          </p>
        </div>

        {/* Main Card: Rewards + Apply to Appointment */}
        <div
          className="overflow-hidden rounded-2xl border border-[#e6d6c2] bg-white shadow-[0_4px_20px_rgba(0,0,0,0.08)]"
          style={{
            opacity: mounted ? 1 : 0,
            transform: mounted ? 'translateY(0) scale(1)' : 'translateY(10px) scale(0.97)',
            transition: 'opacity 250ms ease-out 200ms, transform 250ms ease-out 200ms',
          }}
        >
          {/* Gold accent bar */}
          <div
            className="h-1 bg-gradient-to-r from-[#d6a249] to-[#f4b864]"
            style={{
              width: mounted ? '100%' : '0%',
              transition: 'width 400ms ease-out 250ms',
            }}
          />

          <div className="px-5 py-6">
            {/* Reward Pills Section */}
            {activeRewards.length > 0 && (
              <div className="space-y-4">
                <h2 className="text-xl font-semibold text-neutral-900">
                  {t('your_rewards')}
                </h2>
                <div className="flex flex-wrap gap-2.5">
                  {activeRewards.map(reward => (
                    <button
                      key={reward.id}
                      type="button"
                      onClick={() =>
                        setSelectedReward(
                          selectedReward === reward.id ? null : reward.id,
                        )}
                      className={`rounded-full px-5 py-3 text-lg font-semibold transition-all duration-200 ${
                        selectedReward === reward.id
                          ? 'bg-[#f4b864] text-neutral-900 shadow-md ring-2 ring-[#d6a249] ring-offset-2 ring-offset-white'
                          : 'bg-neutral-50 text-neutral-700 hover:bg-neutral-100 hover:shadow-sm'
                      }`}
                    >
                      {reward.label}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Divider */}
            <div className="my-6 h-px bg-neutral-100" />

            {/* Apply to Appointment Section */}
            <div className="space-y-5">
              <div className="space-y-2">
                <h3 className="text-xl font-semibold text-neutral-900">
                  {t('apply_to_appointment')}
                </h3>
                <p className="text-lg text-neutral-600">
                  {appointmentDetails.service}
                  {' · '}
                  {appointmentDetails.displayDate}
                  {' · '}
                  {appointmentDetails.displayTime}
                </p>
              </div>

              {/* Price breakdown */}
              {rewardApplied && (
                <div className="space-y-3 rounded-xl bg-[#fff7ec] p-4">
                  <div className="flex items-center justify-between">
                    <span className="text-lg font-medium text-neutral-600">{t('original_price')}</span>
                    <span className="text-xl font-semibold text-neutral-900">
                      $
                      {appointmentDetails.originalPrice}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-lg font-medium text-neutral-600">{t('reward_applied_label')}</span>
                    <span className="text-xl font-semibold text-green-600">
                      -$
                      {discountAmount}
                    </span>
                  </div>
                  <div className="flex items-center justify-between border-t border-neutral-200 pt-3">
                    <span className="text-2xl font-bold text-neutral-900">
                      {t('new_total')}
                    </span>
                    <span className="text-2xl font-bold text-neutral-900">
                      $
                      {finalPrice.toFixed(2)}
                    </span>
                  </div>
                </div>
              )}

              <button
                type="button"
                onClick={handleApplyReward}
                disabled={!selectedReward || rewardApplied}
                className="w-full rounded-full bg-[#f4b864] px-5 py-4 text-lg font-bold text-neutral-900 shadow-sm transition-all duration-200 ease-out hover:scale-[1.02] hover:shadow-md active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:scale-100 disabled:hover:shadow-sm"
              >
                {rewardApplied ? t('reward_applied') : t('apply_reward')}
              </button>

              {rewardApplied && (
                <p className="text-center text-lg font-medium text-green-600">
                  {t('reward_applied_success')}
                </p>
              )}

              <button
                type="button"
                onClick={() => router.push(`/${locale}/change-appointment?serviceIds=${appointmentDetails.serviceId}&techId=${appointmentDetails.techId}&date=${appointmentDetails.date}&time=${appointmentDetails.time}`)}
                className="w-full text-lg font-medium text-neutral-500 underline underline-offset-2 transition-colors hover:text-neutral-700"
              >
                {t('change_appointment')}
              </button>
            </div>
          </div>
        </div>

        {/* Earn More Rewards Card */}
        <div
          className="overflow-hidden rounded-2xl border border-[#e6d6c2] bg-white shadow-[0_4px_20px_rgba(0,0,0,0.08)]"
          style={{
            opacity: mounted ? 1 : 0,
            transform: mounted ? 'translateY(0) scale(1)' : 'translateY(10px) scale(0.97)',
            transition: 'opacity 250ms ease-out 300ms, transform 250ms ease-out 300ms',
          }}
        >
          <div className="px-5 py-6">
            <div className="space-y-2">
              <h3 className="text-xl font-semibold text-neutral-900">
                {t('earn_more_rewards')}
              </h3>
              <p className="text-lg leading-relaxed text-neutral-600">
                {t('earn_more_description')}
              </p>
            </div>

            {/* Hidden file input */}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              onChange={handleFileChange}
              className="hidden"
            />

            <div className="mt-5 space-y-3">
              <button
                type="button"
                onClick={handleUploadPhoto}
                className="w-full rounded-full bg-[#f4b864] px-5 py-4 text-lg font-bold text-neutral-900 shadow-sm transition-all duration-200 ease-out hover:scale-[1.02] hover:shadow-md active:scale-[0.97]"
              >
                {t('upload_photo')}
              </button>

              {uploadStatus && (
                <p
                  className={`text-center text-lg font-medium ${
                    uploadStatus.success
                      ? 'text-green-600'
                      : 'text-red-500'
                  }`}
                >
                  {uploadStatus.message}
                </p>
              )}

              <button
                type="button"
                onClick={handleGoogleReview}
                className="w-full rounded-full bg-neutral-50 px-5 py-4 text-lg font-semibold text-neutral-700 transition-all duration-200 ease-out hover:scale-[1.01] hover:bg-neutral-100 hover:shadow-sm active:scale-[0.98]"
              >
                {t('leave_google_review')}
              </button>
            </div>
          </div>
        </div>

        {/* Past Nails Preview */}
        <div
          className="space-y-4"
          style={{
            opacity: mounted ? 1 : 0,
            transform: mounted ? 'translateY(0)' : 'translateY(10px)',
            transition: 'opacity 250ms ease-out 400ms, transform 250ms ease-out 400ms',
          }}
        >
          <h2 className="px-1 text-xl font-semibold text-neutral-900">
            {t('your_past_nails')}
          </h2>
          <div className="grid grid-cols-3 gap-3">
            {[
              {
                id: '2',
                imageUrl: '/assets/images/gel-x-extensions.jpg',
              },
              {
                id: '3',
                imageUrl: '/assets/images/biab-medium.webp',
              },
              {
                id: '4',
                imageUrl: '/assets/images/biab-french.jpg',
              },
            ].map(photo => (
              <button
                key={photo.id}
                type="button"
                onClick={() => router.push(`/${locale}/gallery`)}
                className="relative aspect-square overflow-hidden rounded-2xl bg-gradient-to-br from-[#f0dfc9] to-[#d9c6aa] shadow-sm transition-all duration-200 hover:scale-[1.02] hover:shadow-md active:scale-[0.98]"
              >
                <img
                  src={photo.imageUrl}
                  alt="Past nails"
                  className="size-full object-cover"
                  onError={(e) => {
                    e.currentTarget.style.display = 'none';
                  }}
                />
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={() => router.push(`/${locale}/gallery`)}
            className="w-full pt-1 text-lg font-semibold text-[#7b4ea3] transition-colors hover:text-[#7b4ea3]/80"
          >
            {t('view_all_photos')}
          </button>
        </div>
      </div>
    </div>
  );
}
