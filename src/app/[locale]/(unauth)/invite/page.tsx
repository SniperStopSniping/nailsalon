'use client';

import { useParams, useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useRef, useState } from 'react';

import { ConfettiPopup } from '@/components/ConfettiPopup';
import { useSalon } from '@/providers/SalonProvider';
import { themeVars } from '@/theme';

export default function InvitePage() {
  const router = useRouter();
  const params = useParams();
  const { salonName, salonSlug } = useSalon();
  const locale = (params?.locale as string) || 'en';
  const t = useTranslations('Invite');

  const [friendPhone, setFriendPhone] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [showConfetti, setShowConfetti] = useState(false);

  // Get user info from cookies
  const [userName, setUserName] = useState('');
  const [userPhone, setUserPhone] = useState('');

  // Referral link state
  const [referralLink, setReferralLink] = useState<string | null>(null);
  const [isGeneratingLink, setIsGeneratingLink] = useState(false);

  // Prevent double submission
  const sendingRef = useRef(false);

  useEffect(() => {
    setMounted(true);

    const clientNameCookie = document.cookie
      .split('; ')
      .find(row => row.startsWith('client_name='));
    if (clientNameCookie) {
      const name = decodeURIComponent(clientNameCookie.split('=')[1] || '');
      if (name) setUserName(name);
    }

    const clientPhoneCookie = document.cookie
      .split('; ')
      .find(row => row.startsWith('client_phone='));
    if (clientPhoneCookie) {
      const phone = decodeURIComponent(clientPhoneCookie.split('=')[1] || '');
      if (phone) setUserPhone(phone);
    }
  }, []);

  // Normalize user phone for API calls - strip non-digits and leading country code "1"
  const normalizedUserPhone = userPhone.replace(/\D/g, '').replace(/^1(\d{10})$/, '$1');

  const handleSendReferral = useCallback(async () => {
    if (sendingRef.current || isSending) return;
    if (!friendPhone.trim() || friendPhone.length !== 10) return;

    sendingRef.current = true;
    setIsSending(true);
    setError(null);

    try {
      const response = await fetch('/api/referrals/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          salonSlug,
          referrerPhone: normalizedUserPhone,
          referrerName: userName || 'Your friend',
          refereePhone: friendPhone,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        if (data.error?.code === 'DUPLICATE_REFERRAL') {
          setError('You have already sent a referral to this number');
        } else if (data.error?.code === 'SELF_REFERRAL') {
          setError('You cannot refer yourself');
        } else if (data.error?.code === 'EXISTING_CLIENT') {
          setError('This number already has an account with us');
        } else {
          setError(data.error?.message || 'Failed to send referral');
        }
        return;
      }

      // Success! Show confetti
      setShowConfetti(true);
      setFriendPhone('');
    } catch (err) {
      console.error('Error sending referral:', err);
      setError('Something went wrong. Please try again.');
    } finally {
      setIsSending(false);
      sendingRef.current = false;
    }
  }, [friendPhone, normalizedUserPhone, userName, salonSlug, isSending]);

  const handleCopyLink = useCallback(async () => {
    setIsGeneratingLink(true);
    setError(null);

    try {
      // Generate a new referral link
      const response = await fetch('/api/referrals/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          salonSlug,
          referrerPhone: normalizedUserPhone,
          referrerName: userName || 'Your friend',
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        setError(data.error?.message || 'Failed to generate referral link');
        setIsGeneratingLink(false);
        return;
      }

      const generatedLink = data.data.referralUrl;
      setReferralLink(generatedLink);

      // Copy to clipboard
      await navigator.clipboard.writeText(generatedLink);
      setCopied(true);
      setTimeout(() => setCopied(false), 3000);
    } catch (err) {
      console.error('Error generating referral link:', err);
      setError('Something went wrong. Please try again.');
    } finally {
      setIsGeneratingLink(false);
    }
  }, [normalizedUserPhone, userName, salonSlug]);

  const handleBack = () => {
    router.back();
  };

  const isValidPhone = (phone: string) => {
    const digits = phone.replace(/\D/g, '');
    return digits.length === 10;
  };

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
            {t('title')}
          </h1>
          <p className="mt-1 text-base italic text-neutral-500">
            {t('subtitle')}
          </p>
        </div>

        {/* Rewards Preview Card */}
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
            <div className="flex items-center justify-center gap-8">
              <div className="text-center">
                <div className="mx-auto mb-2 flex size-16 items-center justify-center rounded-full bg-white/20">
                  <span className="text-3xl">🎁</span>
                </div>
                <div className="text-2xl font-bold" style={{ color: themeVars.primary }}>$15</div>
                <div className="mt-0.5 text-sm text-white/70">
                  {t('your_reward')}
                </div>
              </div>
              <div className="text-4xl text-white/30">+</div>
              <div className="text-center">
                <div className="mx-auto mb-2 flex size-16 items-center justify-center rounded-full bg-white/20">
                  <span className="text-3xl">💅</span>
                </div>
                <div className="text-2xl font-bold text-white">$10</div>
                <div className="mt-0.5 text-sm text-white/70">
                  {t('friend_reward')}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Main Invite Card */}
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
            <p className="mb-6 text-center text-base leading-relaxed text-neutral-600">
              {t('description')}
            </p>

            {/* Phone Input Section */}
            <div className="mb-5 space-y-3">
              <label className="text-sm font-bold text-neutral-900">
                {t('friends_phone')}
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
                    const digits = e.target.value.replace(/\D/g, '');
                    setFriendPhone(digits.slice(0, 10));
                    setError(null);
                  }}
                  placeholder="(555) 123-4567"
                  className="min-w-0 flex-1 rounded-full bg-neutral-100 px-4 py-2.5 text-base text-neutral-800 outline-none transition-all placeholder:text-neutral-400"
                  style={{
                    boxShadow: `0 0 0 0 transparent`,
                  }}
                  onFocus={(e) => {
                    e.currentTarget.style.boxShadow = `0 0 0 2px color-mix(in srgb, ${themeVars.accent} 30%, transparent)`;
                  }}
                  onBlur={(e) => {
                    e.currentTarget.style.boxShadow = '0 0 0 0 transparent';
                  }}
                  disabled={isSending}
                />
              </div>
            </div>

            {/* Error message */}
            {error && (
              <p className="mb-3 text-center text-sm text-red-600">
                {error}
              </p>
            )}

            {/* Send Button */}
            <button
              type="button"
              onClick={handleSendReferral}
              disabled={!isValidPhone(friendPhone) || isSending}
              className="w-full rounded-full px-6 py-3.5 text-lg font-bold text-neutral-900 shadow-sm transition-all duration-200 ease-out hover:scale-[1.02] hover:shadow-md active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:scale-100"
              style={{
                background: `linear-gradient(to right, ${themeVars.primary}, ${themeVars.primaryDark})`,
              }}
            >
              {isSending ? 'Sending...' : t('send_referral')}
            </button>

            {/* Divider */}
            <div className="flex items-center gap-4 py-6">
              <div className="h-px flex-1 bg-neutral-200" />
              <span className="text-sm font-medium uppercase tracking-wide text-neutral-400">
                {t('or')}
              </span>
              <div className="h-px flex-1 bg-neutral-200" />
            </div>

            {/* Copy Link Section */}
            <div className="space-y-3">
              <button
                type="button"
                onClick={handleCopyLink}
                disabled={isGeneratingLink}
                className="w-full rounded-full border-2 border-neutral-200 bg-white py-3 text-sm font-bold text-neutral-900 transition-all active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isGeneratingLink ? 'Generating...' : 'Copy Referral Link'}
              </button>
              {copied && (
                <p className="animate-pulse text-center text-base font-medium text-emerald-600">
                  {t('link_copied')}
                </p>
              )}
              {referralLink && !copied && (
                <div className="flex items-center gap-2 rounded-xl border border-neutral-200 bg-neutral-50 p-3">
                  <div className="flex-1 truncate font-mono text-sm text-neutral-600">
                    {referralLink}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* How It Works Card */}
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
              'opacity 300ms ease-out 250ms, transform 300ms ease-out 250ms',
          }}
        >
          <div className="p-5">
            <h2 className="mb-4 text-lg font-bold text-neutral-900">
              {t('how_it_works')}
            </h2>
            <div className="space-y-4">
              <div className="flex items-start gap-4">
                <div
                  className="flex size-10 shrink-0 items-center justify-center rounded-full text-lg font-bold"
                  style={{ backgroundColor: themeVars.background, color: themeVars.accent }}
                >
                  1
                </div>
                <div>
                  <div className="font-semibold text-neutral-900">
                    Share Your Link
                  </div>
                  <div className="mt-0.5 text-sm text-neutral-500">
                    Send your unique referral link to friends
                  </div>
                </div>
              </div>
              <div className="flex items-start gap-4">
                <div
                  className="flex size-10 shrink-0 items-center justify-center rounded-full text-lg font-bold"
                  style={{ backgroundColor: themeVars.background, color: themeVars.accent }}
                >
                  2
                </div>
                <div>
                  <div className="font-semibold text-neutral-900">
                    They Book & Visit
                  </div>
                  <div className="mt-0.5 text-sm text-neutral-500">
                    Your friend gets $10 off their first appointment
                  </div>
                </div>
              </div>
              <div className="flex items-start gap-4">
                <div
                  className="flex size-10 shrink-0 items-center justify-center rounded-full text-lg font-bold text-white"
                  style={{
                    background: `linear-gradient(to bottom right, ${themeVars.primary}, ${themeVars.primaryDark})`,
                  }}
                >
                  3
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

        {/* Google Review Card */}
        <div
          className="mb-6 overflow-hidden rounded-2xl shadow-[0_4px_20px_rgba(0,0,0,0.06)]"
          style={{
            borderWidth: '1px',
            borderStyle: 'solid',
            borderColor: themeVars.cardBorder,
            background: `linear-gradient(to bottom right, ${themeVars.surfaceAlt}, ${themeVars.highlightBackground})`,
            opacity: mounted ? 1 : 0,
            transform: mounted
              ? 'translateY(0) scale(1)'
              : 'translateY(10px) scale(0.97)',
            transition:
              'opacity 300ms ease-out 300ms, transform 300ms ease-out 300ms',
          }}
        >
          <div className="p-5 text-center">
            <div className="mb-2 text-3xl">⭐</div>
            <p className="mb-4 text-base font-medium text-neutral-700">
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
              className="w-full rounded-full border-2 bg-white px-6 py-3 text-base font-bold shadow-sm transition-all duration-200 hover:scale-[1.02] active:scale-[0.98]"
              style={{
                borderColor: themeVars.primaryDark,
                color: themeVars.accent,
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.backgroundColor = themeVars.surfaceAlt;
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.backgroundColor = 'white';
              }}
            >
              Leave a Google Review
            </button>
          </div>
        </div>

        {/* My Referrals Link */}
        <button
          type="button"
          onClick={() => router.push(`/${locale}/my-referrals`)}
          className="w-full py-2 text-base font-bold transition-colors"
          style={{
            color: themeVars.accent,
            opacity: mounted ? 1 : 0,
            transition: 'opacity 300ms ease-out 350ms',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.opacity = '0.8';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.opacity = '1';
          }}
        >
          {t('my_referrals')}
          {' '}
          →
        </button>

        {/* Bottom spacing */}
        <div className="h-6" />
      </div>

      {/* Confetti Popup */}
      <ConfettiPopup
        isOpen={showConfetti}
        onClose={() => setShowConfetti(false)}
        title="You just gifted your friend a FREE manicure!"
        message="They'll receive a text with your referral. When they book, you both win!"
        emoji="🎊"
        autoDismissMs={4000}
      />
    </div>
  );
}
