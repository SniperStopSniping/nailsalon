'use client';

/**
 * Salon Admin Login Page
 *
 * Phone-based login for salon admins using Twilio OTP.
 * Requires salon slug to validate membership before redirecting.
 */

import { useParams, useRouter } from 'next/navigation';
import { Suspense, useState } from 'react';

// =============================================================================
// Types
// =============================================================================

type Step = 'phone' | 'code';

// =============================================================================
// Phone Formatting
// =============================================================================

function formatPhoneDisplay(value: string): string {
  const digits = value.replace(/\D/g, '').slice(0, 10);
  if (digits.length === 0) {
    return '';
  }
  if (digits.length <= 3) {
    return `(${digits}`;
  }
  if (digits.length <= 6) {
    return `(${digits.slice(0, 3)}) ${digits.slice(3)}`;
  }
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
}

// =============================================================================
// Main Component
// =============================================================================

function AdminLoginContent() {
  const router = useRouter();
  const params = useParams();
  const locale = (params?.locale as string) || 'en';

  const [step, setStep] = useState<Step>('phone');
  const [salonSlug, setSalonSlug] = useState('');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  // Handle salon slug input change
  const handleSalonSlugChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    // Normalize: lowercase, trim, allow only alphanumeric and hyphens
    const value = e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '');
    setSalonSlug(value);
    setError('');
  };

  // Handle phone input change
  const handlePhoneChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const digits = e.target.value.replace(/\D/g, '').slice(0, 10);
    setPhone(digits);
    setError('');
  };

  // Handle code input change
  const handleCodeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const digits = e.target.value.replace(/\D/g, '').slice(0, 6);
    setCode(digits);
    setError('');
  };

  // Send OTP
  const handleSendCode = async () => {
    if (!salonSlug.trim()) {
      setError('Please enter your salon code');
      return;
    }

    if (phone.length !== 10) {
      setError('Please enter a valid 10-digit phone number');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const response = await fetch('/api/admin/auth/send-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone }),
      });

      const data = await response.json();

      if (!response.ok) {
        setError(data.error || 'Failed to send code');
        return;
      }

      setStep('code');
    } catch {
      setError('Something went wrong. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  // Verify OTP and validate salon membership
  const handleVerifyCode = async () => {
    if (code.length !== 6) {
      setError('Please enter the 6-digit code');
      return;
    }

    setLoading(true);
    setError('');

    try {
      // Step 1: Verify OTP
      const verifyResponse = await fetch('/api/admin/auth/verify-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone, code }),
      });

      const verifyData = await verifyResponse.json();

      if (!verifyResponse.ok) {
        setError(verifyData.error || 'Invalid code');
        return;
      }

      // Step 2: Fetch user info with salon validation
      const normalizedSlug = salonSlug.trim().toLowerCase();
      const meResponse = await fetch(`/api/admin/auth/me?salonSlug=${encodeURIComponent(normalizedSlug)}`);
      const meData = await meResponse.json();

      if (!meResponse.ok) {
        if (meResponse.status === 401) {
          setError(meData.error || 'You do not have access to this salon');
        } else {
          setError('Failed to verify account');
        }
        return;
      }

      // Step 3: Check if profile is complete
      if (!meData.user?.profileComplete) {
        router.push(`/${locale}/admin-onboarding`);
        return;
      }

      // Step 4: Set active salon cookie (server-side httpOnly)
      await fetch('/api/admin/auth/set-active-salon', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ salonSlug: normalizedSlug }),
      });

      // Step 5: Redirect to admin dashboard with salon
      router.push(`/${locale}/admin?salon=${encodeURIComponent(normalizedSlug)}`);
    } catch {
      setError('Something went wrong. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  // Handle form submit
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (step === 'phone') {
      handleSendCode();
    } else {
      handleVerifyCode();
    }
  };

  const isPhoneStepValid = salonSlug.trim().length > 0 && phone.length === 10;

  return (
    <div className="flex min-h-screen flex-col bg-gradient-to-b from-[#FDF7F0] to-[#F5EDE4]">
      {/* Header */}
      <div className="px-6 pb-8 pt-12 text-center">
        <div className="mx-auto mb-4 flex size-16 items-center justify-center rounded-2xl bg-gradient-to-br from-[#D4A574] to-[#C4956A] shadow-lg">
          <span className="text-3xl">💅</span>
        </div>
        <h1 className="text-2xl font-bold text-[#3F2B24]">Salon Admin Login</h1>
        <p className="mt-1 text-[#8A7E78]">
          {step === 'phone'
            ? 'Sign in to manage your salon'
            : 'Enter the verification code'}
        </p>
      </div>

      {/* Form */}
      <div className="flex-1 px-6">
        <form onSubmit={handleSubmit} className="mx-auto max-w-sm">
          {step === 'phone' && (
            <>
              {/* Salon Slug Input */}
              <div className="mb-4">
                <label htmlFor="admin-salon-code" className="mb-2 block text-sm font-medium text-[#3F2B24]">
                  Salon Code
                </label>
                <input
                  id="admin-salon-code"
                  type="text"
                  value={salonSlug}
                  onChange={handleSalonSlugChange}
                  placeholder="e.g. luxe-nails"
                  // eslint-disable-next-line jsx-a11y/no-autofocus -- login form first field
                  autoFocus
                  className="w-full rounded-xl border border-[#E0D6CC] bg-white px-4 py-3 text-lg text-[#3F2B24] placeholder:text-[#C4B8AC] focus:border-transparent focus:outline-none focus:ring-2 focus:ring-[#D4A574]"
                />
                <p className="mt-1.5 text-xs text-[#8A7E78]">
                  Find this in your invite link or ask your salon owner
                </p>
              </div>

              {/* Phone Input */}
              <div className="mb-4">
                <label htmlFor="admin-phone" className="mb-2 block text-sm font-medium text-[#3F2B24]">
                  Phone Number
                </label>
                <input
                  id="admin-phone"
                  type="tel"
                  value={formatPhoneDisplay(phone)}
                  onChange={handlePhoneChange}
                  placeholder="(416) 555-1234"
                  className="w-full rounded-xl border border-[#E0D6CC] bg-white px-4 py-3 text-lg text-[#3F2B24] placeholder:text-[#C4B8AC] focus:border-transparent focus:outline-none focus:ring-2 focus:ring-[#D4A574]"
                />
              </div>

              {/* Info */}
              <div className="mb-4 rounded-xl border border-[#E0D6CC] bg-white/60 px-4 py-3">
                <p className="text-sm text-[#8A7E78]">
                  Admin access is by invitation only. Contact your salon owner if you need access.
                </p>
              </div>
            </>
          )}
          {step === 'code' && (
            <>
              {/* Code Input */}
              <div className="mb-4">
                <label htmlFor="admin-code" className="mb-2 block text-sm font-medium text-[#3F2B24]">
                  Verification Code
                </label>
                <input
                  id="admin-code"
                  type="text"
                  inputMode="numeric"
                  value={code}
                  onChange={handleCodeChange}
                  placeholder="123456"
                  // eslint-disable-next-line jsx-a11y/no-autofocus -- OTP input after step transition
                  autoFocus
                  maxLength={6}
                  className="w-full rounded-xl border border-[#E0D6CC] bg-white px-4 py-3 text-center font-mono text-lg tracking-[0.5em] text-[#3F2B24] placeholder:text-[#C4B8AC] focus:border-transparent focus:outline-none focus:ring-2 focus:ring-[#D4A574]"
                />
                <p className="mt-2 text-center text-sm text-[#8A7E78]">
                  We sent a 6-digit code to
                  {' '}
                  {formatPhoneDisplay(phone)}
                </p>
              </div>

              {/* Back button */}
              <button
                type="button"
                onClick={() => {
                  setStep('phone');
                  setCode('');
                  setError('');
                }}
                className="mb-3 w-full text-sm font-medium text-[#8A7E78] hover:text-[#3F2B24]"
              >
                ← Use a different number
              </button>
            </>
          )}

          {/* Error Message */}
          {error && (
            <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3">
              <p className="text-sm text-red-600">{error}</p>
            </div>
          )}

          {/* Submit Button */}
          <button
            type="submit"
            disabled={loading || (step === 'phone' && !isPhoneStepValid)}
            className="w-full rounded-xl bg-gradient-to-r from-[#D4A574] to-[#C4956A] py-3.5 font-semibold text-white shadow-md transition-all hover:shadow-lg active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {loading
              ? (
                  <span className="flex items-center justify-center gap-2">
                    <svg className="size-5 animate-spin" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                    </svg>
                    {step === 'phone' ? 'Sending...' : 'Verifying...'}
                  </span>
                )
              : step === 'phone'
                ? (
                    'Send Code'
                  )
                : (
                    'Sign In'
                  )}
          </button>
        </form>
      </div>

      {/* Footer */}
      <div className="px-6 py-8 text-center">
        <p className="text-sm text-[#8A7E78]">
          Platform administrator?
          {' '}
          <a href={`/${locale}/super-admin-login`} className="font-medium text-[#D4A574] hover:underline">
            Go to super admin login
          </a>
        </p>
      </div>
    </div>
  );
}

// =============================================================================
// Page Export
// =============================================================================

export default function AdminLoginPage() {
  return (
    <Suspense fallback={(
      <div className="flex min-h-screen items-center justify-center bg-gradient-to-b from-[#FDF7F0] to-[#F5EDE4]">
        <div className="size-8 animate-spin rounded-full border-4 border-[#D4A574] border-t-transparent" />
      </div>
    )}
    >
      <AdminLoginContent />
    </Suspense>
  );
}
