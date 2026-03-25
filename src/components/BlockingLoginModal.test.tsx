import React from 'react';

import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { fetchMock } = vi.hoisted(() => ({
  fetchMock: vi.fn(),
}));

import { BlockingLoginModal } from './BlockingLoginModal';

describe('BlockingLoginModal', () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      return setTimeout(() => callback(0), 0) as unknown as number;
    });
    vi.stubGlobal('cancelAnimationFrame', (id: number) => {
      clearTimeout(id);
    });
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
    vi.useRealTimers();
  });

  it('calls onLoginSuccess exactly once after verify succeeds', async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url === '/api/auth/validate-session') {
        return {
          ok: true,
          json: async () => ({ valid: false }),
        };
      }

      if (url === '/api/auth/send-otp') {
        return {
          ok: true,
          json: async () => ({ success: true }),
        };
      }

      if (url === '/api/auth/verify-otp') {
        return {
          ok: true,
          json: async () => ({ success: true, phone: '+15551234567' }),
        };
      }

      throw new Error(`Unexpected fetch in test: ${url}`);
    });

    const onLoginSuccess = vi.fn();

    await act(async () => {
      render(
        <BlockingLoginModal
          isOpen
          onClose={vi.fn()}
          onLoginSuccess={onLoginSuccess}
        />,
      );
      await Promise.resolve();
      await vi.advanceTimersByTimeAsync(150);
    });

    fireEvent.change(screen.getByPlaceholderText('Enter your number'), {
      target: { value: '5551234567' },
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(250);
      await vi.advanceTimersByTimeAsync(150);
      await Promise.resolve();
    });

    const codeInput = screen.getByPlaceholderText('• • • • • •');
    fireEvent.change(codeInput, {
      target: { value: '123456' },
    });

    await act(async () => {
      fireEvent.keyDown(codeInput, { key: 'Enter' });
      await Promise.resolve();
      await vi.advanceTimersByTimeAsync(250);
      await Promise.resolve();
    });

    await act(async () => {
      await vi.runOnlyPendingTimersAsync();
      await Promise.resolve();
    });

    const verifyCalls = fetchMock.mock.calls.filter(([url]) => url === '/api/auth/verify-otp');
    expect(verifyCalls).toHaveLength(1);
    expect(onLoginSuccess).toHaveBeenCalledTimes(1);
    expect(onLoginSuccess).toHaveBeenCalledWith('5551234567');
  });
});
