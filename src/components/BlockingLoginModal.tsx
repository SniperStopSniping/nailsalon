'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ModalShell } from '@/components/ui/modal-shell';
import { themeVars } from '@/theme';
import { getApiErrorMessage } from '@/utils/apiError';

type AuthState = 'checking' | 'loggedOut' | 'verify' | 'success';

type BlockingLoginModalProps = {
  isOpen: boolean;
  onClose: () => void;
  onLoginSuccess: (phone: string) => void;
};

/**
 * BlockingLoginModal Component
 *
 * Modal for phone-based authentication flow.
 * Uses Twilio Verify API for real SMS OTP.
 * Uses theme CSS variables for brand colors.
 * Checks for existing session first to skip OTP if already logged in.
 */
export function BlockingLoginModal({
  isOpen,
  onClose,
  onLoginSuccess,
}: BlockingLoginModalProps) {
  const [authState, setAuthState] = useState<AuthState>('checking');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [isVisible, setIsVisible] = useState(false);
  const [isContentVisible, setIsContentVisible] = useState(false);
  const [isButtonPressed, setIsButtonPressed] = useState(false);
  const [isVerifyButtonPressed, setIsVerifyButtonPressed] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const phoneInputRef = useRef<HTMLInputElement>(null);
  const codeInputRef = useRef<HTMLInputElement>(null);
  const sendInFlightRef = useRef(false);
  const verifyInFlightRef = useRef(false);
  const verifyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const verifySucceededRef = useRef(false);
  const successTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const successHandledRef = useRef(false);
  const lastSubmittedCodeRef = useRef<string | null>(null);

  const clearVerifyTimer = useCallback(() => {
    if (verifyTimerRef.current) {
      clearTimeout(verifyTimerRef.current);
      verifyTimerRef.current = null;
    }
  }, []);

  const clearSuccessTimer = useCallback(() => {
    if (successTimerRef.current) {
      clearTimeout(successTimerRef.current);
      successTimerRef.current = null;
    }
  }, []);

  const handleSendCode = useCallback(async () => {
    if (!phone.trim() || phone.length < 10 || isLoading || sendInFlightRef.current) {
      return;
    }

    sendInFlightRef.current = true;
    setIsButtonPressed(true);
    setIsLoading(true);
    setError(null);
    let transitionScheduled = false;

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

      // Success - move to verify state
      transitionScheduled = true;
      setTimeout(() => {
        setIsButtonPressed(false);
        setIsLoading(false);
        setAuthState('verify');
      }, 200);
    } catch {
      setError('Network error. Please try again.');
    } finally {
      sendInFlightRef.current = false;
      if (!transitionScheduled) {
        setIsButtonPressed(false);
        setIsLoading(false);
      }
    }
  }, [phone, isLoading]);

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
    setIsVerifyButtonPressed(true);
    setIsLoading(true);
    setError(null);
    let transitionScheduled = false;

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

      // Success - show celebration
      verifySucceededRef.current = true;
      transitionScheduled = true;
      setTimeout(() => {
        setIsVerifyButtonPressed(false);
        setIsLoading(false);
        setAuthState('success');
      }, 200);
    } catch {
      setError('Network error. Please try again.');
    } finally {
      verifyInFlightRef.current = false;
      if (!transitionScheduled) {
        setIsVerifyButtonPressed(false);
        setIsLoading(false);
      }
    }
  }, [clearVerifyTimer, code, isLoading, phone]);

  const handleResendCode = useCallback(async () => {
    if (isLoading) {
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
        setError(getApiErrorMessage(data, 'Failed to resend code'));
      } else {
        setCode(''); // Clear existing code
      }
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setIsLoading(false);
    }
  }, [phone, isLoading]);

  // Auto-send when 10 digits entered (only in loggedOut state, not loading)
  useEffect(() => {
    if (phone.length === 10 && authState === 'loggedOut' && !isLoading) {
      // Small delay so user sees the button activate
      const timer = setTimeout(() => handleSendCode(), 150);
      return () => clearTimeout(timer);
    }
    return undefined;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phone, authState, isLoading, handleSendCode]);

  // Auto-verify when 6 digits entered (only in verify state, not loading)
  useEffect(() => {
    clearVerifyTimer();

    if (
      code.length === 6
      && authState === 'verify'
      && !isLoading
      && !verifySucceededRef.current
      && lastSubmittedCodeRef.current !== code
    ) {
      // Small delay so user sees the button activate
      verifyTimerRef.current = setTimeout(() => {
        void handleVerifyCode();
      }, 150);
      return () => clearVerifyTimer();
    }
    return undefined;
  }, [code, authState, isLoading, handleVerifyCode]);

  useEffect(() => clearVerifyTimer, [clearVerifyTimer]);

  // Auto-focus phone input when modal opens
  useEffect(() => {
    if (isOpen && authState === 'loggedOut' && phoneInputRef.current && isContentVisible) {
      // Use requestAnimationFrame for better timing on mobile
      requestAnimationFrame(() => {
        setTimeout(() => {
          if (phoneInputRef.current) {
            phoneInputRef.current.focus();
            // For iOS, we need to also set selection
            phoneInputRef.current.setSelectionRange(0, 0);
          }
        }, 100);
      });
    }
  }, [isOpen, authState, isContentVisible]);

  // Auto-focus code input when switching to verify state
  useEffect(() => {
    if (authState === 'verify' && codeInputRef.current) {
      requestAnimationFrame(() => {
        setTimeout(() => {
          if (codeInputRef.current) {
            codeInputRef.current.focus();
            codeInputRef.current.setSelectionRange(0, 0);
          }
        }, 50);
      });
    }
  }, [authState]);

  // Handle success state - show celebration then proceed
  useEffect(() => {
    clearSuccessTimer();

    if (authState === 'success' && !successHandledRef.current) {
      successHandledRef.current = true;
      successTimerRef.current = setTimeout(() => {
        onLoginSuccess(phone);
      }, 2000);
      return () => clearSuccessTimer();
    }

    if (authState !== 'success') {
      successHandledRef.current = false;
    }

    return undefined;
  }, [authState, clearSuccessTimer, onLoginSuccess, phone]);

  // Check for existing session when modal opens
  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const checkExistingSession = async () => {
      setAuthState('checking');
      try {
        const response = await fetch('/api/auth/validate-session');
        const data = await response.json();

        if (data.valid && data.phone) {
          // User is already logged in - skip to success
          setPhone(data.phone);
          setAuthState('success');
        } else {
          // No valid session - show login form
          setAuthState('loggedOut');
        }
      } catch {
        // Error checking session - show login form
        setAuthState('loggedOut');
      }
    };

    checkExistingSession();
  }, [isOpen]);

  // Handle modal open/close animations
  useEffect(() => {
    if (isOpen) {
      setIsVisible(true);
      setTimeout(() => setIsContentVisible(true), 50);
    } else {
      setIsContentVisible(false);
      setTimeout(() => {
        setIsVisible(false);
        clearVerifyTimer();
        clearSuccessTimer();
        successHandledRef.current = false;
        verifySucceededRef.current = false;
        lastSubmittedCodeRef.current = null;
        setAuthState('checking');
        setPhone('');
        setCode('');
        setIsButtonPressed(false);
        setIsVerifyButtonPressed(false);
      }, 200);
    }
  }, [isOpen]);

  // Prevent ESC key from closing modal
  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
      }
    };

    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [isOpen]);

  if (!isVisible) {
    return null;
  }

  // Confetti colors using theme variables
  const confettiColors = [themeVars.primary, themeVars.accent, '#4ade80', '#f472b6', '#60a5fa'];

  return (
    <ModalShell isVisible={isVisible} isContentVisible={isContentVisible}>
          {/* Checking Session State */}
          {authState === 'checking' && (
            <div className="flex flex-col items-center justify-center p-12">
              <div className="size-10 animate-spin rounded-full border-4 border-neutral-200 border-t-neutral-600" />
              <p className="mt-4 text-sm text-neutral-500">Checking your session...</p>
            </div>
          )}

          {/* Success State */}
          {authState === 'success' && (
            <div className="p-8 text-center">
              {/* Confetti animation */}
              <div className="relative">
                <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                  {[...Array(12)].map((_, i) => (
                    <div
                      key={i}
                      className="absolute size-3 rounded-full"
                      style={{
                        backgroundColor: confettiColors[i % 5],
                        animation: `confetti-${i % 4} 1s ease-out forwards`,
                        animationDelay: `${i * 50}ms`,
                      }}
                    />
                  ))}
                </div>

                {/* Checkmark with pulse */}
                <div
                  className="mx-auto flex size-24 items-center justify-center rounded-full bg-gradient-to-br from-green-400 to-green-500 shadow-lg"
                  style={{
                    animation: 'successPop 0.5s cubic-bezier(0.175, 0.885, 0.32, 1.275) forwards',
                  }}
                >
                  <svg
                    width="48"
                    height="48"
                    viewBox="0 0 24 24"
                    fill="none"
                    className="text-white"
                    style={{
                      animation: 'checkDraw 0.4s ease-out 0.3s forwards',
                      strokeDasharray: 24,
                      strokeDashoffset: 24,
                    }}
                  >
                    <path
                      d="M20 6L9 17l-5-5"
                      stroke="currentColor"
                      strokeWidth="3"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      style={{
                        strokeDasharray: 24,
                        strokeDashoffset: 0,
                        animation: 'checkDraw 0.4s ease-out 0.3s forwards',
                      }}
                    />
                  </svg>
                </div>
              </div>

              <h2
                className="mt-6 text-2xl font-bold text-neutral-900"
                style={{
                  animation: 'fadeSlideUp 0.4s ease-out 0.4s forwards',
                  opacity: 0,
                }}
              >
                Welcome! 🎉
              </h2>
              <p
                className="mt-2 text-neutral-600"
                style={{
                  animation: 'fadeSlideUp 0.4s ease-out 0.5s forwards',
                  opacity: 0,
                }}
              >
                Thanks for signing up!
                <br />
                <span className="font-semibold" style={{ color: themeVars.accent }}>You're all set to book</span>
              </p>

            </div>
          )}

          {/* Phone Entry State */}
          {authState === 'loggedOut' && (
            <>
              {/* Header with gradient - using theme accent colors */}
              <div
                className="px-6 py-5 text-center"
                style={{
                  background: `linear-gradient(to right, ${themeVars.accent}, ${themeVars.accentLight})`,
                }}
              >
                <div className="mb-2 text-3xl">💅</div>
                <h2 className="text-xl font-bold text-white">Almost There!</h2>
                <p className="mt-1 text-sm text-white/80">
                  Quick sign in to complete your booking
                </p>
              </div>

              {/* Content */}
              <div className="p-6">
                <div
                  className="space-y-4"
                  style={{ animation: 'fadeSlideIn 0.3s ease-out' }}
                >
                  {/* Benefits - using theme primary colors */}
                  <div
                    className="flex items-center gap-3 rounded-xl p-3"
                    style={{
                      borderWidth: '1px',
                      borderStyle: 'solid',
                      borderColor: `color-mix(in srgb, ${themeVars.primary} 30%, transparent)`,
                      background: `linear-gradient(to right, color-mix(in srgb, ${themeVars.primary} 10%, transparent), color-mix(in srgb, ${themeVars.primaryDark} 10%, transparent))`,
                    }}
                  >
                    <span className="text-xl">🎁</span>
                    <div>
                      <div className="text-sm font-semibold text-neutral-800">Earn rewards every visit</div>
                      <div className="text-xs text-neutral-500">Plus get text reminders for your appointment</div>
                    </div>
                  </div>

                  {/* Phone input - tap to focus */}
                  <div
                    role="button"
                    tabIndex={0}
                    className="cursor-text"
                    onClick={() => phoneInputRef.current?.focus()}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') phoneInputRef.current?.focus();
                    }}
                  >
                    <label htmlFor="blocking-phone" className="mb-2 block text-sm font-medium text-neutral-600">
                      Your phone number
                    </label>
                    <div className="flex items-center gap-2">
                      <div className="flex items-center rounded-xl bg-neutral-100 p-4 text-base font-medium text-neutral-600">
                        +1
                      </div>
                      <div className="relative flex-1">
                        <Input
                          ref={phoneInputRef}
                          type="tel"
                          inputMode="numeric"
                          pattern="[0-9]*"
                          autoComplete="tel"
                          autoFocus
                          value={phone}
                          onChange={(e) => {
                            const digits = e.target.value.replace(/\D/g, '');
                            setPhone(digits.slice(0, 10));
                            setError(null);
                          }}
                          placeholder="Enter your number"
                          className="h-14 rounded-xl border-neutral-200 bg-neutral-50 px-4 text-lg font-medium shadow-none placeholder:text-neutral-400 focus-visible:ring-[var(--theme-primary-dark)]"
                        />
                        {phone.length === 0 && (
                          <div
                            className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 animate-pulse text-sm font-medium"
                            style={{ color: themeVars.primary }}
                          >
                            Tap here
                          </div>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Error message */}
                  {error && (
                    <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-center text-sm text-red-600">
                      {error}
                    </div>
                  )}

                  {/* Send code button with press animation - using theme gradient */}
                  <Button
                    onClick={handleSendCode}
                    disabled={phone.length < 10 || isLoading}
                    variant={phone.length >= 10 && !isLoading ? 'brand' : 'secondary'}
                    size="pill"
                    className="w-full rounded-xl py-4 text-base font-bold"
                    style={{
                      transform: isButtonPressed ? 'scale(0.95)' : 'scale(1)',
                      transition: 'transform 0.15s ease-out',
                    }}
                  >
                    {isLoading ? 'Sending...' : phone.length >= 10 ? 'Send Code →' : `Enter ${10 - phone.length} more digits`}
                  </Button>

                  {/* Cancel */}
                  <button
                    type="button"
                    onClick={onClose}
                    className="w-full py-2 text-sm text-neutral-400 transition-colors hover:text-neutral-600"
                  >
                    Cancel booking
                  </button>
                </div>
              </div>
            </>
          )}

          {/* Verify Code State */}
          {authState === 'verify' && (
            <>
              {/* Header with gradient - using theme accent colors */}
              <div
                className="px-6 py-5 text-center"
                style={{
                  background: `linear-gradient(to right, ${themeVars.accent}, ${themeVars.accentLight})`,
                }}
              >
                <div className="mb-2 text-3xl">📱</div>
                <h2 className="text-xl font-bold text-white">Check Your Phone</h2>
                <p className="mt-1 text-sm text-white/80">
                  We sent you a magic code
                </p>
              </div>

              {/* Content */}
              <div className="p-6">
                <div
                  className="space-y-4"
                  style={{ animation: 'fadeSlideIn 0.3s ease-out' }}
                >
                  {/* Code sent confirmation */}
                  <div className="flex items-center gap-3 rounded-xl border border-green-200 bg-green-50 p-3">
                    <span className="text-xl">✅</span>
                    <div>
                      <div className="text-sm font-semibold text-green-800">Code sent!</div>
                      <div className="text-xs text-green-600">
                        Check +1
                        {phone}
                        {' '}
                        for your 6-digit code
                      </div>
                    </div>
                  </div>

                  {/* Code input - tap to focus */}
                  <div
                    role="button"
                    tabIndex={0}
                    className="cursor-text"
                    onClick={() => codeInputRef.current?.focus()}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') codeInputRef.current?.focus();
                    }}
                  >
                    <label htmlFor="blocking-code" className="mb-2 block text-sm font-medium text-neutral-600">
                      Enter verification code
                    </label>
                      <div className="relative">
                      <Input
                        ref={codeInputRef}
                        type="tel"
                        inputMode="numeric"
                        pattern="[0-9]*"
                        autoComplete="one-time-code"
                        autoFocus
                        value={code}
                        onChange={e => {
                          const nextCode = e.target.value.replace(/\D/g, '').slice(0, 6);
                          if (nextCode.length < 6) {
                            lastSubmittedCodeRef.current = null;
                          }
                          verifySucceededRef.current = false;
                          setCode(nextCode);
                          setError(null);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            void handleVerifyCode();
                          }
                        }}
                        placeholder="• • • • • •"
                        className="h-16 w-full rounded-xl border-neutral-200 bg-neutral-50 px-4 text-center text-2xl font-bold tracking-[0.4em] shadow-none placeholder:text-neutral-400 focus-visible:ring-[var(--theme-primary-dark)]"
                      />
                      {code.length === 0 && (
                        <div
                          className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 animate-pulse text-sm font-medium"
                          style={{ color: themeVars.primary }}
                        >
                          Tap to enter
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Verify button with press animation - using theme gradient */}
                  <Button
                    onClick={() => void handleVerifyCode()}
                    disabled={code.length < 6 || isLoading}
                    variant={code.length >= 6 && !isLoading ? 'brand' : 'secondary'}
                    size="pill"
                    className="w-full rounded-xl py-4 text-base font-bold"
                    style={{
                      transform: isVerifyButtonPressed ? 'scale(0.95)' : 'scale(1)',
                      transition: 'transform 0.15s ease-out',
                    }}
                  >
                    {isLoading ? 'Verifying...' : code.length >= 6 ? 'Verify & Continue →' : `Enter ${6 - code.length} more digits`}
                  </Button>

                  {/* Error message */}
                  {error && (
                    <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-center text-sm text-red-600">
                      {error}
                    </div>
                  )}

                  {/* Actions */}
                  <div className="flex items-center justify-between pt-2">
                    <button
                      type="button"
                      onClick={() => {
                        lastSubmittedCodeRef.current = null;
                        setAuthState('loggedOut');
                        setPhone(''); // Clear phone so user can enter new one
                        setCode('');
                        setError(null);
                      }}
                      className="text-sm font-medium hover:underline"
                      style={{ color: themeVars.accent }}
                    >
                      ← Change number
                    </button>
                    <button
                      type="button"
                      onClick={handleResendCode}
                      disabled={isLoading}
                      className="text-sm text-neutral-400 transition-colors hover:text-neutral-600 disabled:opacity-50"
                    >
                      {isLoading ? 'Sending...' : 'Resend code'}
                    </button>
                  </div>

                  {/* Cancel */}
                  <button
                    type="button"
                    onClick={onClose}
                    className="w-full py-1 text-sm text-neutral-400 transition-colors hover:text-neutral-600"
                  >
                    Cancel booking
                  </button>
                </div>
              </div>
            </>
          )}
      {/* Animation keyframes */}
      <style jsx>
        {`
          @keyframes fadeSlideIn {
            from {
              opacity: 0;
              transform: translateY(10px);
            }
            to {
              opacity: 1;
              transform: translateY(0);
            }
          }
          @keyframes fadeSlideUp {
            from {
              opacity: 0;
              transform: translateY(10px);
            }
            to {
              opacity: 1;
              transform: translateY(0);
            }
          }
          @keyframes successPop {
            0% {
              transform: scale(0);
              opacity: 0;
            }
            50% {
              transform: scale(1.1);
            }
            100% {
              transform: scale(1);
              opacity: 1;
            }
          }
          @keyframes checkDraw {
            to {
              stroke-dashoffset: 0;
            }
          }
          @keyframes confetti-0 {
            0% { transform: translate(0, 0) rotate(0deg); opacity: 1; }
            100% { transform: translate(-60px, -80px) rotate(360deg); opacity: 0; }
          }
          @keyframes confetti-1 {
            0% { transform: translate(0, 0) rotate(0deg); opacity: 1; }
            100% { transform: translate(60px, -70px) rotate(-360deg); opacity: 0; }
          }
          @keyframes confetti-2 {
            0% { transform: translate(0, 0) rotate(0deg); opacity: 1; }
            100% { transform: translate(-40px, -90px) rotate(270deg); opacity: 0; }
          }
          @keyframes confetti-3 {
            0% { transform: translate(0, 0) rotate(0deg); opacity: 1; }
            100% { transform: translate(50px, -60px) rotate(-270deg); opacity: 0; }
          }
        `}
      </style>
    </ModalShell>
  );
}
