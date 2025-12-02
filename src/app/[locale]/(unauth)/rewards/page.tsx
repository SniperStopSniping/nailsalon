"use client";

import { useParams, useRouter } from "next/navigation";
import { useState, useRef, useEffect } from "react";
import { useTranslations } from "next-intl";

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
    id: "5-off",
    label: "$5 OFF",
    value: 5,
    description: "Any service",
    icon: "🎫",
    isActive: true,
  },
  {
    id: "10-off",
    label: "$10 OFF",
    value: 10,
    description: "Any service",
    icon: "🎟️",
    isActive: true,
  },
  {
    id: "free-biab",
    label: "FREE Fill",
    value: 65,
    description: "BIAB Refill",
    icon: "💎",
    isActive: false,
  },
  {
    id: "vip",
    label: "VIP Priority",
    value: 0,
    description: "Skip the wait",
    icon: "⭐",
    isActive: true,
  },
];

export default function RewardsPage() {
  const router = useRouter();
  const params = useParams();
  const locale = (params?.locale as string) || "en";
  const t = useTranslations("Rewards");
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
    serviceId: "biab-medium",
    service: "BIAB Medium",
    techId: "tiffany",
    techName: "Tiffany",
    date: "2025-12-18",
    time: "14:00",
    displayDate: "Thu, Dec 18",
    displayTime: "2:00 PM",
    originalPrice: 75,
  };

  const getDiscountAmount = () => {
    if (!selectedReward) return 0;
    const reward = USER_REWARDS.find((r) => r.id === selectedReward);
    if (!reward) return 0;
    return reward.value;
  };

  const discountAmount = rewardApplied ? getDiscountAmount() : 0;
  const finalPrice = Math.max(
    0,
    appointmentDetails.originalPrice - discountAmount
  );

  useEffect(() => {
    setRewardApplied(false);
  }, [selectedReward]);

  const handleBack = () => {
    router.back();
  };

  const handleApplyReward = () => {
    if (!selectedReward) return;
    setRewardApplied(true);
  };

  const handleUploadPhoto = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith("image/")) {
      setUploadStatus({
        success: false,
        message: t("invalid_image"),
      });
      setTimeout(() => setUploadStatus(null), 3000);
      return;
    }

    if (file.size > 10 * 1024 * 1024) {
      setUploadStatus({
        success: false,
        message: t("image_too_large"),
      });
      setTimeout(() => setUploadStatus(null), 3000);
      return;
    }

    setUploadStatus({
      success: true,
      message: t("photo_uploaded"),
    });

    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }

    setTimeout(() => {
      setUploadStatus(null);
    }, 3000);
  };

  const handleGoogleReview = () => {
    window.open(
      "https://www.google.com/maps/place/Nail+Salon+No.5",
      "_blank"
    );
  };

  const activeRewards = USER_REWARDS.filter((r) => r.isActive);
  const totalPoints = 240;
  const nextRewardPoints = 300;
  const progressPercent = (totalPoints / nextRewardPoints) * 100;

  return (
    <div className="min-h-screen bg-gradient-to-b from-[#f8f0e5] via-[#f6ebdd] to-[#f4e6d4] pb-10">
      <div className="mx-auto flex w-full max-w-[430px] flex-col px-4">
        {/* Top bar with back button */}
        <div
          className="pt-6 pb-2 relative flex items-center"
          style={{
            opacity: mounted ? 1 : 0,
            transform: mounted ? "translateY(0)" : "translateY(-8px)",
            transition: "opacity 300ms ease-out, transform 300ms ease-out",
          }}
        >
          <button
            type="button"
            onClick={handleBack}
            className="flex items-center justify-center w-11 h-11 rounded-full hover:bg-white/60 active:scale-95 transition-all duration-200 z-10"
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

          <div className="absolute left-1/2 transform -translate-x-1/2 text-lg font-semibold tracking-tight text-[#7b4ea3]">
            Nail Salon No.5
          </div>
        </div>

        {/* Title section */}
        <div
          className="text-center pt-4 pb-6"
          style={{
            opacity: mounted ? 1 : 0,
            transform: mounted ? "translateY(0)" : "translateY(10px)",
            transition:
              "opacity 300ms ease-out 100ms, transform 300ms ease-out 100ms",
          }}
        >
          <h1 className="text-3xl font-bold tracking-tight text-[#7b4ea3]">
            {t("title")}
          </h1>
          <p className="text-base text-neutral-500 mt-1">
            {t("welcome", { name: "Sarah" })} ✨
          </p>
        </div>

        {/* Points Summary Card */}
        <div
          className="mb-6 overflow-hidden rounded-2xl bg-gradient-to-br from-[#7b4ea3] to-[#5c3a7d] shadow-xl"
          style={{
            opacity: mounted ? 1 : 0,
            transform: mounted
              ? "translateY(0) scale(1)"
              : "translateY(10px) scale(0.97)",
            transition:
              "opacity 300ms ease-out 150ms, transform 300ms ease-out 150ms",
          }}
        >
          <div className="px-6 py-5">
            <div className="flex items-center justify-between mb-4">
              <div>
                <div className="text-sm text-white/70">Your Points</div>
                <div className="text-4xl font-bold text-white">{totalPoints}</div>
              </div>
              <div className="w-16 h-16 rounded-full bg-white/20 flex items-center justify-center">
                <span className="text-3xl">💎</span>
              </div>
            </div>
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-white/70">
                  {nextRewardPoints - totalPoints} pts to FREE BIAB Fill
                </span>
                <span className="text-[#f4b864] font-semibold">
                  {nextRewardPoints} pts
                </span>
              </div>
              <div className="h-2 bg-white/20 rounded-full overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-[#f4b864] to-[#d6a249] rounded-full transition-all duration-700"
                  style={{ width: mounted ? `${progressPercent}%` : "0%" }}
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
            transition: "opacity 300ms ease-out 200ms",
          }}
        >
          <h2 className="text-lg font-bold text-neutral-900 px-1 mb-3">
            {t("your_rewards")}
          </h2>
          <div className="grid grid-cols-2 gap-3">
            {activeRewards.map((reward, index) => (
              <button
                key={reward.id}
                type="button"
                onClick={() =>
                  setSelectedReward(
                    selectedReward === reward.id ? null : reward.id
                  )
                }
                className={`p-4 rounded-2xl text-left transition-all duration-200 ${
                  selectedReward === reward.id
                    ? "bg-gradient-to-br from-[#f4b864] to-[#d6a249] shadow-lg scale-[1.02]"
                    : "bg-white border border-[#e6d6c2] shadow-[0_4px_20px_rgba(0,0,0,0.06)] hover:shadow-md hover:scale-[1.01]"
                }`}
                style={{
                  opacity: mounted ? 1 : 0,
                  transform: mounted
                    ? "translateY(0)"
                    : "translateY(10px)",
                  transition: `opacity 300ms ease-out ${250 + index * 50}ms, transform 300ms ease-out ${250 + index * 50}ms`,
                }}
              >
                <div className="text-2xl mb-2">{reward.icon}</div>
                <div
                  className={`text-lg font-bold ${
                    selectedReward === reward.id
                      ? "text-neutral-900"
                      : "text-neutral-900"
                  }`}
                >
                  {reward.label}
                </div>
                <div
                  className={`text-sm ${
                    selectedReward === reward.id
                      ? "text-neutral-700"
                      : "text-neutral-500"
                  }`}
                >
                  {reward.description}
                </div>
                {selectedReward === reward.id && (
                  <div className="mt-2 text-xs font-bold text-neutral-800 flex items-center gap-1">
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
            ))}
          </div>
        </div>

        {/* Apply to Appointment Card */}
        <div
          className="mb-6 overflow-hidden rounded-2xl bg-white border border-[#e6d6c2] shadow-[0_4px_20px_rgba(0,0,0,0.06)]"
          style={{
            opacity: mounted ? 1 : 0,
            transform: mounted
              ? "translateY(0) scale(1)"
              : "translateY(10px) scale(0.97)",
            transition:
              "opacity 300ms ease-out 350ms, transform 300ms ease-out 350ms",
          }}
        >
          <div
            className="h-1 bg-gradient-to-r from-[#d6a249] to-[#f4b864]"
            style={{
              width: mounted ? "100%" : "0%",
              transition: "width 500ms ease-out 400ms",
            }}
          />
          <div className="p-5">
            <h3 className="text-lg font-bold text-neutral-900 mb-4">
              {t("apply_to_appointment")}
            </h3>

            {/* Appointment Preview */}
            <div className="flex items-center gap-4 p-4 rounded-xl bg-[#f8f0e5] mb-4">
              <div className="w-14 h-14 rounded-xl bg-white shadow-sm overflow-hidden flex-shrink-0">
                <img
                  src="/assets/images/biab-medium.webp"
                  alt={appointmentDetails.service}
                  className="w-full h-full object-cover"
                  onError={(e) => {
                    e.currentTarget.style.display = "none";
                  }}
                />
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-bold text-neutral-900">
                  {appointmentDetails.service}
                </div>
                <div className="text-sm text-neutral-600 flex items-center gap-1">
                  <span className="text-[#7b4ea3]">✦</span>
                  {appointmentDetails.techName}
                </div>
                <div className="text-sm text-neutral-500">
                  {appointmentDetails.displayDate} · {appointmentDetails.displayTime}
                </div>
              </div>
            </div>

            {/* Price Breakdown */}
            {rewardApplied ? (
              <div className="space-y-3 p-4 rounded-xl bg-gradient-to-br from-emerald-50 to-emerald-100 border border-emerald-200 mb-4">
                <div className="flex justify-between items-center">
                  <span className="text-neutral-600">{t("original_price")}</span>
                  <span className="font-semibold text-neutral-700">
                    ${appointmentDetails.originalPrice}
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-neutral-600">{t("reward_applied_label")}</span>
                  <span className="font-bold text-emerald-600">
                    -${discountAmount}
                  </span>
                </div>
                <div className="flex justify-between items-center pt-3 border-t border-emerald-200">
                  <span className="text-lg font-bold text-neutral-900">
                    {t("new_total")}
                  </span>
                  <span className="text-2xl font-bold text-[#7b4ea3]">
                    ${finalPrice}
                  </span>
                </div>
              </div>
            ) : (
              <div className="flex justify-between items-center p-4 rounded-xl bg-neutral-50 mb-4">
                <span className="text-neutral-600">Service Price</span>
                <span className="text-xl font-bold text-neutral-900">
                  ${appointmentDetails.originalPrice}
                </span>
              </div>
            )}

            {/* Apply Button */}
            <button
              type="button"
              onClick={handleApplyReward}
              disabled={!selectedReward || rewardApplied}
              className={`w-full rounded-full px-6 py-3.5 text-lg font-bold shadow-sm transition-all duration-200 ease-out ${
                rewardApplied
                  ? "bg-emerald-500 text-white"
                  : selectedReward
                  ? "bg-gradient-to-r from-[#f4b864] to-[#d6a249] text-neutral-900 hover:scale-[1.02] hover:shadow-md active:scale-[0.98]"
                  : "bg-neutral-200 text-neutral-400 cursor-not-allowed"
              }`}
            >
              {rewardApplied ? "✓ " + t("reward_applied") : t("apply_reward")}
            </button>

            {rewardApplied && (
              <p className="text-base text-center text-emerald-600 font-medium mt-3">
                {t("reward_applied_success")}
              </p>
            )}

            <button
              type="button"
              onClick={() =>
                router.push(
                  `/${locale}/change-appointment?serviceIds=${appointmentDetails.serviceId}&techId=${appointmentDetails.techId}&date=${appointmentDetails.date}&time=${appointmentDetails.time}`
                )
              }
              className="w-full text-base font-medium text-[#7b4ea3] hover:text-[#7b4ea3]/80 transition-colors mt-4"
            >
              {t("change_appointment")}
            </button>
          </div>
        </div>

        {/* Earn More Rewards Card */}
        <div
          className="mb-6 overflow-hidden rounded-2xl bg-white border border-[#e6d6c2] shadow-[0_4px_20px_rgba(0,0,0,0.06)]"
          style={{
            opacity: mounted ? 1 : 0,
            transform: mounted
              ? "translateY(0) scale(1)"
              : "translateY(10px) scale(0.97)",
            transition:
              "opacity 300ms ease-out 400ms, transform 300ms ease-out 400ms",
          }}
        >
          <div className="p-5">
            <h3 className="text-lg font-bold text-neutral-900 mb-2">
              {t("earn_more_rewards")}
            </h3>
            <p className="text-base text-neutral-600 mb-5">
              {t("earn_more_description")}
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
                className="w-full flex items-center justify-center gap-3 rounded-full bg-gradient-to-r from-[#f4b864] to-[#d6a249] px-6 py-3.5 text-lg font-bold text-neutral-900 shadow-sm transition-all duration-200 hover:scale-[1.02] hover:shadow-md active:scale-[0.98]"
              >
                <span className="text-xl">📸</span>
                {t("upload_photo")}
              </button>

              {uploadStatus && (
                <p
                  className={`text-base text-center font-medium ${
                    uploadStatus.success ? "text-emerald-600" : "text-red-600"
                  }`}
                >
                  {uploadStatus.message}
                </p>
              )}

              <button
                type="button"
                onClick={handleGoogleReview}
                className="w-full flex items-center justify-center gap-3 rounded-full bg-white border-2 border-[#e6d6c2] px-6 py-3.5 text-lg font-bold text-neutral-700 shadow-sm transition-all duration-200 hover:bg-neutral-50 hover:scale-[1.02] active:scale-[0.98]"
              >
                <span className="text-xl">⭐</span>
                {t("leave_google_review")}
              </button>
            </div>
          </div>
        </div>

        {/* Past Nails Gallery */}
        <div
          className="mb-6"
          style={{
            opacity: mounted ? 1 : 0,
            transition: "opacity 300ms ease-out 450ms",
          }}
        >
          <div className="flex items-center justify-between px-1 mb-3">
            <h2 className="text-lg font-bold text-neutral-900">
              {t("your_past_nails")}
            </h2>
            <button
              type="button"
              onClick={() => router.push(`/${locale}/gallery`)}
              className="text-sm font-semibold text-[#7b4ea3] hover:text-[#7b4ea3]/80 transition-colors"
            >
              {t("view_all_photos")} →
            </button>
          </div>
          <div className="grid grid-cols-3 gap-3">
            {[
              { id: "1", imageUrl: "/assets/images/gel-x-extensions.jpg" },
              { id: "2", imageUrl: "/assets/images/biab-medium.webp" },
              { id: "3", imageUrl: "/assets/images/biab-french.jpg" },
            ].map((photo, index) => (
              <button
                key={photo.id}
                type="button"
                onClick={() => router.push(`/${locale}/gallery`)}
                className="aspect-square rounded-2xl bg-gradient-to-br from-[#f0dfc9] to-[#d9c6aa] hover:scale-[1.03] transition-all duration-200 relative overflow-hidden shadow-md"
                style={{
                  opacity: mounted ? 1 : 0,
                  transform: mounted ? "scale(1)" : "scale(0.9)",
                  transition: `opacity 300ms ease-out ${500 + index * 50}ms, transform 300ms ease-out ${500 + index * 50}ms`,
                }}
              >
                <img
                  src={photo.imageUrl}
                  alt="Past nails"
                  className="w-full h-full object-cover"
                  onError={(e) => {
                    e.currentTarget.style.display = "none";
                  }}
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
