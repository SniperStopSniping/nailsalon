'use client';

import { useEffect, useState } from 'react';

/**
 * Shared auth hook for booking pages.
 * Handles session validation and login state management.
 * Use this in any booking step to check if user is logged in.
 */
export function useBookingAuth(initialPhone?: string) {
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [phone, setPhone] = useState(initialPhone || '');
  const [isCheckingSession, setIsCheckingSession] = useState(true);

  // Check for existing session on mount
  useEffect(() => {
    // If we have a phone from URL (reschedule flow), use it directly
    if (initialPhone) {
      setIsLoggedIn(true);
      setPhone(initialPhone);
      setIsCheckingSession(false);
      return;
    }

    const validateSession = async () => {
      try {
        const response = await fetch('/api/auth/validate-session');
        const data = await response.json();

        if (data.valid && data.phone) {
          setIsLoggedIn(true);
          setPhone(data.phone);
        }
      } catch {
        // Session validation failed, stay logged out
      } finally {
        setIsCheckingSession(false);
      }
    };

    validateSession();
  }, [initialPhone]);

  const handleLoginSuccess = (verifiedPhone: string) => {
    setIsLoggedIn(true);
    setPhone(verifiedPhone);
  };

  return {
    isLoggedIn,
    phone,
    isCheckingSession,
    handleLoginSuccess,
  };
}

