'use client';

/**
 * Staff Login Page
 *
 * Phone-based login for technicians using Twilio OTP.
 * Supports prefilling phone and salon from URL query params (from SMS invite).
 */

import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';

// =============================================================================
// Types
// =============================================================================

type Step = 'phone' | 'code';

// =============================================================================
// Phone Input Component
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
// Main Component (wrapped in Suspense for useSearchParams)
// =============================================================================

function StaffLoginContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const params = useParams();
  const locale = (params?.locale as string) || 'en';

  // Get prefilled values from URL
  const prefilledPhone = searchParams.get('phone') || '';
  const prefilledSalon = searchParams.get('salon') || '';

  const [step, setStep] = useState<Step>('phone');
  const [phone, setPhone] = useState('');
  const [salonSlug, setSalonSlug] = useState(prefilledSalon);
  const [code, setCode] = useState('');
  const [techName, setTechName] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  // Set prefilled phone on mount
  useEffect(() => {
    if (prefilledPhone) {
      // Decode and format the phone number
      const decoded = decodeURIComponent(prefilledPhone).replace(/\D/g, '');
      // Remove country code if present
      const tenDigit = decoded.length === 11 && decoded.startsWith('1')
        ? decoded.slice(1)
        : decoded;
      setPhone(tenDigit);
    }
  }, [prefilledPhone]);

  // Set prefilled salon on mount / when URL params change
  // Don't overwrite if already set (e.g., user already has a value)
  useEffect(() => {
    if (prefilledSalon && !salonSlug) {
      const normalized = prefilledSalon.trim().toLowerCase();
      setSalonSlug(normalized);
    }
  }, [prefilledSalon, salonSlug]);

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

    if (!salonSlug) {
      setError('Salon information is missing. Please use the link from your invite.');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const response = await fetch('/api/staff/send-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone, salonSlug }),
      });

      const data = await response.json();

      if (!response.ok) {
        setError(data.error || 'Failed to send code');
        return;
      }

      // Store tech name for display
      if (data.technicianName) {
        setTechName(data.technicianName);
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
      const response = await fetch('/api/staff/verify-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone, code, salonSlug }),
      });

      const data = await response.json();

      if (!response.ok) {
        setError(data.error || 'Invalid code');
        return;
      }

      // Success! Redirect to staff dashboard with locale
      router.push(`/${locale}/staff`);
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
    <div className="flex min-h-screen flex-col bg-gradient-to-b from-[#F8F4F0] to-[#EDE8E3]">
      {/* Header */}
      <div className="px-6 pb-8 pt-12 text-center">
        <div className="mx-auto mb-4 flex size-16 items-center justify-center rounded-2xl bg-gradient-to-br from-[#D4A574] to-[#C4956A] shadow-lg">
          <span className="text-3xl">💅</span>
        </div>
        <h1 className="text-2xl font-bold text-[#2C2C2C]">Staff Login</h1>
        <p className="mt-1 text-[#6B6B6B]">
          {step === 'phone'
            ? 'Enter your phone number to sign in'
            : `Welcome back${techName ? `, ${techName}` : ''}!`}
        </p>
      </div>

      {/* Form */}
      <div className="flex-1 px-6">
        <form onSubmit={handleSubmit} className="mx-auto max-w-sm">
          {step === 'phone' ? (
            <>
              {/* Phone Input */}
              <div className="mb-4">
                <label className="mb-2 block text-sm font-medium text-[#4A4A4A]">
                  Phone Number
                </label>
                <input
                  type="tel"
                  value={formatPhoneDisplay(phone)}
                  onChange={handlePhoneChange}
                  placeholder="(416) 555-1234"
                  autoFocus
                  className="w-full rounded-xl border border-[#E0D6CC] bg-white px-4 py-3 text-lg text-[#2C2C2C] focus:border-transparent focus:outline-none focus:ring-2 focus:ring-[#D4A574]"
                />
              </div>

              {/* Salon Input */}
              <div className="mb-4">
                <label className="mb-2 block text-sm font-medium text-[#4A4A4A]">
                  Salon Code
                </label>
                <input
                  type="text"
                  value={salonSlug}
                  onChange={(e) => {
                    setSalonSlug(e.target.value.trim().toLowerCase());
                    setError('');
                  }}
                  placeholder="e.g. luxe-nails"
                  className="w-full rounded-xl border border-[#E0D6CC] bg-white px-4 py-3 text-lg text-[#2C2C2C] focus:border-transparent focus:outline-none focus:ring-2 focus:ring-[#D4A574]"
                />
                <p className="mt-1.5 text-xs text-[#8B8B8B]">
                  Enter your salon&apos;s code or use the link from your invite SMS
                </p>
              </div>
            </>
          ) : (
            <>
              {/* Code Input */}
              <div className="mb-4">
                <label className="mb-2 block text-sm font-medium text-[#4A4A4A]">
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
                  className="w-full rounded-xl border border-[#E0D6CC] bg-white px-4 py-3 text-center font-mono text-lg tracking-[0.5em] text-[#2C2C2C] focus:border-transparent focus:outline-none focus:ring-2 focus:ring-[#D4A574]"
                />
                <p className="mt-2 text-center text-sm text-[#6B6B6B]">
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
                className="mb-3 w-full text-sm font-medium text-[#D4A574]"
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
            disabled={loading || (step === 'phone' && (!phone || phone.length !== 10 || !salonSlug))}
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
        <p className="text-sm text-[#8B8B8B]">
          Not a staff member?
          {' '}
          <a href={`/${locale}`} className="font-medium text-[#D4A574]">
            Book an appointment
          </a>
        </p>
      </div>
    </div>
  );
}

// =============================================================================
// Page Export (with Suspense for useSearchParams)
// =============================================================================

export default function StaffLoginPage() {
  return (
    <Suspense fallback={(
      <div className="flex min-h-screen items-center justify-center bg-gradient-to-b from-[#F8F4F0] to-[#EDE8E3]">
        <div className="size-8 animate-spin rounded-full border-4 border-[#D4A574] border-t-transparent" />
      </div>
    )}
    >
      <StaffLoginContent />
    </Suspense>
  );
}
