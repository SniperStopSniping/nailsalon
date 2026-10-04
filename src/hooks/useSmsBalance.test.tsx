import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { SMS_BALANCE_CHANGED_EVENT } from '@/libs/commercialPolicy';

import { useSmsBalance } from './useSmsBalance';

const fetchMock = vi.fn();
const response = (availableCredits: number) => Response.json({ data: { usage: { availableCredits } } });

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

describe('salon text balance', () => {
  it('refreshes after sends and window focus', async () => {
    fetchMock.mockResolvedValueOnce(response(42)).mockResolvedValueOnce(response(41)).mockResolvedValueOnce(response(40));
    const { result } = renderHook(() => useSmsBalance('salon-a'));
    await waitFor(() => expect(result.current).toBe(42));
    act(() => window.dispatchEvent(new Event(SMS_BALANCE_CHANGED_EVENT)));
    await waitFor(() => expect(result.current).toBe(41));
    act(() => window.dispatchEvent(new Event('focus')));
    await waitFor(() => expect(result.current).toBe(40));
  });

  it('clears a switched salon immediately and ignores its late response', async () => {
    let resolveOld!: (value: Response) => void;
    fetchMock.mockImplementationOnce(() => new Promise<Response>((resolve) => {
      resolveOld = resolve;
    }));
    fetchMock.mockResolvedValueOnce(response(8));
    const { result, rerender } = renderHook(({ slug }) => useSmsBalance(slug), { initialProps: { slug: 'salon-a' } });
    rerender({ slug: 'salon-b' });

    expect(result.current).toBeNull();

    await waitFor(() => expect(result.current).toBe(8));
    await act(async () => resolveOld(response(999)));

    expect(result.current).toBe(8);

    rerender({ slug: '' });

    expect(result.current).toBeNull();
  });

  it('does not let an earlier request replace the latest balance', async () => {
    let resolveOld!: (value: Response) => void;
    fetchMock.mockImplementationOnce(() => new Promise<Response>((resolve) => {
      resolveOld = resolve;
    }));
    fetchMock.mockResolvedValueOnce(response(0));
    const { result } = renderHook(() => useSmsBalance('salon-a'));
    act(() => window.dispatchEvent(new Event(SMS_BALANCE_CHANGED_EVENT)));
    await waitFor(() => expect(result.current).toBe(0));
    await act(async () => resolveOld(response(99)));

    expect(result.current).toBe(0);
  });
});
