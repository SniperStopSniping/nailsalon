'use client';

import { useParams, useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';

import { ConfettiPopup } from '@/components/ConfettiPopup';
import { themeVars } from '@/theme';

type ClaimState = 'loading' | 'form' | 'verify' | 'success' | 'error' | 'already_claimed';

interface ReferralInfo {
  referralId: string;
  referrerName: string | null;
  referrerPhoneMasked: string;
  salonName: string;
  salonSlug: string;
  status: string;
  isClaimable: boolean;
}

export default function ClaimReferralPage() {
  const router = useRouter();
  const params = useParams();
  const referralId = params?.referralId as string;

  // State
  const [claimState, setClaimState] = useState<ClaimState>('loading');
  const [referralInfo, setReferralInfo] = useState<ReferralInfo | null>(null);
  const [errorMessage, setErrorMessage] = useState<string>('');

  // Form state
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Confetti popup
  const [showConfetti, setShowConfetti] = useState(false);

  // Refs
  const codeInputRef = useRef<HTMLInputElement>(null);
  const hasRedirected = useRef(false);

  // Fetch referral info on mount
  useEffect(() => {
    async function fetchReferralInfo() {
      if (!referralId) {
        setClaimState('error');
        setErrorMessage('Invalid referral link');
        return;
      }

      try {
        const response = await fetch(`/api/referrals/${referralId}`);
        const data = await response.json();

        if (!response.ok) {
          setClaimState('error');
          setErrorMessage(data.error?.message || 'This referral link is invalid or has expired');
          return;
        }

        setReferralInfo(data.data);

        if (data.data.isClaimable) {
          setClaimState('form');
        } else {
          setClaimState('already_claimed');
        }
      } catch {
        setClaimState('error');
        setErrorMessage('Unable to load referral. Please try again.');
      }
    }

    fetchReferralInfo();
  }, [referralId]);

  // Handle phone input
  const handlePhoneChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const digits = e.target.value.replace(/\D/g, '').slice(0, 10);
    setPhone(digits);
    setFormError(null);
  };

  // Send OTP code
  const handleSendCode = useCallback(async () => {
    if (phone.length !== 10 || isLoading) return;
    if (!name.trim()) {
      setFormError('Please enter your name');
      return;
    }

    setIsLoading(true);
    setFormError(null);

    try {
      const response = await fetch('/api/auth/send-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone }),
      });

      const data = await response.json();

      if (!response.ok) {
        setFormError(data.error || 'Failed to send code');
        setIsLoading(false);
        return;
      }

      setIsLoading(false);
      setClaimState('verify');
    } catch {
      setFormError('Network error. Please try again.');
      setIsLoading(false);
    }
  }, [phone, name, isLoading]);

  // Verify OTP and claim referral
  const handleVerifyCode = useCallback(async () => {
    if (code.length !== 6 || isLoading) return;

    setIsLoading(true);
    setFormError(null);

    try {
      // First verify the OTP
      const verifyResponse = await fetch('/api/auth/verify-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone, code }),
      });

      const verifyData = await verifyResponse.json();

      if (!verifyResponse.ok) {
        setFormError(verifyData.error || 'Invalid code');
        setIsLoading(false);
        return;
      }

      // Then claim the referral
      const claimResponse = await fetch(`/api/referrals/${referralId}/claim`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          refereeName: name,
          refereePhone: phone,
        }),
      });

      const claimData = await claimResponse.json();

      if (!claimResponse.ok) {
        setFormError(claimData.error?.message || 'Failed to claim referral');
        setIsLoading(false);
        return;
      }

      // Success!
      setIsLoading(false);
      setClaimState('success');
      setShowConfetti(true);
    } catch {
      setFormError('Network error. Please try again.');
      setIsLoading(false);
    }
  }, [code, phone, name, referralId, isLoading]);

  // Auto-verify when code is complete
  useEffect(() => {
    if (code.length === 6 && claimState === 'verify' && !isLoading) {
      const timer = setTimeout(() => handleVerifyCode(), 150);
      return () => clearTimeout(timer);
    }
    return undefined;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code, claimState]);

  // Auto-focus code input when entering verify state
  useEffect(() => {
    if (claimState === 'verify' && codeInputRef.current) {
      codeInputRef.current.focus();
    }
  }, [claimState]);

  // Handle confetti close and redirect
  const handleConfettiClose = useCallback(() => {
    setShowConfetti(false);
    if (!hasRedirected.current) {
      hasRedirected.current = true;
      router.push('/profile');
    }
  }, [router]);

  // Format display phone for referrer
  const referrerDisplay = referralInfo
    ? (referralInfo.referrerName || 'your friend')
    : 'your friend';

  return (
    <div
      className="flex min-h-screen justify-center py-4"
      style={{ backgroundColor: themeVars.background }}
    >
      <div className="mx-auto flex w-full max-w-[430px] flex-col gap-4 px-4">
        {/* Loading State */}
        {claimState === 'loading' && (
          <div className="flex flex-1 items-center justify-center">
            <div className="text-center">
              <div className="mb-4 text-4xl">💅</div>
              <p className="text-neutral-600">Loading your referral...</p>
            </div>
          </div>
        )}

        {/* Error State */}
        {claimState === 'error' && (
          <div className="flex flex-1 items-center justify-center">
            <div className="text-center">
              <div className="mb-4 text-4xl">😔</div>
              <h1 className="mb-2 text-xl font-bold text-neutral-900">
                Oops!
              </h1>
              <p className="mb-6 text-neutral-600">{errorMessage}</p>
              <button
                type="button"
                onClick={() => router.push('/')}
                className="rounded-full px-6 py-3 text-sm font-semibold text-neutral-900 transition-all duration-150 hover:opacity-90 active:scale-[0.98]"
                style={{ backgroundColor: themeVars.primary }}
              >
                Go to Home
              </button>
            </div>
          </div>
        )}

        {/* Already Claimed State */}
        {claimState === 'already_claimed' && (
          <div className="flex flex-1 items-center justify-center">
            <div className="text-center">
              <div className="mb-4 text-4xl">✅</div>
              <h1 className="mb-2 text-xl font-bold text-neutral-900">
                Already Claimed
              </h1>
              <p className="mb-6 text-neutral-600">
                This referral has already been claimed.
              </p>
              <button
                type="button"
                onClick={() => router.push('/profile')}
                className="rounded-full px-6 py-3 text-sm font-semibold text-neutral-900 transition-all duration-150 hover:opacity-90 active:scale-[0.98]"
                style={{ backgroundColor: themeVars.primary }}
              >
                Go to Profile
              </button>
            </div>
          </div>
        )}

        {/* Form State */}
        {(claimState === 'form' || claimState === 'verify') && referralInfo && (
          <>
            {/* Header */}
            <div className="pt-8 text-center">
              <div className="mb-4 text-5xl">💅</div>
              <h1 className="text-2xl font-bold text-neutral-900">
                Claim Your Free Manicure
              </h1>
            </div>

            {/* Referrer Info Card */}
            <div
              className="rounded-xl p-4 text-center"
              style={{ backgroundColor: themeVars.selectedBackground }}
            >
              <p className="text-sm text-neutral-700">
                You&apos;ve been referred by{' '}
                <span className="font-semibold">{referrerDisplay}</span>
                {' '}({referralInfo.referrerPhoneMasked}) 💅
              </p>
            </div>

            {/* Main Card */}
            <div className="rounded-xl bg-white p-5 shadow-[0_1px_3px_rgba(0,0,0,0.08)]">
              {claimState === 'form' && (
                <>
                  <p className="mb-6 text-center text-sm text-neutral-700">
                    They gave you a <span className="font-semibold">FREE Gel Manicure</span> at{' '}
                    <span className="font-semibold">{referralInfo.salonName}</span>.
                    Enter your name and phone number to claim it.
                  </p>

                  {/* Name Input */}
                  <div className="mb-4">
                    <label
                      htmlFor="claim-name"
                      className="mb-2 block text-sm font-medium text-neutral-900"
                    >
                      Your Name
                    </label>
                    <input
                      id="claim-name"
                      type="text"
                      value={name}
                      onChange={(e) => {
                        setName(e.target.value);
                        setFormError(null);
                      }}
                      placeholder="Enter your name"
                      className="w-full rounded-full bg-neutral-100 px-4 py-3 text-base text-neutral-800 outline-none placeholder:text-neutral-400"
                      disabled={isLoading}
                    />
                  </div>

                  {/* Phone Input */}
                  <div className="mb-4">
                    <label
                      htmlFor="claim-phone"
                      className="mb-2 block text-sm font-medium text-neutral-900"
                    >
                      Phone Number
                    </label>
                    <div className="flex items-center gap-2">
                      <div className="flex items-center rounded-full bg-neutral-100 px-3 py-3 text-sm text-neutral-600">
                        +1
                      </div>
                      <input
                        id="claim-phone"
                        type="tel"
                        inputMode="numeric"
                        pattern="[0-9]*"
                        value={phone}
                        onChange={handlePhoneChange}
                        placeholder="Phone number"
                        className="flex-1 rounded-full bg-neutral-100 px-4 py-3 text-base text-neutral-800 outline-none placeholder:text-neutral-400"
                        disabled={isLoading}
                      />
                    </div>
                  </div>

                  {/* Error */}
                  {formError && (
                    <p className="mb-4 text-center text-sm text-red-600">
                      {formError}
                    </p>
                  )}

                  {/* Submit Button */}
                  <button
                    type="button"
                    onClick={handleSendCode}
                    disabled={!name.trim() || phone.length !== 10 || isLoading}
                    className="w-full rounded-full py-3.5 text-sm font-semibold text-neutral-900 transition-all duration-150 hover:opacity-90 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
                    style={{ backgroundColor: themeVars.primary }}
                  >
                    {isLoading ? 'Sending code...' : 'Claim my free manicure'}
                  </button>
                </>
              )}

              {claimState === 'verify' && (
                <>
                  <p className="mb-6 text-center text-sm text-neutral-700">
                    We sent a verification code to{' '}
                    <span className="font-semibold">+1 {phone}</span>
                  </p>

                  {/* Code Input */}
                  <div className="mb-4">
                    <label
                      htmlFor="verify-code"
                      className="mb-2 block text-sm font-medium text-neutral-900"
                    >
                      Verification Code
                    </label>
                    <input
                      ref={codeInputRef}
                      id="verify-code"
                      type="text"
                      inputMode="numeric"
                      pattern="[0-9]*"
                      value={code}
                      onChange={(e) => {
                        const digits = e.target.value.replace(/\D/g, '').slice(0, 6);
                        setCode(digits);
                        setFormError(null);
                      }}
                      placeholder="Enter 6-digit code"
                      className="w-full rounded-full bg-neutral-100 px-4 py-3 text-center text-xl font-semibold tracking-widest text-neutral-800 outline-none placeholder:text-sm placeholder:font-normal placeholder:tracking-normal placeholder:text-neutral-400"
                      disabled={isLoading}
                    />
                  </div>

                  {/* Error */}
                  {formError && (
                    <p className="mb-4 text-center text-sm text-red-600">
                      {formError}
                    </p>
                  )}

                  {/* Loading indicator */}
                  {isLoading && (
                    <p className="mb-4 text-center text-sm text-neutral-600">
                      Verifying...
                    </p>
                  )}

                  {/* Back button */}
                  <button
                    type="button"
                    onClick={() => {
                      setClaimState('form');
                      setCode('');
                      setFormError(null);
                    }}
                    disabled={isLoading}
                    className="mt-2 w-full text-center text-sm text-neutral-500 transition-colors hover:text-neutral-700"
                  >
                    ← Change phone number
                  </button>
                </>
              )}
            </div>

            {/* Terms */}
            <p className="text-center text-xs text-neutral-500">
              By claiming, you agree to receive SMS messages. Reward must be used within 14 days.
            </p>
          </>
        )}

        {/* Success State (shown briefly before redirect) */}
        {claimState === 'success' && !showConfetti && (
          <div className="flex flex-1 items-center justify-center">
            <div className="text-center">
              <div className="mb-4 text-4xl">🎉</div>
              <p className="text-neutral-600">Redirecting to your profile...</p>
            </div>
          </div>
        )}
      </div>

      {/* Confetti Popup */}
      <ConfettiPopup
        isOpen={showConfetti}
        onClose={handleConfettiClose}
        title="You've claimed your free manicure!"
        message="Your reward is now linked to your profile. Book within 14 days to use it!"
        emoji="🎉"
        autoDismissMs={4000}
      />
    </div>
  );
}
