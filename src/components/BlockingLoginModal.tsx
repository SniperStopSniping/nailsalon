'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { FormInput } from '@/components/FormInput';

type AuthState = 'loggedOut' | 'verify' | 'success';

type BlockingLoginModalProps = {
  isOpen: boolean;
  onClose: () => void;
  onLoginSuccess: () => void;
};

export function BlockingLoginModal({
  isOpen,
  onClose,
  onLoginSuccess,
}: BlockingLoginModalProps) {
  const [authState, setAuthState] = useState<AuthState>('loggedOut');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [isVisible, setIsVisible] = useState(false);
  const [isContentVisible, setIsContentVisible] = useState(false);
  const [isButtonPressed, setIsButtonPressed] = useState(false);
  const [isVerifyButtonPressed, setIsVerifyButtonPressed] = useState(false);
  const phoneInputRef = useRef<HTMLInputElement>(null);
  const codeInputRef = useRef<HTMLInputElement>(null);

  const handleSendCode = useCallback(() => {
    if (!phone.trim() || phone.length < 10) {
      return;
    }

    // Button press animation
    setIsButtonPressed(true);
    setTimeout(() => {
      setIsButtonPressed(false);
      setAuthState('verify');
    }, 200);
  }, [phone]);

  const handleVerifyCode = useCallback(() => {
    if (code.trim().length < 6) {
      return;
    }

    // Button press animation
    setIsVerifyButtonPressed(true);
    setTimeout(() => {
      setIsVerifyButtonPressed(false);
      setAuthState('success');
    }, 200);
  }, [code]);

  // Auto-send when 10 digits entered
  useEffect(() => {
    if (phone.length === 10) {
      // Small delay so user sees the button activate
      setTimeout(() => handleSendCode(), 150);
    }
  }, [phone, handleSendCode]);

  // Auto-verify when 6 digits entered
  useEffect(() => {
    if (code.length === 6) {
      // Small delay so user sees the button activate
      setTimeout(() => handleVerifyCode(), 150);
    }
  }, [code, handleVerifyCode]);

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
    if (authState === 'success') {
      setTimeout(() => {
        onLoginSuccess();
      }, 2000);
    }
  }, [authState, onLoginSuccess]);

  // Handle modal open/close animations
  useEffect(() => {
    if (isOpen) {
      setIsVisible(true);
      setTimeout(() => setIsContentVisible(true), 50);
    } else {
      setIsContentVisible(false);
      setTimeout(() => {
        setIsVisible(false);
        setAuthState('loggedOut');
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

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Animated backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm transition-opacity duration-300"
        style={{ opacity: isContentVisible ? 1 : 0 }}
      />

      {/* Modal content */}
      <div
        className="relative z-10 mx-4 w-full max-w-sm transition-all duration-300"
        style={{
          opacity: isContentVisible ? 1 : 0,
          transform: isContentVisible ? 'translateY(0) scale(1)' : 'translateY(20px) scale(0.95)',
        }}
      >
        <div className="overflow-hidden rounded-3xl bg-white shadow-2xl">
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
                        backgroundColor: ['#f4b864', '#7b4ea3', '#4ade80', '#f472b6', '#60a5fa'][i % 5],
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
                <span className="font-semibold text-[#7b4ea3]">You're all set to book</span>
              </p>

              {/* Points earned badge */}
              <div
                className="mt-4 inline-flex items-center gap-2 rounded-full border border-[#f4b864]/30 bg-gradient-to-r from-[#f4b864]/20 to-[#d6a249]/20 px-4 py-2"
                style={{
                  animation: 'fadeSlideUp 0.4s ease-out 0.6s forwards',
                  opacity: 0,
                }}
              >
                <span className="text-lg">✨</span>
                <span className="text-sm font-semibold text-neutral-800">+50 Welcome Points!</span>
              </div>
            </div>
          )}

          {/* Phone Entry State */}
          {authState === 'loggedOut' && (
            <>
              {/* Header with gradient */}
              <div className="bg-gradient-to-r from-[#7b4ea3] to-[#9b6dc6] px-6 py-5 text-center">
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
                  {/* Benefits */}
                  <div className="flex items-center gap-3 rounded-xl border border-[#f4b864]/30 bg-gradient-to-r from-[#f4b864]/10 to-[#d6a249]/10 p-3">
                    <span className="text-xl">🎁</span>
                    <div>
                      <div className="text-sm font-semibold text-neutral-800">Earn rewards every visit</div>
                      <div className="text-xs text-neutral-500">Plus get text reminders for your appointment</div>
                    </div>
                  </div>

                  {/* Phone input - tap to focus */}
                  <div
                    className="cursor-text"
                    onClick={() => phoneInputRef.current?.focus()}
                  >
                    <label className="mb-2 block text-sm font-medium text-neutral-600">
                      Your phone number
                    </label>
                    <div className="flex items-center gap-2">
                      <div className="flex items-center rounded-xl bg-neutral-100 p-4 text-base font-medium text-neutral-600">
                        +1
                      </div>
                      <div className="relative flex-1">
                        <FormInput
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
                          }}
                          placeholder="Enter your number"
                          className="!rounded-xl !p-4 !text-lg !font-medium"
                        />
                        {phone.length === 0 && (
                          <div className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 animate-pulse text-sm font-medium text-[#f4b864]">
                            Tap here
                          </div>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Send code button with press animation */}
                  <button
                    type="button"
                    onClick={handleSendCode}
                    disabled={phone.length < 10}
                    className={`w-full rounded-xl py-4 text-base font-bold transition-all duration-200 ${
                      phone.length >= 10
                        ? 'bg-gradient-to-r from-[#f4b864] to-[#d6a249] text-neutral-900 shadow-lg hover:shadow-xl'
                        : 'cursor-not-allowed bg-neutral-200 text-neutral-400'
                    }`}
                    style={{
                      transform: isButtonPressed ? 'scale(0.95)' : 'scale(1)',
                      transition: 'transform 0.15s ease-out',
                    }}
                  >
                    {phone.length >= 10 ? 'Send Code →' : `Enter ${10 - phone.length} more digits`}
                  </button>

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
              {/* Header with gradient */}
              <div className="bg-gradient-to-r from-[#7b4ea3] to-[#9b6dc6] px-6 py-5 text-center">
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
                    className="cursor-text"
                    onClick={() => codeInputRef.current?.focus()}
                  >
                    <label className="mb-2 block text-sm font-medium text-neutral-600">
                      Enter verification code
                    </label>
                    <div className="relative">
                      <FormInput
                        ref={codeInputRef}
                        type="tel"
                        inputMode="numeric"
                        pattern="[0-9]*"
                        autoComplete="one-time-code"
                        autoFocus
                        value={code}
                        onChange={e =>
                          setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                        placeholder="• • • • • •"
                        className="!w-full !rounded-xl !px-4 !py-5 !text-center !text-2xl !font-bold !tracking-[0.4em]"
                      />
                      {code.length === 0 && (
                        <div className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 animate-pulse text-sm font-medium text-[#f4b864]">
                          Tap to enter
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Verify button with press animation */}
                  <button
                    type="button"
                    onClick={handleVerifyCode}
                    disabled={code.length < 6}
                    className={`w-full rounded-xl py-4 text-base font-bold transition-all duration-200 ${
                      code.length >= 6
                        ? 'bg-gradient-to-r from-[#f4b864] to-[#d6a249] text-neutral-900 shadow-lg hover:shadow-xl'
                        : 'cursor-not-allowed bg-neutral-200 text-neutral-400'
                    }`}
                    style={{
                      transform: isVerifyButtonPressed ? 'scale(0.95)' : 'scale(1)',
                      transition: 'transform 0.15s ease-out',
                    }}
                  >
                    {code.length >= 6 ? 'Verify & Continue →' : `Enter ${6 - code.length} more digits`}
                  </button>

                  {/* Actions */}
                  <div className="flex items-center justify-between pt-2">
                    <button
                      type="button"
                      onClick={() => {
                        setAuthState('loggedOut');
                        setCode('');
                      }}
                      className="text-sm font-medium text-[#7b4ea3] hover:underline"
                    >
                      ← Change number
                    </button>
                    <button
                      type="button"
                      className="text-sm text-neutral-400 transition-colors hover:text-neutral-600"
                    >
                      Resend code
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
        </div>

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
      </div>
    </div>
  );
}
