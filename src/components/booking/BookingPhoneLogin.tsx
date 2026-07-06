'use client';

import { useEffect, useRef, useState } from 'react';

import { FormInput } from '@/components/FormInput';
import { MainCard } from '@/components/MainCard';
import { PrimaryButton } from '@/components/PrimaryButton';
import { themeVars } from '@/theme';

type AuthState = 'loggedOut' | 'verify' | 'loggedIn';

type BookingPhoneLoginProps = {
  initialPhone?: string;
  onLoginSuccess: (phone: string) => void;
};

/**
 * Shared phone login component for booking pages.
 * Shows phone input -> OTP verification flow.
 * Used on whichever booking step is first in the flow.
 */
export function BookingPhoneLogin({ initialPhone, onLoginSuccess }: BookingPhoneLoginProps) {
  const [authState, setAuthState] = useState<AuthState>('loggedOut');
  const [phone, setPhone] = useState(initialPhone || '');
  const [code, setCode] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const codeInputRef = useRef<HTMLInputElement>(null);

  const handleSendCode = async () => {
    if (!phone.trim() || phone.length < 10 || isLoading) {
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch('/api/auth/send-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone }),
      });

      const data = await response.json();

      if (!response.ok) {
        setError(data.error || 'Failed to send code');
        setIsLoading(false);
        return;
      }

      setIsLoading(false);
      setAuthState('verify');
    } catch {
      setError('Network error. Please try again.');
      setIsLoading(false);
    }
  };

  const handleVerifyCode = async () => {
    if (code.trim().length < 6 || isLoading) {
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch('/api/auth/verify-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone, code }),
      });

      const data = await response.json();

      if (!response.ok) {
        setError(data.error || 'Invalid code');
        setIsLoading(false);
        return;
      }

      setIsLoading(false);
      setAuthState('loggedIn');
      onLoginSuccess(phone);
    } catch {
      setError('Network error. Please try again.');
      setIsLoading(false);
    }
  };

  // Auto-send code when phone number is complete (10 digits)
  useEffect(() => {
    const digits = phone.replace(/\D/g, '');
    if (digits.length === 10 && authState === 'loggedOut' && !isLoading) {
      const timer = setTimeout(() => handleSendCode(), 150);
      return () => clearTimeout(timer);
    }
    return undefined;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phone, authState]);

  // Auto-verify when code is complete (6 digits)
  useEffect(() => {
    if (code.length === 6 && authState === 'verify' && !isLoading) {
      const timer = setTimeout(() => handleVerifyCode(), 150);
      return () => clearTimeout(timer);
    }
    return undefined;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code, authState]);

  // Focus code input when switching to verify state
  useEffect(() => {
    if (authState === 'verify' && codeInputRef.current) {
      codeInputRef.current.focus();
    }
  }, [authState]);

  // Don't render if already logged in
  if (authState === 'loggedIn') {
    return null;
  }

  return (
    <MainCard className="mt-4 !border-neutral-800 !bg-[#101010] !text-white shadow-[0_4px_20px_rgba(0,0,0,0.35)]">
      {authState === 'loggedOut' && (
        <div className="space-y-3">
          <p className="text-lg font-bold text-white">
            <span
              className="bg-clip-text text-transparent"
              style={{
                backgroundImage: `linear-gradient(to right, ${themeVars.accent}, ${themeVars.primary})`,
              }}
            >
              New here? Get a free manicure! 💅
            </span>
          </p>
          <p className="-mt-1 text-sm text-neutral-400">
            Enter your number to sign up or log in
          </p>
          <div className="flex items-center gap-2">
            <div className="flex items-center rounded-full bg-neutral-900 px-3 py-2 text-sm font-medium text-neutral-300">
              +1
            </div>
            <FormInput
              type="tel"
              value={phone}
              onChange={(e) => {
                const digits = e.target.value.replace(/\D/g, '');
                setPhone(digits.slice(0, 10));
                setError(null);
              }}
              placeholder="Phone number"
              className="!border-neutral-700 !bg-neutral-900 !px-4 !py-2.5 !text-base !text-white placeholder:!text-neutral-500"
            />
            <PrimaryButton
              onClick={handleSendCode}
              disabled={!phone.trim() || phone.length < 10 || isLoading}
              size="sm"
              fullWidth={false}
            >
              {isLoading ? '...' : '→'}
            </PrimaryButton>
          </div>
          {error && (
            <p className="text-xs text-red-500">{error}</p>
          )}
          <p className="text-xs text-neutral-500">
            *New clients only. Conditions apply.
          </p>
        </div>
      )}

      {authState === 'verify' && (
        <div className="space-y-3">
          <p className="text-sm font-semibold text-neutral-200">
            Enter the 6-digit code we sent to +1
            {' '}
            {phone}
          </p>
          <div className="flex items-center gap-2">
            <FormInput
              ref={codeInputRef}
              type="tel"
              inputMode="numeric"
              value={code}
              onChange={(e) => {
                setCode(e.target.value.replace(/\D/g, '').slice(0, 6));
                setError(null);
              }}
              placeholder="• • • • • •"
              className="!w-full !border-neutral-700 !bg-neutral-900 !px-4 !py-2.5 !text-center !text-lg !tracking-[0.3em] !text-white placeholder:!text-neutral-500"
            />
            <PrimaryButton
              onClick={handleVerifyCode}
              disabled={code.trim().length < 6 || isLoading}
              size="sm"
              fullWidth={false}
            >
              {isLoading ? '...' : 'Verify'}
            </PrimaryButton>
          </div>
          {error && (
            <p className="text-xs text-red-500">{error}</p>
          )}
          <button
            type="button"
            onClick={() => {
              setAuthState('loggedOut');
              setPhone('');
              setCode('');
              setError(null);
            }}
            className="text-sm font-medium hover:underline"
            style={{ color: themeVars.accent }}
          >
            ← Change phone number
          </button>
        </div>
      )}
    </MainCard>
  );
}
