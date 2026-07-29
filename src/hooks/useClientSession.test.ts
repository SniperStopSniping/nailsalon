import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useClientSession } from './useClientSession';

describe('useClientSession retirement adapter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('is immediately signed out without probing validate-session', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const { result } = renderHook(() => useClientSession());

    expect(result.current).toMatchObject({
      isLoggedIn: false,
      phone: '',
      clientName: '',
      clientEmail: '',
      isCheckingSession: false,
    });

    await act(async () => {
      await result.current.validateSession();
    });

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('cannot promote browser state after a legacy OTP callback', () => {
    const { result } = renderHook(() => useClientSession());

    act(() => {
      result.current.handleLoginSuccess('+15551234567');
    });

    expect(result.current.isLoggedIn).toBe(false);
    expect(result.current.phone).toBe('');
  });
});
