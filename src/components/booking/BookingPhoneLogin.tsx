'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { themeVars } from '@/theme';
import { getApiErrorMessage } from '@/utils/apiError';

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
  const sendInFlightRef = useRef(false);
  const verifyInFlightRef = useRef(false);
  const verifyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const verifySucceededRef = useRef(false);
  const lastSubmittedCodeRef = useRef<string | null>(null);

  const clearVerifyTimer = useCallback(() => {
    if (verifyTimerRef.current) {
      clearTimeout(verifyTimerRef.current);
      verifyTimerRef.current = null;
    }
  }, []);

  const handleSendCode = async () => {
    if (!phone.trim() || phone.length < 10 || isLoading || sendInFlightRef.current) {
      return;
    }

    sendInFlightRef.current = true;
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
        setError(getApiErrorMessage(data, 'Failed to send code'));
        return;
      }

      setAuthState('verify');
    } catch {
      setError('Network error. Please try again.');
    } finally {
      sendInFlightRef.current = false;
      setIsLoading(false);
    }
  };

  const handleVerifyCode = useCallback(async () => {
    clearVerifyTimer();
    const currentCode = code.trim();

    if (
      currentCode.length < 6
      || isLoading
      || verifyInFlightRef.current
      || verifySucceededRef.current
      || lastSubmittedCodeRef.current === currentCode
    ) {
      return;
    }

    lastSubmittedCodeRef.current = currentCode;
    verifyInFlightRef.current = true;
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
        setError(getApiErrorMessage(
          data,
          'This verification code is incorrect or expired. Please request a new code and try again.',
        ));
        return;
      }

      verifySucceededRef.current = true;
      setAuthState('loggedIn');
      onLoginSuccess(data.phone || phone);
    } catch {
      setError('Network error. Please try again.');
    } finally {
      verifyInFlightRef.current = false;
      setIsLoading(false);
    }
  }, [clearVerifyTimer, code, isLoading, onLoginSuccess, phone]);

  // Auto-send code when phone number is complete (10 digits)
  useEffect(() => {
    const digits = phone.replace(/\D/g, '');
    if (digits.length === 10 && authState === 'loggedOut' && !isLoading) {
      const timer = setTimeout(() => handleSendCode(), 150);
      return () => clearTimeout(timer);
    }
    return undefined;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phone, authState, isLoading]);

  // Auto-verify when code is complete (6 digits)
  useEffect(() => {
    clearVerifyTimer();

    if (
      code.length === 6
      && authState === 'verify'
      && !isLoading
      && !verifySucceededRef.current
      && lastSubmittedCodeRef.current !== code
    ) {
      verifyTimerRef.current = setTimeout(() => {
        void handleVerifyCode();
      }, 150);
      return () => clearVerifyTimer();
    }

    return undefined;
  }, [authState, clearVerifyTimer, code, handleVerifyCode, isLoading]);

  useEffect(() => clearVerifyTimer, [clearVerifyTimer]);

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
    <Card className="mt-4">
      <CardContent className="space-y-3">
      {authState === 'loggedOut' && (
        <div className="space-y-3">
          <p className="text-lg font-bold text-neutral-800">
            <span
              className="bg-clip-text text-transparent"
              style={{
                backgroundImage: `linear-gradient(to right, ${themeVars.accent}, ${themeVars.primary})`,
              }}
            >
              New here? Get a free manicure! 💅
            </span>
          </p>
          <p className="-mt-1 text-sm text-neutral-500">
            Enter your number to sign up or log in
          </p>
          <div className="flex items-center gap-2">
            <div className="flex items-center rounded-full bg-neutral-100 px-3 py-2 text-sm font-medium text-neutral-600">
              +1
            </div>
            <Input
              aria-label="Customer phone number"
              data-testid="booking-login-phone"
              type="tel"
              value={phone}
              onChange={(e) => {
                const digits = e.target.value.replace(/\D/g, '');
                setPhone(digits.slice(0, 10));
                setError(null);
              }}
              placeholder="Phone number"
              className="h-10 rounded-full border-neutral-200 bg-neutral-50 px-4 text-base shadow-none placeholder:text-neutral-400 focus-visible:ring-[var(--theme-primary-dark)]"
            />
            <Button
              data-testid="booking-login-send"
              onClick={handleSendCode}
              disabled={!phone.trim() || phone.length < 10 || isLoading}
              variant="brand"
              size="pillSm"
              className="min-w-12 px-4"
            >
              {isLoading ? '...' : '→'}
            </Button>
          </div>
          {error && (
            <p className="text-xs text-red-500">{error}</p>
          )}
          <p className="text-xs text-neutral-400">
            *New clients only. Conditions apply.
          </p>
        </div>
      )}

      {authState === 'verify' && (
        <div className="space-y-3">
          <p className="text-sm font-semibold text-neutral-700">
            Enter the 6-digit code we sent to +1
            {' '}
            {phone}
          </p>
          <div className="flex items-center gap-2">
            <Input
              ref={codeInputRef}
              aria-label="Customer verification code"
              data-testid="booking-login-code"
              type="tel"
              inputMode="numeric"
              value={code}
              onChange={(e) => {
                const nextCode = e.target.value.replace(/\D/g, '').slice(0, 6);
                if (nextCode.length < 6) {
                  lastSubmittedCodeRef.current = null;
                }
                setCode(nextCode);
                setError(null);
                verifySucceededRef.current = false;
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  void handleVerifyCode();
                }
              }}
              placeholder="• • • • • •"
              className="h-10 rounded-full border-neutral-200 bg-neutral-50 px-4 text-center text-lg tracking-[0.3em] shadow-none placeholder:text-neutral-400 focus-visible:ring-[var(--theme-primary-dark)]"
            />
            <Button
              data-testid="booking-login-verify"
              onClick={() => void handleVerifyCode()}
              disabled={code.trim().length < 6 || isLoading}
              variant="brand"
              size="pillSm"
              className="min-w-24 px-4"
            >
              {isLoading ? '...' : 'Verify'}
            </Button>
          </div>
          {error && (
            <p className="text-xs text-red-500">{error}</p>
          )}
          <button
            type="button"
            onClick={() => {
              clearVerifyTimer();
              verifySucceededRef.current = false;
              lastSubmittedCodeRef.current = null;
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
      </CardContent>
    </Card>
  );
}
