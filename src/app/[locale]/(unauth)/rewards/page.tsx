"use client";

import { useParams, useRouter } from "next/navigation";
import { useState, useRef, useEffect } from "react";
import { useTranslations } from "next-intl";

type Reward = {
  id: string;
  label: string;
  isActive: boolean;
};

const USER_REWARDS: Reward[] = [
  { id: "5-off", label: "$5 OFF", isActive: true },
  { id: "10-off", label: "$10 OFF", isActive: true },
  { id: "free-biab", label: "FREE BIAB Fill", isActive: false },
  { id: "vip", label: "VIP Priority", isActive: true },
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
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Appointment details
  const appointmentDetails = {
    service: "BIAB Medium",
    date: "Dec 18",
    time: "2:00 PM",
    originalPrice: 75,
  };

  // Calculate discount based on selected reward
  const getDiscountAmount = () => {
    if (!selectedReward) return 0;
    const reward = USER_REWARDS.find((r) => r.id === selectedReward);
    if (!reward) return 0;

    if (reward.label === "$5 OFF") return 5;
    if (reward.label === "$10 OFF") return 10;
    if (reward.label === "FREE BIAB Fill") return appointmentDetails.originalPrice;
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
    if (!selectedReward) return;
    // TODO: Apply reward to appointment via backend
    console.log("Applying reward:", selectedReward);
    setRewardApplied(true);
  };

  const handleUploadPhoto = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Validate file type
    if (!file.type.startsWith("image/")) {
      setUploadStatus({
        success: false,
        message: t("invalid_image"),
      });
      setTimeout(() => setUploadStatus(null), 3000);
      return;
    }

    // Validate file size (max 10MB)
    if (file.size > 10 * 1024 * 1024) {
      setUploadStatus({
        success: false,
        message: t("image_too_large"),
      });
      setTimeout(() => setUploadStatus(null), 3000);
      return;
    }

    // TODO: Upload to backend
    console.log("Uploading photo:", file.name);
    setUploadStatus({
      success: true,
      message: t("photo_uploaded"),
    });

    // Reset input
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }

    // Clear success message after 3 seconds
    setTimeout(() => {
      setUploadStatus(null);
    }, 3000);
  };

  const handleGoogleReview = () => {
    // TODO: Open Google review link
    console.log("TODO: Open Google review");
    window.open(
      "https://www.google.com/maps/place/Nail+Salon+No.5",
      "_blank"
    );
  };

  const activeRewards = USER_REWARDS.filter((r) => r.isActive);

  return (
    <div className="min-h-screen bg-[#f6ebdd] flex justify-center py-4">
      <div className="mx-auto max-w-[430px] w-full px-4 flex flex-col gap-4">
        {/* Top bar with back button */}
        <div className="pt-2 relative flex items-center">
          <button
            type="button"
            onClick={handleBack}
            className="flex items-center justify-center w-10 h-10 rounded-full hover:bg-white/50 active:scale-95 transition-all duration-150 z-10"
          >
            <svg
              width="20"
              height="20"
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
          <div className="absolute left-1/2 transform -translate-x-1/2 text-xl font-semibold text-[#7b4ea3]">
            Nail Salon No.5
          </div>
        </div>

        {/* Title section */}
        <div className="text-center pt-2">
          <h1 className="text-2xl font-bold text-neutral-900">{t("title")}</h1>
          <p className="text-sm text-neutral-600 mt-1">{t("welcome", { name: "Sarah" })}</p>
        </div>

        {/* Main Card: Rewards + Apply to Appointment */}
        <div className="rounded-xl bg-white shadow-[0_1px_3px_rgba(0,0,0,0.08)] p-5">
          {/* Reward Pills Section */}
          {activeRewards.length > 0 && (
            <div className="space-y-3 pb-5">
              <h2 className="text-sm font-semibold text-neutral-900">
                {t("your_rewards")}
              </h2>
              <div className="flex flex-wrap gap-2">
                {activeRewards.map((reward) => (
                  <button
                    key={reward.id}
                    type="button"
                    onClick={() =>
                      setSelectedReward(
                        selectedReward === reward.id ? null : reward.id
                      )
                    }
                    className={`px-4 py-2 rounded-full text-xs font-semibold transition-all duration-150 ${
                      selectedReward === reward.id
                        ? "bg-[#f4b864] text-neutral-900 ring-2 ring-[#d6a249] ring-offset-1 ring-offset-white"
                        : "bg-neutral-50 text-neutral-700 hover:bg-neutral-100"
                    } shadow-sm`}
                  >
                    {reward.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Divider */}
          <div className="h-px bg-neutral-200 my-5" />

          {/* Apply to Appointment Section */}
          <div className="space-y-4 pt-1">
            <div>
              <h3 className="text-sm font-semibold text-neutral-900">
                {t("apply_to_appointment")}
              </h3>
              <p className="text-xs text-neutral-600 mt-1.5">
                {appointmentDetails.service} · {appointmentDetails.date} ·{" "}
                {appointmentDetails.time}
              </p>
            </div>

            {/* Price breakdown */}
            {rewardApplied && (
              <div className="space-y-2 rounded-xl bg-[#fff7ec] p-3">
                <div className="flex justify-between items-center text-xs">
                  <span className="text-neutral-600">{t("original_price")}</span>
                  <span className="text-neutral-900 font-semibold">
                    ${appointmentDetails.originalPrice}
                  </span>
                </div>
                <div className="flex justify-between items-center text-xs">
                  <span className="text-neutral-600">{t("reward_applied_label")}</span>
                  <span className="text-green-600 font-semibold">
                    -${discountAmount}
                  </span>
                </div>
                <div className="border-t border-neutral-200 pt-2 flex justify-between items-center">
                  <span className="text-sm font-semibold text-neutral-900">
                    {t("new_total")}
                  </span>
                  <span className="text-sm font-bold text-neutral-900">
                    ${finalPrice.toFixed(2)}
                  </span>
                </div>
              </div>
            )}

            <button
              type="button"
              onClick={handleApplyReward}
              disabled={!selectedReward || rewardApplied}
              className="w-full rounded-full bg-[#f4b864] py-3 text-sm font-semibold text-neutral-900 hover:bg-[#f4b864]/90 active:scale-[0.98] transition-all duration-150 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {rewardApplied ? t("reward_applied") : t("apply_reward")}
            </button>

            {rewardApplied && (
              <p className="text-xs text-center text-green-600">
                {t("reward_applied_success")}
              </p>
            )}

            <button
              type="button"
              onClick={() => router.push(`/${locale}/change-appointment`)}
              className="w-full text-xs text-neutral-500 underline hover:text-neutral-700 transition-colors"
            >
              {t("change_appointment")}
            </button>
          </div>
        </div>

        {/* Earn More Rewards Card */}
        <div className="rounded-xl bg-white shadow-[0_1px_3px_rgba(0,0,0,0.08)] p-5 space-y-4">
          <div>
            <h3 className="text-sm font-semibold text-neutral-900">
              {t("earn_more_rewards")}
            </h3>
            <p className="text-sm text-neutral-700 leading-relaxed mt-2">
              {t("earn_more_description")}
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

          <button
            type="button"
            onClick={handleUploadPhoto}
            className="w-full rounded-full bg-[#f4b864] py-3 text-sm font-semibold text-neutral-900 hover:bg-[#f4b864]/90 active:scale-[0.98] transition-all duration-150 shadow-sm"
          >
            {t("upload_photo")}
          </button>

          {uploadStatus && (
            <p
              className={`text-xs text-center ${
                uploadStatus.success
                  ? "text-green-600"
                  : "text-red-600"
              }`}
            >
              {uploadStatus.message}
            </p>
          )}

          <button
            type="button"
            onClick={handleGoogleReview}
            className="w-full rounded-full bg-white border-2 border-neutral-200 py-3 text-sm font-semibold text-neutral-900 hover:bg-neutral-50 active:scale-[0.98] transition-all duration-150"
          >
            {t("leave_google_review")}
          </button>
        </div>

        {/* Past Nails Preview */}
        <div className="space-y-3.5">
          <h2 className="text-sm font-semibold text-neutral-900 px-1">
            {t("your_past_nails")}
          </h2>
          <div className="grid grid-cols-3 gap-2.5">
            {[
              {
                id: "2",
                imageUrl: "/assets/images/gel-x-extensions.jpg",
              },
              {
                id: "3",
                imageUrl: "/assets/images/biab-medium.webp",
              },
              {
                id: "4",
                imageUrl: "/assets/images/biab-french.jpg",
              },
            ].map((photo) => (
              <button
                key={photo.id}
                type="button"
                onClick={() => router.push(`/${locale}/gallery`)}
                className="aspect-square rounded-xl bg-gradient-to-br from-[#f0dfc9] to-[#d9c6aa] hover:opacity-90 transition-opacity relative overflow-hidden"
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
          <button
            type="button"
            onClick={() => router.push(`/${locale}/gallery`)}
            className="w-full text-sm text-[#7b4ea3] font-medium hover:text-[#7b4ea3]/80 transition-colors pt-1"
          >
            {t("view_all_photos")}
          </button>
        </div>
      </div>
    </div>
  );
}

