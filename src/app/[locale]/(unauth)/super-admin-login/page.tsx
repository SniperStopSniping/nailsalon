'use client';

/**
 * Super Admin Login Page
 *
 * Phone-based login for super-admin only using Twilio OTP.
 * Validates user is actually a super admin before redirecting.
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

function SuperAdminLoginContent() {
  const router = useRouter();
  const params = useParams();
  const locale = (params?.locale as string) || 'en';

  const [step, setStep] = useState<Step>('phone');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

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

  // Verify OTP and validate super admin status
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

      // Step 2: Fetch user info and validate super admin
      const meResponse = await fetch('/api/admin/auth/me');
      const meData = await meResponse.json();

      if (!meResponse.ok) {
        setError('Failed to verify account');
        return;
      }

      // Step 3: Validate user is actually a super admin
      if (!meData.user?.isSuperAdmin) {
        setError('Not authorized as super admin');
        return;
      }

      // Step 4: Check if profile is complete
      if (!meData.user.profileComplete) {
        router.push(`/${locale}/admin-onboarding`);
        return;
      }

      // Step 5: Redirect to super admin dashboard
      router.push(`/${locale}/super-admin`);
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

  return (
    <div className="flex min-h-screen flex-col bg-gradient-to-b from-slate-900 to-slate-800">
      {/* Header */}
      <div className="px-6 pb-8 pt-12 text-center">
        <div className="mx-auto mb-4 flex size-16 items-center justify-center rounded-2xl bg-gradient-to-br from-amber-500 to-orange-600 shadow-lg">
          <span className="text-3xl">👑</span>
        </div>
        <h1 className="text-2xl font-bold text-white">Super Admin Login</h1>
        <p className="mt-1 text-slate-400">
          {step === 'phone'
            ? 'Platform administrator access only'
            : 'Enter the verification code'}
        </p>
      </div>

      {/* Form */}
      <div className="flex-1 px-6">
        <form onSubmit={handleSubmit} className="mx-auto max-w-sm">
          {step === 'phone' ? (
            <>
              {/* Phone Input */}
              <div className="mb-4">
                <label className="mb-2 block text-sm font-medium text-slate-300">
                  Phone Number
                </label>
                <input
                  type="tel"
                  value={formatPhoneDisplay(phone)}
                  onChange={handlePhoneChange}
                  placeholder="(416) 555-1234"
                  autoFocus
                  className="w-full rounded-xl border border-slate-700 bg-slate-800 px-4 py-3 text-lg text-white placeholder:text-slate-500 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-amber-500"
                />
              </div>

              {/* Info */}
              <div className="mb-4 rounded-xl border border-slate-700 bg-slate-800/50 px-4 py-3">
                <p className="text-sm text-slate-400">
                  This login is for platform super administrators only. Salon owners should use the
                  {' '}
                  <a href={`/${locale}/admin-login`} className="text-amber-400 hover:underline">
                    salon admin login
                  </a>
                  .
                </p>
              </div>
            </>
          ) : (
            <>
              {/* Code Input */}
              <div className="mb-4">
                <label className="mb-2 block text-sm font-medium text-slate-300">
                  Verification Code
                </label>
                <input
                  type="text"
                  inputMode="numeric"
                  value={code}
                  onChange={handleCodeChange}
                  placeholder="123456"
                  autoFocus
                  maxLength={6}
                  className="w-full rounded-xl border border-slate-700 bg-slate-800 px-4 py-3 text-center font-mono text-lg tracking-[0.5em] text-white placeholder:text-slate-500 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-amber-500"
                />
                <p className="mt-2 text-center text-sm text-slate-400">
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
                className="mb-3 w-full text-sm font-medium text-slate-400 hover:text-white"
              >
                ← Use a different number
              </button>
            </>
          )}

          {/* Error Message */}
          {error && (
            <div className="mb-4 rounded-xl border border-red-800 bg-red-900/50 px-4 py-3">
              <p className="text-sm text-red-300">{error}</p>
            </div>
          )}

          {/* Submit Button */}
          <button
            type="submit"
            disabled={loading || (step === 'phone' && phone.length !== 10)}
            className="w-full rounded-xl bg-gradient-to-r from-amber-500 to-orange-600 py-3.5 font-semibold text-white shadow-md transition-all hover:shadow-lg active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
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
        <p className="text-sm text-slate-500">
          Salon owner?
          {' '}
          <a href={`/${locale}/admin-login`} className="font-medium text-amber-400 hover:underline">
            Go to salon admin login
          </a>
        </p>
      </div>
    </div>
  );
}

// =============================================================================
// Page Export
// =============================================================================

export default function SuperAdminLoginPage() {
  return (
    <Suspense fallback={(
      <div className="flex min-h-screen items-center justify-center bg-gradient-to-b from-slate-900 to-slate-800">
        <div className="size-8 animate-spin rounded-full border-4 border-amber-500 border-t-transparent" />
      </div>
    )}
    >
      <SuperAdminLoginContent />
    </Suspense>
  );
}
