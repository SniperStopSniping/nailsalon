import React from 'react';

import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { fetchMock } = vi.hoisted(() => ({
  fetchMock: vi.fn(),
}));

import { BookingPhoneLogin } from './BookingPhoneLogin';

function getVerifyCalls() {
  return fetchMock.mock.calls.filter(([url]) => url === '/api/auth/verify-otp');
}

async function enterVerifyStep() {
  fireEvent.change(screen.getByPlaceholderText('Phone number'), {
    target: { value: '5551234567' },
  });

  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: '→' }));
    await Promise.resolve();
  });

  expect(fetchMock).toHaveBeenNthCalledWith(1, '/api/auth/send-otp', expect.objectContaining({
    method: 'POST',
  }));

  return screen.getByPlaceholderText('• • • • • •');
}

describe('BookingPhoneLogin', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('fires final-digit auto-submit exactly once', async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true, phone: '+15551234567' }),
      });

    const onLoginSuccess = vi.fn();
    render(<BookingPhoneLogin onLoginSuccess={onLoginSuccess} />);

    const codeInput = await enterVerifyStep();

    fireEvent.change(codeInput, {
      target: { value: '123456' },
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
      await Promise.resolve();
    });

    expect(getVerifyCalls()).toHaveLength(1);
    expect(onLoginSuccess).toHaveBeenCalledTimes(1);
    expect(onLoginSuccess).toHaveBeenCalledWith('+15551234567');
  });

  it('fires Enter-triggered verify exactly once even with a pending auto-submit timer', async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true, phone: '+15551234567' }),
      });

    const onLoginSuccess = vi.fn();
    render(<BookingPhoneLogin onLoginSuccess={onLoginSuccess} />);

    const codeInput = await enterVerifyStep();

    fireEvent.change(codeInput, {
      target: { value: '123456' },
    });
    fireEvent.keyDown(codeInput, { key: 'Enter' });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
      await Promise.resolve();
    });

    expect(getVerifyCalls()).toHaveLength(1);
    expect(onLoginSuccess).toHaveBeenCalledTimes(1);
  });

  it('ignores rapid repeated verify triggers after the code is complete', async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true, phone: '+15551234567' }),
      });

    const onLoginSuccess = vi.fn();
    render(<BookingPhoneLogin onLoginSuccess={onLoginSuccess} />);

    const codeInput = await enterVerifyStep();

    fireEvent.change(codeInput, {
      target: { value: '123456' },
    });

    const verifyButton = screen.getByRole('button', { name: 'Verify' });
    fireEvent.click(verifyButton);
    fireEvent.keyDown(codeInput, { key: 'Enter' });
    fireEvent.click(verifyButton);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
      await Promise.resolve();
    });

    expect(getVerifyCalls()).toHaveLength(1);
    expect(onLoginSuccess).toHaveBeenCalledTimes(1);
  });

  it('does not retry the same 6-digit code until the user edits it below 6 digits', async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true }),
      })
      .mockResolvedValueOnce({
        ok: false,
        json: async () => ({
          error: 'This verification code is incorrect or no longer current. Please request a new code and try again.',
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true, phone: '+15551234567' }),
      });

    const onLoginSuccess = vi.fn();
    render(<BookingPhoneLogin onLoginSuccess={onLoginSuccess} />);

    const codeInput = await enterVerifyStep();

    fireEvent.change(codeInput, {
      target: { value: '123456' },
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
      await Promise.resolve();
    });

    expect(getVerifyCalls()).toHaveLength(1);
    expect(onLoginSuccess).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Verify' }));
    fireEvent.keyDown(codeInput, { key: 'Enter' });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
      await Promise.resolve();
    });

    expect(getVerifyCalls()).toHaveLength(1);

    fireEvent.change(codeInput, {
      target: { value: '12345' },
    });
    fireEvent.change(codeInput, {
      target: { value: '123456' },
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
      await Promise.resolve();
    });

    expect(getVerifyCalls()).toHaveLength(2);
    expect(onLoginSuccess).toHaveBeenCalledTimes(1);
  });
});
