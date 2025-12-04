'use client';

import { useParams, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

import { useSalon } from '@/providers/SalonProvider';
import { themeVars } from '@/theme';

export default function InvitePage() {
  const router = useRouter();
  const params = useParams();
  const { salonName } = useSalon();
  const locale = (params?.locale as string) || 'en';

  const [friendPhone, setFriendPhone] = useState('');
  const [referralSent, setReferralSent] = useState(false);
  const [copied, setCopied] = useState(false);

  const referralLink = 'https://nailsalon5.com/invite/NO5-SARAH-123';

  const handleSendReferral = () => {
    if (!friendPhone.trim()) {
      return;
    }
    // TODO: Send referral via backend
    setReferralSent(true);
    setTimeout(() => setReferralSent(false), 3000);
  };

  const handleCopyLink = async () => {
    try {
      await navigator.clipboard.writeText(referralLink);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard API failed
    }
  };

  const handleBack = () => {
    router.back();
  };

  const isValidPhone = (phone: string) => {
    // Simple validation: at least 10 digits
    const digits = phone.replace(/\D/g, '');
    return digits.length >= 10;
  };

  // Auto-send referral when phone number is complete (10 digits)
  useEffect(() => {
    const digits = friendPhone.replace(/\D/g, '');
    if (digits.length === 10) {
      // Auto-send when complete
      setReferralSent(true);
      setTimeout(() => setReferralSent(false), 3000);
    }
  }, [friendPhone]);

  return (
    <div
      className="flex min-h-screen justify-center py-4"
      style={{ backgroundColor: themeVars.background }}
    >
      <div className="mx-auto flex w-full max-w-[430px] flex-col gap-4 px-4">
        {/* Top bar with back button */}
        <div className="relative flex items-center pt-2">
          <button
            type="button"
            onClick={handleBack}
            className="z-10 flex size-10 items-center justify-center rounded-full transition-all duration-150 hover:bg-white/50 active:scale-95"
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
          <div
            className="absolute left-1/2 -translate-x-1/2 text-xl font-semibold"
            style={{ color: themeVars.accent }}
          >
            {salonName}
          </div>
        </div>

        {/* Title section */}
        <div className="pt-2 text-center">
          <h1 className="text-2xl font-bold text-neutral-900">Invite & Earn</h1>
          <p className="mt-1 text-sm text-neutral-600">
            Share the love, get rewarded
          </p>
        </div>

        {/* Main card */}
        <div className="rounded-xl bg-white p-5 shadow-[0_1px_3px_rgba(0,0,0,0.08)]">
          {/* Explanation */}
          <p className="pb-6 text-center text-sm leading-relaxed text-neutral-700">
            Invite your friends to try our salon. When they book their first appointment, you both get a free manicure!
          </p>

          {/* Friend's phone input */}
          <div className="space-y-3 pb-4">
            <label className="text-sm font-medium text-neutral-900">
              Friend's Phone Number
            </label>
            <div className="flex items-center gap-2">
              <div className="flex items-center rounded-full bg-neutral-100 px-2.5 py-1.5 text-xs text-neutral-600">
                <span className="mr-1">+1</span>
              </div>
              <input
                type="tel"
                value={friendPhone}
                onChange={(e) => {
                  const digits = e.target.value.replace(/\D/g, '');
                  setFriendPhone(digits.slice(0, 10));
                }}
                placeholder="Phone number"
                className="flex-1 rounded-full bg-neutral-100 px-3 py-2 text-sm text-neutral-800 outline-none placeholder:text-neutral-400"
              />
            </div>
          </div>

          {/* Send referral button */}
          <button
            type="button"
            onClick={handleSendReferral}
            disabled={!isValidPhone(friendPhone)}
            className="w-full rounded-full py-3 text-sm font-semibold text-neutral-900 transition-all duration-150 hover:opacity-90 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
            style={{ backgroundColor: themeVars.primary }}
          >
            Send Referral
          </button>

          {referralSent && (
            <p className="mt-3 text-center text-xs text-green-600">
              Referral sent successfully!
            </p>
          )}

          {/* Divider */}
          <div className="flex items-center gap-3 py-6">
            <div className="h-px flex-1 bg-neutral-200" />
            <span className="text-xs text-neutral-500">or</span>
            <div className="h-px flex-1 bg-neutral-200" />
          </div>

          {/* Copy referral link button */}
          <button
            type="button"
            onClick={handleCopyLink}
            className="w-full rounded-full border-2 border-neutral-200 bg-white py-3 text-sm font-semibold text-neutral-900 transition-all duration-150 hover:bg-neutral-50 active:scale-[0.98]"
          >
            Copy Referral Link
          </button>

          {copied && (
            <p className="mt-3 text-center text-xs text-green-600">
              Link copied to clipboard!
            </p>
          )}
        </div>

        {/* Google review section */}
        <div className="space-y-3">
          <p className="text-center text-sm text-neutral-600">
            Love your nails? Help us grow by leaving a review!
          </p>
          <button
            type="button"
            onClick={() => {
              window.open(
                'https://www.google.com/maps/place/Nail+Salon+No.5',
                '_blank',
              );
            }}
            className="w-full rounded-full py-3 text-sm font-semibold text-neutral-900 shadow-sm transition-all duration-150 hover:opacity-90 active:scale-[0.98]"
            style={{ backgroundColor: themeVars.primary }}
          >
            ⭐ Leave a Google Review
          </button>
        </div>

        {/* My referrals link */}
        <div className="pt-2">
          <button
            type="button"
            onClick={() => router.push(`/${locale}/my-referrals`)}
            className="w-full text-sm font-medium transition-colors hover:opacity-80"
            style={{ color: themeVars.accent }}
          >
            My Referrals →
          </button>
        </div>
      </div>
    </div>
  );
}
