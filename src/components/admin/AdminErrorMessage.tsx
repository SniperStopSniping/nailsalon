'use client';

/**
 * AdminErrorMessage Component
 *
 * A shared, lightweight error message component for admin UI.
 * Displays a red-styled alert with an optional custom message.
 */

import { AlertCircle } from 'lucide-react';

type AdminErrorMessageProps = {
  /** The error message to display */
  message?: string;
  /** Optional: show a retry button */
  onRetry?: () => void;
};

export function AdminErrorMessage({
  message = 'Something went wrong while loading data.',
  onRetry,
}: AdminErrorMessageProps) {
  return (
    <div className="mt-2 rounded-lg border border-red-200 bg-red-50 p-4">
      <div className="flex items-start gap-3">
        <AlertCircle className="mt-0.5 size-5 shrink-0 text-red-500" />
        <div className="flex-1">
          <p className="text-sm text-red-700">{message}</p>
          {onRetry && (
            <button
              type="button"
              onClick={onRetry}
              className="mt-2 text-xs font-medium text-red-600 transition-colors hover:text-red-800"
            >
              Try again
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
