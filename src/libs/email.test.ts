/* eslint-disable import/first */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { fetchMock } = vi.hoisted(() => ({ fetchMock: vi.fn() }));

vi.mock('server-only', () => ({}));
vi.mock('@/libs/Env', () => ({
  Env: {
    RESEND_API_KEY: 'test-key',
    RESEND_FROM_EMAIL: 'noreply@example.invalid',
    RESEND_REPLY_TO_EMAIL: '',
  },
}));

import { sendTransactionalEmailDetailed } from './email';

const EMAIL = {
  to: 'owner@example.invalid',
  subject: 'Calendar disconnected',
  html: '<p>Reconnect</p>',
  text: 'Reconnect',
};

describe('transactional email execution bounds', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('aborts a provider request at the caller-supplied timeout', async () => {
    vi.useFakeTimers();
    let dispatchedSignal: AbortSignal | undefined;
    fetchMock.mockImplementation(async (_url: string, init?: RequestInit) => {
      dispatchedSignal = init?.signal ?? undefined;
      return await new Promise<Response>((_resolve, reject) => {
        dispatchedSignal?.addEventListener('abort', () => reject(dispatchedSignal?.reason), {
          once: true,
        });
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = sendTransactionalEmailDetailed(EMAIL, { timeoutMs: 1_000 });

    await vi.advanceTimersByTimeAsync(1_001);

    await expect(result).resolves.toEqual({
      ok: false,
      errorCode: 'RESEND_TIMEOUT',
      providerMessageId: null,
    });
    expect(dispatchedSignal?.aborted).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('does not dispatch when the parent operation already lost ownership', async () => {
    const controller = new AbortController();
    controller.abort(new Error('lease lost'));
    vi.stubGlobal('fetch', fetchMock);

    await expect(sendTransactionalEmailDetailed(EMAIL, {
      signal: controller.signal,
      timeoutMs: 1_000,
    })).resolves.toEqual({
      ok: false,
      errorCode: 'RESEND_ABORTED',
      providerMessageId: null,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
