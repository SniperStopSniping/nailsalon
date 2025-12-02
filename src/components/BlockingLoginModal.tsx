"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { FormInput } from "@/components/FormInput";
import { PrimaryButton } from "@/components/PrimaryButton";
import { MainCard } from "@/components/MainCard";

type AuthState = "loggedOut" | "verify" | "loggedIn";

interface BlockingLoginModalProps {
  isOpen: boolean;
  onClose: () => void;
  onLoginSuccess: () => void;
}

export function BlockingLoginModal({
  isOpen,
  onClose,
  onLoginSuccess,
}: BlockingLoginModalProps) {
  const [authState, setAuthState] = useState<AuthState>("loggedOut");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const phoneInputRef = useRef<HTMLInputElement>(null);
  const codeInputRef = useRef<HTMLInputElement>(null);

  const handleSendCode = useCallback(() => {
    if (!phone.trim()) return;
    setAuthState("verify");
  }, [phone]);

  const handleVerifyCode = useCallback(() => {
    if (code.trim().length < 4) return;
    setAuthState("loggedIn");
    // Call success callback and close modal
    onLoginSuccess();
  }, [code, onLoginSuccess]);

  useEffect(() => {
    const digits = phone.replace(/\D/g, "");
    if (digits.length === 10) {
      handleSendCode();
    }
  }, [phone, handleSendCode]);

  useEffect(() => {
    if (code.length === 6) {
      handleVerifyCode();
    }
  }, [code, handleVerifyCode]);

  useEffect(() => {
    if (!isOpen) return;

    if (authState === "loggedOut" && phoneInputRef.current) {
      phoneInputRef.current.focus();
    } else if (authState === "verify" && codeInputRef.current) {
      codeInputRef.current.focus();
    }
  }, [authState, isOpen]);

  // Reset state when modal closes
  useEffect(() => {
    if (!isOpen) {
      setAuthState("loggedOut");
      setPhone("");
      setCode("");
    }
  }, [isOpen]);

  // Prevent ESC key from closing modal
  useEffect(() => {
    if (!isOpen) return;
    
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
      }
    };

    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Dimmed background - no click handler to prevent closing */}
      <div className="absolute inset-0 bg-black/50" />
      
      {/* Modal content */}
      <div className="relative z-10 w-full max-w-sm mx-4">
        <MainCard>
          {authState === "loggedOut" && (
            <div className="space-y-2.5">
              <p className="text-lg font-semibold text-neutral-600 relative text-center w-full">
                <span
                  className="bg-clip-text text-transparent animate-shimmer inline-block"
                  style={{
                    backgroundImage:
                      'linear-gradient(to right, #7b4ea3, #f4b864, #7b4ea3, #f4b864, #7b4ea3)',
                    backgroundSize: '200% 100%',
                    WebkitBackgroundClip: 'text',
                    WebkitTextFillColor: 'transparent',
                  }}
                >
                  Earn Rewards Every Visit
                </span>
                <span
                  className="inline-block animate-sparkle ml-1"
                  style={{ color: "initial" }}
                >
                  ✨
                </span>
              </p>
              <div className="flex items-center gap-2">
                <div className="flex items-center rounded-full bg-neutral-100 px-2.5 py-1.5 text-xs text-neutral-600">
                  <span className="mr-1">+1</span>
                </div>
                <FormInput
                  ref={phoneInputRef}
                  type="tel"
                  inputMode="numeric"
                  value={phone}
                  onChange={(e) => {
                    const digits = e.target.value.replace(/\D/g, "");
                    setPhone(digits.slice(0, 10));
                  }}
                  placeholder="Phone number"
                  className="!px-3 !py-2 !text-base"
                />
                <PrimaryButton
                  onClick={handleSendCode}
                  disabled={!phone.trim()}
                  size="sm"
                  fullWidth={false}
                >
                  →
                </PrimaryButton>
              </div>
              <p className="text-sm font-semibold text-neutral-700">
                Number Mandatory For Booking{" "}
                <span className="text-red-500">*</span>
              </p>
              <button
                type="button"
                onClick={onClose}
                className="text-xs text-neutral-500 underline mt-2"
              >
                Cancel booking
              </button>
            </div>
          )}

          {authState === "verify" && (
            <div className="space-y-2.5">
              <p className="text-xs font-semibold text-neutral-700">
                {`Enter the 6-digit code we sent to +1 ${phone}`}
              </p>
              <div className="flex items-center gap-2 w-full max-w-full">
                <FormInput
                  ref={codeInputRef}
                  type="tel"
                  inputMode="numeric"
                  value={code}
                  onChange={(e) =>
                    setCode(e.target.value.replace(/\D/g, "").slice(0, 6))
                  }
                  placeholder="-  -  -   -  -  -"
                  className="!w-full !px-3 !py-2 !text-center !tracking-[0.25em] !text-base"
                />
                <PrimaryButton
                  onClick={handleVerifyCode}
                  disabled={code.trim().length < 4}
                  size="sm"
                  fullWidth={false}
                >
                  Verify
                </PrimaryButton>
              </div>
              <div className="flex items-center justify-between">
                <button
                  type="button"
                  onClick={() => {
                    setAuthState("loggedOut");
                    setCode("");
                  }}
                  className="text-xs text-neutral-500 underline"
                >
                  Edit phone number
                </button>
                <button
                  type="button"
                  onClick={onClose}
                  className="text-xs text-neutral-500 underline"
                >
                  Cancel booking
                </button>
              </div>
            </div>
          )}
        </MainCard>
      </div>
    </div>
  );
}

