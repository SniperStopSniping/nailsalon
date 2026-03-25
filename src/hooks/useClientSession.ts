'use client';

import { useCallback, useEffect, useState } from 'react';

type SessionResponse = {
  valid?: boolean;
  phone?: string;
  clientName?: string | null;
  clientEmail?: string | null;
};

export function useClientSession() {
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [phone, setPhone] = useState('');
  const [clientName, setClientName] = useState('');
  const [clientEmail, setClientEmail] = useState('');
  const [isCheckingSession, setIsCheckingSession] = useState(true);

  const validateSession = useCallback(async () => {
    setIsCheckingSession(true);

    try {
      const response = await fetch('/api/auth/validate-session', {
        cache: 'no-store',
      });
      const data = await response.json().catch(() => null) as SessionResponse | null;

      if (response.ok && data?.valid && data.phone) {
        setIsLoggedIn(true);
        setPhone(data.phone);
        setClientName(data.clientName ?? '');
        setClientEmail(data.clientEmail ?? '');
      } else {
        setIsLoggedIn(false);
        setPhone('');
        setClientName('');
        setClientEmail('');
      }
    } catch {
      setIsLoggedIn(false);
      setPhone('');
      setClientName('');
      setClientEmail('');
    } finally {
      setIsCheckingSession(false);
    }
  }, []);

  useEffect(() => {
    void validateSession();
  }, [validateSession]);

  const handleLoginSuccess = useCallback((verifiedPhone: string) => {
    setIsLoggedIn(true);
    setPhone(verifiedPhone);
    setClientName('');
    setClientEmail('');
    setIsCheckingSession(false);
  }, []);

  return {
    isLoggedIn,
    phone,
    clientName,
    clientEmail,
    isCheckingSession,
    handleLoginSuccess,
    validateSession,
  };
}
