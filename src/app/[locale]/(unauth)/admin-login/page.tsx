'use client';

/**
 * Admin Login Page
 *
 * Phone-based login for admin and super-admin using Twilio OTP.
 * Redirects to appropriate dashboard based on role after verification.
 */

import { useRouter, useParams } from 'next/navigation';
import { useState, Suspense } from 'react';

// =============================================================================
// Types
// =============================================================================

type Step = 'phone' | 'code';

// =============================================================================
// Phone Formatting
// =============================================================================

function formatPhoneDisplay(value: string): string {
  const digits = value.replace(/\D/g, '').slice(0, 10);
  if (digits.length === 0) return '';
  if (digits.length <= 3) return `(${digits}`;
  if (digits.length <= 6) return `(${digits.slice(0, 3)}) ${digits.slice(3)}`;
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

  // Verify OTP
  const handleVerifyCode = async () => {
    if (code.length !== 6) {
      setError('Please enter the 6-digit code');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const response = await fetch('/api/admin/auth/verify-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone, code }),
      });

      const data = await response.json();

      if (!response.ok) {
        setError(data.error || 'Invalid code');
        return;
      }

      // Check if profile is complete - if not, redirect to onboarding
      if (!data.profileComplete) {
        router.push(`/${locale}/admin-onboarding`);
        return;
      }

      // Redirect based on destination
      if (data.destination === 'SUPER_ADMIN') {
        router.push(`/${locale}/super-admin`);
      } else if (data.salonSlug) {
        router.push(`/${locale}/admin?salon=${data.salonSlug}`);
      } else {
        router.push(`/${locale}/admin`);
      }
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
    <div className="min-h-screen bg-gradient-to-b from-slate-50 to-slate-100 flex flex-col">
      {/* Header */}
      <div className="pt-12 pb-8 px-6 text-center">
        <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-gradient-to-br from-slate-700 to-slate-900 flex items-center justify-center shadow-lg">
          <span className="text-3xl">🔐</span>
        </div>
        <h1 className="text-2xl font-bold text-slate-900">Admin Login</h1>
        <p className="text-slate-600 mt-1">
          {step === 'phone' 
            ? 'Enter your phone number to sign in'
            : 'Enter the verification code'
          }
        </p>
      </div>

      {/* Form */}
      <div className="flex-1 px-6">
        <form onSubmit={handleSubmit} className="max-w-sm mx-auto">
          {step === 'phone' ? (
            <>
              {/* Phone Input */}
              <div className="mb-4">
                <label className="block text-sm font-medium text-slate-700 mb-2">
                  Phone Number
                </label>
                <input
                  type="tel"
                  value={formatPhoneDisplay(phone)}
                  onChange={handlePhoneChange}
                  placeholder="(416) 555-1234"
                  autoFocus
                  className="w-full px-4 py-3 bg-white rounded-xl border border-slate-200 text-slate-900 text-lg focus:outline-none focus:ring-2 focus:ring-slate-500 focus:border-transparent"
                />
              </div>

              {/* Info */}
              <div className="mb-4 px-4 py-3 bg-slate-100 rounded-xl">
                <p className="text-sm text-slate-600">
                  Admin access is by invitation only. Contact your super admin if you need access.
                </p>
              </div>
            </>
          ) : (
            <>
              {/* Code Input */}
              <div className="mb-4">
                <label className="block text-sm font-medium text-slate-700 mb-2">
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
                  className="w-full px-4 py-3 bg-white rounded-xl border border-slate-200 text-slate-900 text-lg text-center tracking-[0.5em] font-mono focus:outline-none focus:ring-2 focus:ring-slate-500 focus:border-transparent"
                />
                <p className="text-sm text-slate-500 mt-2 text-center">
                  We sent a 6-digit code to {formatPhoneDisplay(phone)}
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
                className="w-full mb-3 text-slate-600 text-sm font-medium hover:text-slate-900"
              >
                ← Use a different number
              </button>
            </>
          )}

          {/* Error Message */}
          {error && (
            <div className="mb-4 px-4 py-3 bg-red-50 rounded-xl border border-red-200">
              <p className="text-sm text-red-600">{error}</p>
            </div>
          )}

          {/* Submit Button */}
          <button
            type="submit"
            disabled={loading || (step === 'phone' && phone.length !== 10)}
            className="w-full py-3.5 bg-gradient-to-r from-slate-700 to-slate-900 text-white font-semibold rounded-xl shadow-md disabled:opacity-50 disabled:cursor-not-allowed transition-all hover:shadow-lg active:scale-[0.98]"
          >
            {loading ? (
              <span className="flex items-center justify-center gap-2">
                <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
                {step === 'phone' ? 'Sending...' : 'Verifying...'}
              </span>
            ) : step === 'phone' ? (
              'Send Code'
            ) : (
              'Sign In'
            )}
          </button>
        </form>
      </div>

      {/* Footer */}
      <div className="py-8 px-6 text-center">
        <p className="text-sm text-slate-500">
          Not an admin?{' '}
          <a href={`/${locale}`} className="text-slate-700 font-medium hover:underline">
            Go to homepage
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
    <Suspense fallback={
      <div className="min-h-screen bg-gradient-to-b from-slate-50 to-slate-100 flex items-center justify-center">
        <div className="animate-spin h-8 w-8 border-4 border-slate-700 border-t-transparent rounded-full" />
      </div>
    }>
      <AdminLoginContent />
    </Suspense>
  );
}
