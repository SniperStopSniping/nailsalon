"use client";

import { useParams, useRouter } from "next/navigation";
import { useState, useEffect } from "react";
import { useTranslations } from "next-intl";

export default function InvitePage() {
  const router = useRouter();
  const params = useParams();
  const locale = (params?.locale as string) || "en";
  const t = useTranslations("Invite");

  const [friendPhone, setFriendPhone] = useState("");
  const [referralSent, setReferralSent] = useState(false);
  const [copied, setCopied] = useState(false);
  const [mounted, setMounted] = useState(false);

  const referralLink = "https://nailsalon5.com/invite/NO5-SARAH-123";

  useEffect(() => {
    setMounted(true);
  }, []);

  const handleSendReferral = () => {
    if (!friendPhone.trim()) return;
    setReferralSent(true);
    setTimeout(() => {
      setReferralSent(false);
      setFriendPhone("");
    }, 3000);
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
    if (digits.length === 10 && !referralSent) {
      handleSendReferral();
    }
  }, [friendPhone]);

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
          <p className="text-base text-neutral-500 mt-1 italic">
            {t("subtitle")}
          </p>
        </div>

        {/* Rewards Preview Card */}
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
            <div className="flex items-center justify-center gap-8">
              <div className="text-center">
                <div className="w-16 h-16 mx-auto mb-2 rounded-full bg-white/20 flex items-center justify-center">
                  <span className="text-3xl">🎁</span>
                </div>
                <div className="text-2xl font-bold text-[#f4b864]">$15</div>
                <div className="text-sm text-white/70 mt-0.5">
                  {t("your_reward")}
                </div>
              </div>
              <div className="text-4xl text-white/30">+</div>
              <div className="text-center">
                <div className="w-16 h-16 mx-auto mb-2 rounded-full bg-white/20 flex items-center justify-center">
                  <span className="text-3xl">💅</span>
                </div>
                <div className="text-2xl font-bold text-white">$10</div>
                <div className="text-sm text-white/70 mt-0.5">
                  {t("friend_reward")}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Main Invite Card */}
        <div
          className="mb-6 overflow-hidden rounded-2xl bg-white border border-[#e6d6c2] shadow-[0_4px_20px_rgba(0,0,0,0.06)]"
          style={{
            opacity: mounted ? 1 : 0,
            transform: mounted
              ? "translateY(0) scale(1)"
              : "translateY(10px) scale(0.97)",
            transition:
              "opacity 300ms ease-out 200ms, transform 300ms ease-out 200ms",
          }}
        >
          <div
            className="h-1 bg-gradient-to-r from-[#d6a249] to-[#f4b864]"
            style={{
              width: mounted ? "100%" : "0%",
              transition: "width 500ms ease-out 300ms",
            }}
          />
          <div className="p-5">
            <p className="text-base text-center text-neutral-600 leading-relaxed mb-6">
              {t("description")}
            </p>

            {/* Phone Input Section */}
            <div className="space-y-3 mb-5">
              <label className="text-sm font-bold text-neutral-900">
                {t("friends_phone")}
              </label>
              <div className="flex items-center gap-2">
                <div className="flex items-center rounded-full bg-neutral-100 px-3 py-2.5 text-sm font-medium text-neutral-600">
                  <span>+1</span>
                </div>
                <input
                  type="tel"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  value={friendPhone}
                  onChange={(e) => {
                    const digits = e.target.value.replace(/\D/g, "");
                    setFriendPhone(digits.slice(0, 10));
                  }}
                  placeholder="(555) 123-4567"
                  className="flex-1 min-w-0 rounded-full bg-neutral-100 px-4 py-2.5 text-base text-neutral-800 placeholder:text-neutral-400 outline-none focus:ring-2 focus:ring-[#7b4ea3]/30 transition-all"
                />
              </div>
            </div>

            {/* Send Button */}
            <button
              type="button"
              onClick={handleSendReferral}
              disabled={!isValidPhone(friendPhone) || referralSent}
              className="w-full rounded-full bg-gradient-to-r from-[#f4b864] to-[#d6a249] px-6 py-3.5 text-lg font-bold text-neutral-900 shadow-sm transition-all duration-200 ease-out hover:scale-[1.02] hover:shadow-md active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100"
            >
              {referralSent ? "✓ Sent!" : t("send_referral")}
            </button>

            {referralSent && (
              <p className="text-base text-center text-emerald-600 font-medium mt-3 animate-pulse">
                {t("referral_sent")}
              </p>
            )}

            {/* Divider */}
            <div className="flex items-center gap-4 py-6">
              <div className="flex-1 h-px bg-neutral-200" />
              <span className="text-sm font-medium text-neutral-400 uppercase tracking-wide">
                {t("or")}
              </span>
              <div className="flex-1 h-px bg-neutral-200" />
            </div>

            {/* Copy Link Section */}
            <div className="space-y-3">
              <div className="flex items-center gap-2 p-3 rounded-xl bg-neutral-50 border border-neutral-200">
                <div className="flex-1 truncate text-sm text-neutral-600 font-mono">
                  {referralLink}
                </div>
                <button
                  type="button"
                  onClick={handleCopyLink}
                  className="flex-shrink-0 rounded-lg bg-[#7b4ea3] px-4 py-2 text-sm font-bold text-white transition-all hover:bg-[#6a4090] active:scale-95"
                >
                  {copied ? "✓" : "Copy"}
                </button>
              </div>
              {copied && (
                <p className="text-base text-center text-emerald-600 font-medium animate-pulse">
                  {t("link_copied")}
                </p>
              )}
            </div>
          </div>
        </div>

        {/* How It Works Card */}
        <div
          className="mb-6 overflow-hidden rounded-2xl bg-white border border-[#e6d6c2] shadow-[0_4px_20px_rgba(0,0,0,0.06)]"
          style={{
            opacity: mounted ? 1 : 0,
            transform: mounted
              ? "translateY(0) scale(1)"
              : "translateY(10px) scale(0.97)",
            transition:
              "opacity 300ms ease-out 250ms, transform 300ms ease-out 250ms",
          }}
        >
          <div className="p-5">
            <h2 className="text-lg font-bold text-neutral-900 mb-4">
              {t("how_it_works")}
            </h2>
            <div className="space-y-4">
              <div className="flex items-start gap-4">
                <div className="w-10 h-10 rounded-full bg-[#f6ebdd] flex items-center justify-center flex-shrink-0 text-lg font-bold text-[#7b4ea3]">
                  1
                </div>
                <div>
                  <div className="font-semibold text-neutral-900">
                    Share Your Link
                  </div>
                  <div className="text-sm text-neutral-500 mt-0.5">
                    Send your unique referral link to friends
                  </div>
                </div>
              </div>
              <div className="flex items-start gap-4">
                <div className="w-10 h-10 rounded-full bg-[#f6ebdd] flex items-center justify-center flex-shrink-0 text-lg font-bold text-[#7b4ea3]">
                  2
                </div>
                <div>
                  <div className="font-semibold text-neutral-900">
                    They Book & Visit
                  </div>
                  <div className="text-sm text-neutral-500 mt-0.5">
                    Your friend gets $10 off their first appointment
                  </div>
                </div>
              </div>
              <div className="flex items-start gap-4">
                <div className="w-10 h-10 rounded-full bg-gradient-to-br from-[#f4b864] to-[#d6a249] flex items-center justify-center flex-shrink-0 text-lg font-bold text-white">
                  3
                </div>
                <div>
                  <div className="font-semibold text-neutral-900">
                    You Earn $15
                  </div>
                  <div className="text-sm text-neutral-500 mt-0.5">
                    Credit added automatically after their visit
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Google Review Card */}
        <div
          className="mb-6 overflow-hidden rounded-2xl bg-gradient-to-br from-[#fff7ec] to-[#fef5e7] border border-[#e6d6c2] shadow-[0_4px_20px_rgba(0,0,0,0.06)]"
          style={{
            opacity: mounted ? 1 : 0,
            transform: mounted
              ? "translateY(0) scale(1)"
              : "translateY(10px) scale(0.97)",
            transition:
              "opacity 300ms ease-out 300ms, transform 300ms ease-out 300ms",
          }}
        >
          <div className="p-5 text-center">
            <div className="text-3xl mb-2">⭐</div>
            <p className="text-base text-neutral-700 font-medium mb-4">
              Love your nails? Help us grow by leaving a review!
            </p>
            <button
              type="button"
              onClick={() => {
                window.open(
                  "https://www.google.com/maps/place/Nail+Salon+No.5",
                  "_blank"
                );
              }}
              className="w-full rounded-full bg-white border-2 border-[#d6a249] px-6 py-3 text-base font-bold text-[#7b4ea3] shadow-sm transition-all duration-200 hover:bg-[#fff7ec] hover:scale-[1.02] active:scale-[0.98]"
            >
              Leave a Google Review
            </button>
          </div>
        </div>

        {/* My Referrals Link */}
        <button
          type="button"
          onClick={() => router.push(`/${locale}/my-referrals`)}
          className="w-full text-base font-bold text-[#7b4ea3] hover:text-[#7b4ea3]/80 transition-colors py-2"
          style={{
            opacity: mounted ? 1 : 0,
            transition: "opacity 300ms ease-out 350ms",
          }}
        >
          {t("my_referrals")} →
        </button>

        {/* Bottom spacing */}
        <div className="h-6" />
      </div>
    </div>
  );
}
