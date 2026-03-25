import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useClientSession } from './useClientSession';

describe('useClientSession', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('validates the server-backed session instead of trusting URL state', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      valid: true,
      phone: '+15551234567',
      clientName: 'Ava',
      clientEmail: 'ava@example.com',
    })));
    vi.stubGlobal('fetch', fetchMock);

    const { result } = renderHook(() => useClientSession());

    await waitFor(() => {
      expect(result.current.isCheckingSession).toBe(false);
    });

    expect(fetchMock).toHaveBeenCalledWith('/api/auth/validate-session', {
      cache: 'no-store',
    });
    expect(result.current.isLoggedIn).toBe(true);
    expect(result.current.phone).toBe('+15551234567');
    expect(result.current.clientName).toBe('Ava');
    expect(result.current.clientEmail).toBe('ava@example.com');
  });

  it('lets OTP login promote the session client-side after verification', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      valid: false,
    })));
    vi.stubGlobal('fetch', fetchMock);

    const { result } = renderHook(() => useClientSession());

    await waitFor(() => {
      expect(result.current.isCheckingSession).toBe(false);
    });

    act(() => {
      result.current.handleLoginSuccess('+15551234567');
    });

    expect(result.current.isLoggedIn).toBe(true);
    expect(result.current.phone).toBe('+15551234567');
    expect(result.current.clientName).toBe('');
    expect(result.current.clientEmail).toBe('');
  });
});
