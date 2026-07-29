'use client';

import { useCallback } from 'react';

export function useClientSession() {
  // Client PR 0A compatibility adapter. Existing consumers remain mounted
  // until PR 0B removes the legacy account surfaces, but they must neither
  // probe the retired endpoint nor promote browser-only login state.
  const validateSession = useCallback(async () => {
    // Intentionally inert until the tenant-bound email account system exists.
  }, []);

  const handleLoginSuccess = useCallback((_verifiedPhone: string) => {
    // Legacy OTP can no longer promote client-side identity.
  }, []);

  return {
    isLoggedIn: false,
    phone: '',
    clientName: '',
    clientEmail: '',
    isCheckingSession: false,
    handleLoginSuccess,
    validateSession,
  };
}
