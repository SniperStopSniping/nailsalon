"use client";

import { useParams, useRouter } from "next/navigation";
import { useState, useEffect } from "react";
import { useTranslations } from "next-intl";
import { PageLayout } from "@/components/PageLayout";
import { MainCard } from "@/components/MainCard";
import { PrimaryButton } from "@/components/PrimaryButton";
import { SecondaryButton } from "@/components/SecondaryButton";
import { FormInput } from "@/components/FormInput";

export default function InvitePage() {
  const router = useRouter();
  const params = useParams();
  const locale = (params?.locale as string) || "en";
  const t = useTranslations("Invite");

  const [friendPhone, setFriendPhone] = useState("");
  const [referralSent, setReferralSent] = useState(false);
  const [copied, setCopied] = useState(false);

  const referralLink = "https://nailsalon5.com/invite/NO5-SARAH-123";

  const handleSendReferral = () => {
    if (!friendPhone.trim()) return;
    setReferralSent(true);
    setTimeout(() => setReferralSent(false), 3000);
  };

  const handleCopyLink = async () => {
    try {
      await navigator.clipboard.writeText(referralLink);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error("Failed to copy:", err);
    }
  };

  const handleBack = () => {
    router.back();
  };

  const isValidPhone = (phone: string) => {
    const digits = phone.replace(/\D/g, "");
    return digits.length >= 10;
  };

  useEffect(() => {
    const digits = friendPhone.replace(/\D/g, "");
    if (digits.length === 10) {
      handleSendReferral();
    }
  }, [friendPhone]);

  return (
    <PageLayout>
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

        <div className="absolute left-1/2 transform -translate-x-1/2 text-xl font-semibold text-[#7b4ea3]">
          Nail Salon No.5
        </div>
      </div>

      {/* Title section */}
      <div className="text-center pt-2">
        <h1 className="text-3xl font-semibold text-[#7b4ea3]">{t("title")}</h1>
        <p className="text-sm text-neutral-600 mt-1">{t("subtitle")}</p>
      </div>

      {/* Main card */}
      <MainCard>
        <p className="text-sm text-center text-neutral-700 leading-relaxed pb-6">
          {t("description")}
        </p>

        <div className="space-y-3 pb-4">
          <label className="text-sm font-medium text-neutral-900">
            {t("friends_phone")}
          </label>
          <div className="flex items-center gap-2">
            <div className="flex items-center rounded-full bg-neutral-100 px-2.5 py-1.5 text-xs text-neutral-600">
              <span className="mr-1">+1</span>
            </div>
            <FormInput
              type="tel"
              value={friendPhone}
              onChange={(e) => {
                const digits = e.target.value.replace(/\D/g, "");
                setFriendPhone(digits.slice(0, 10));
              }}
              placeholder="Phone number"
              className="!px-3 !py-2 !text-base"
            />
          </div>
        </div>

        <PrimaryButton
          onClick={handleSendReferral}
          disabled={!isValidPhone(friendPhone)}
          size="sm"
        >
          {t("send_referral")}
        </PrimaryButton>

        {referralSent && (
          <p className="text-xs text-center text-green-600 mt-3">
            {t("referral_sent")}
          </p>
        )}

        <div className="flex items-center gap-3 py-6">
          <div className="flex-1 h-px bg-neutral-200" />
          <span className="text-xs text-neutral-500">{t("or")}</span>
          <div className="flex-1 h-px bg-neutral-200" />
        </div>

        <SecondaryButton
          onClick={handleCopyLink}
          size="sm"
        >
          {t("copy_referral_link")}
        </SecondaryButton>

        {copied && (
          <p className="text-xs text-center text-green-600 mt-3">
            {t("link_copied")}
          </p>
        )}
      </MainCard>

      {/* Google review section */}
      <div className="space-y-3">
        <p className="text-sm text-center text-neutral-600">
          Love your nails? Help us grow by leaving a review!
        </p>
        <PrimaryButton
          onClick={() => {
            window.open(
              "https://www.google.com/maps/place/Nail+Salon+No.5",
              "_blank"
            );
          }}
          size="sm"
        >
          ⭐ Leave a Google Review
        </PrimaryButton>
      </div>

      {/* My referrals link */}
      <div className="pt-2">
        <button
          type="button"
          onClick={() => router.push(`/${locale}/my-referrals`)}
          className="w-full text-sm text-[#7b4ea3] font-medium hover:text-[#7b4ea3]/80 transition-colors"
        >
          {t("my_referrals")}
        </button>
      </div>
    </PageLayout>
  );
}
