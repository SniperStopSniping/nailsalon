'use client';

import { AlertTriangle, X, ExternalLink } from 'lucide-react';
import { useState } from 'react';

interface SuspendedBannerProps {
  /** Custom message to display */
  message?: string;
  /** Whether to show the dismiss button */
  dismissible?: boolean;
  /** Contact support URL */
  supportUrl?: string;
}

/**
 * SuspendedBanner - Warning banner for suspended salon accounts
 * 
 * Shows at the top of the admin dashboard when a salon is suspended.
 * Owners can still view data but cannot make changes or accept bookings.
 */
export function SuspendedBanner({
  message = 'Your salon account is temporarily suspended. New bookings and changes are disabled.',
  dismissible = false,
  supportUrl = 'mailto:support@example.com',
}: SuspendedBannerProps) {
  const [dismissed, setDismissed] = useState(false);

  if (dismissed) return null;

  return (
    <div className="bg-amber-50 border-b border-amber-200">
      <div className="px-4 py-3">
        <div className="flex items-start gap-3">
          {/* Icon */}
          <div className="flex-shrink-0">
            <div className="w-8 h-8 rounded-full bg-amber-100 flex items-center justify-center">
              <AlertTriangle className="w-4 h-4 text-amber-600" />
            </div>
          </div>

          {/* Content */}
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-amber-800">
              Account Suspended
            </p>
            <p className="text-sm text-amber-700 mt-0.5">
              {message}
            </p>
            {supportUrl && (
              <a
                href={supportUrl}
                className="inline-flex items-center gap-1 text-sm font-medium text-amber-800 hover:text-amber-900 mt-2"
              >
                Contact Support
                <ExternalLink className="w-3 h-3" />
              </a>
            )}
          </div>

          {/* Dismiss button */}
          {dismissible && (
            <button
              type="button"
              onClick={() => setDismissed(true)}
              className="flex-shrink-0 p-1 rounded-lg text-amber-600 hover:text-amber-800 hover:bg-amber-100 transition-colors"
              aria-label="Dismiss banner"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * CancelledBanner - Error banner for cancelled salon accounts
 * 
 * Shows when a salon account has been cancelled/terminated.
 * More severe styling than suspended banner.
 */
export function CancelledBanner({
  message = 'Your salon account has been cancelled. Please contact support to restore access.',
  supportUrl = 'mailto:support@example.com',
}: {
  message?: string;
  supportUrl?: string;
}) {
  return (
    <div className="bg-red-50 border-b border-red-200">
      <div className="px-4 py-3">
        <div className="flex items-start gap-3">
          {/* Icon */}
          <div className="flex-shrink-0">
            <div className="w-8 h-8 rounded-full bg-red-100 flex items-center justify-center">
              <AlertTriangle className="w-4 h-4 text-red-600" />
            </div>
          </div>

          {/* Content */}
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-red-800">
              Account Cancelled
            </p>
            <p className="text-sm text-red-700 mt-0.5">
              {message}
            </p>
            {supportUrl && (
              <a
                href={supportUrl}
                className="inline-flex items-center gap-1 text-sm font-medium text-red-800 hover:text-red-900 mt-2"
              >
                Contact Support
                <ExternalLink className="w-3 h-3" />
              </a>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * TrialBanner - Info banner for trial accounts
 * 
 * Shows a gentle reminder about trial status with days remaining.
 */
export function TrialBanner({
  daysRemaining = 14,
  upgradeUrl = '/settings/billing',
}: {
  daysRemaining?: number;
  upgradeUrl?: string;
}) {
  const [dismissed, setDismissed] = useState(false);

  if (dismissed) return null;

  const isUrgent = daysRemaining <= 3;

  return (
    <div className={`${isUrgent ? 'bg-amber-50 border-amber-200' : 'bg-blue-50 border-blue-200'} border-b`}>
      <div className="px-4 py-2.5">
        <div className="flex items-center justify-between gap-4">
          <p className={`text-sm ${isUrgent ? 'text-amber-800' : 'text-blue-800'}`}>
            <span className="font-medium">
              {daysRemaining} day{daysRemaining !== 1 ? 's' : ''} left
            </span>{' '}
            in your trial.{' '}
            <a
              href={upgradeUrl}
              className="font-medium underline hover:no-underline"
            >
              Upgrade now
            </a>
          </p>
          <button
            type="button"
            onClick={() => setDismissed(true)}
            className={`flex-shrink-0 p-1 rounded-lg ${
              isUrgent 
                ? 'text-amber-600 hover:text-amber-800 hover:bg-amber-100' 
                : 'text-blue-600 hover:text-blue-800 hover:bg-blue-100'
            } transition-colors`}
            aria-label="Dismiss banner"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
