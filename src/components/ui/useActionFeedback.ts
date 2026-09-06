'use client';

/**
 * useActionFeedback — the "success appears only after confirmation" rule.
 *
 * Pairs with <InlineFeedback>: the hook owns the outcome of one action and the
 * component renders it where the owner acted. Success is only ever set after
 * the promise resolves, so no surface can claim a save the server refused.
 * (Split from inline-feedback.tsx so the component file exports components
 * only — same convention as useFormField.ts.)
 */

import type { ReactNode } from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';

import type { InlineFeedbackTone } from './inline-feedback';

export type ActionFeedback = {
  tone: InlineFeedbackTone;
  message: string;
  detail?: ReactNode;
};

export type ActionFeedbackResult<T>
  = | { status: 'success'; value: T }
  | { status: 'error'; error: unknown };

type RunOptions<T> = {
  /**
   * Shown only after the promise resolves. A function receives the resolved
   * value; returning null suppresses the notice (e.g. the caller navigates
   * away instead).
   */
  success?: string | ((value: T) => string | null);
  /** Fallback message when the rejection carries none. */
  error?: string | ((error: unknown) => string);
  detail?: (value: unknown) => ReactNode;
};

function messageFromError(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  if (typeof error === 'string' && error) {
    return error;
  }
  return fallback;
}

/**
 * Runs an action and reports its outcome through one `feedback` value.
 *
 * The success branch runs *after* the promise resolves — a save is never
 * announced before the server has confirmed it. A rejection becomes an error
 * notice and is not re-thrown; callers read the returned result instead.
 */
export function useActionFeedback(): {
  feedback: ActionFeedback | null;
  pending: boolean;
  run: <T>(action: () => Promise<T>, options?: RunOptions<T>) => Promise<ActionFeedbackResult<T>>;
  showError: (message: string, detail?: ReactNode) => void;
  showSuccess: (message: string, detail?: ReactNode) => void;
  showInfo: (message: string, detail?: ReactNode) => void;
  clear: () => void;
} {
  const [feedback, setFeedback] = useState<ActionFeedback | null>(null);
  const [pending, setPending] = useState(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const set = useCallback((next: ActionFeedback | null) => {
    if (!mountedRef.current) {
      return;
    }
    setFeedback(next);
  }, []);

  const clear = useCallback(() => set(null), [set]);
  const showError = useCallback(
    (message: string, detail?: ReactNode) => set({ tone: 'error', message, detail }),
    [set],
  );
  const showSuccess = useCallback(
    (message: string, detail?: ReactNode) => set({ tone: 'success', message, detail }),
    [set],
  );
  const showInfo = useCallback(
    (message: string, detail?: ReactNode) => set({ tone: 'info', message, detail }),
    [set],
  );

  const run = useCallback(
    async <T>(
      action: () => Promise<T>,
      options: RunOptions<T> = {},
    ): Promise<ActionFeedbackResult<T>> => {
      set(null);
      if (mountedRef.current) {
        setPending(true);
      }
      try {
        const value = await action();
        const successMessage = typeof options.success === 'function'
          ? options.success(value)
          : options.success;
        if (successMessage) {
          set({
            tone: 'success',
            message: successMessage,
            detail: options.detail?.(value),
          });
        }
        return { status: 'success', value };
      } catch (error) {
        // A caller-supplied formatter owns the wording outright; otherwise the
        // rejection's own message is preferred over the generic fallback.
        const message = typeof options.error === 'function'
          ? options.error(error)
          : messageFromError(
            error,
            options.error ?? 'That did not go through. Try again.',
          );
        set({
          tone: 'error',
          message,
          detail: options.detail?.(error),
        });
        return { status: 'error', error };
      } finally {
        if (mountedRef.current) {
          setPending(false);
        }
      }
    },
    [set],
  );

  return { feedback, pending, run, showError, showSuccess, showInfo, clear };
}
