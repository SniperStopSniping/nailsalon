'use client';

/**
 * Meta Status Panel Component
 *
 * Read-only panel showing Meta Graph API configuration status.
 * Shows env var presence (not values) and latest autopost failure.
 */

import { AlertTriangle, Check, Clock, Cloud, X } from 'lucide-react';

// =============================================================================
// TYPES
// =============================================================================

type MetaStatus = {
  hasSystemUserToken: boolean;
  hasFacebookPageId: boolean;
  hasInstagramAccountId: boolean;
  graphVersion: string;
};

type AutopostFailure = {
  platform: string;
  error: string | null;
  retryCount: number;
  processedAt: string | null;
};

type MetaStatusPanelProps = {
  status: MetaStatus;
  latestFailure?: AutopostFailure | null;
  scope?: 'global' | 'salon';
};

// =============================================================================
// COMPONENT
// =============================================================================

export function MetaStatusPanel({
  status,
  latestFailure,
  scope = 'salon',
}: MetaStatusPanelProps) {
  const allConfigured = status.hasSystemUserToken && status.hasFacebookPageId && status.hasInstagramAccountId;

  return (
    <div className="rounded-xl bg-white p-5 shadow-sm">
      <div className="mb-4 flex items-center gap-2">
        <Cloud className="size-5 text-blue-500" />
        <h3 className="font-semibold text-gray-900">Meta Integration Status</h3>
      </div>

      {/* Configuration Status */}
      <div className="mb-4 space-y-3">
        <StatusRow
          label="System User Token"
          configured={status.hasSystemUserToken}
        />
        <StatusRow
          label="Facebook Page ID"
          configured={status.hasFacebookPageId}
        />
        <StatusRow
          label="Instagram Account ID"
          configured={status.hasInstagramAccountId}
        />
        <div className="flex items-center justify-between text-sm">
          <span className="text-gray-600">Graph API Version</span>
          <span className="font-mono text-gray-900">{status.graphVersion}</span>
        </div>
      </div>

      {/* Overall Status */}
      {allConfigured
        ? (
            <div className="flex items-center gap-2 rounded-lg border border-green-200 bg-green-50 p-3">
              <Check className="size-4 text-green-600" />
              <span className="text-sm text-green-700">
                Meta integration is configured and ready
              </span>
            </div>
          )
        : (
            <div className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3">
              <AlertTriangle className="size-4 text-amber-600" />
              <span className="text-sm text-amber-700">
                Meta integration is not fully configured
              </span>
            </div>
          )}

      {/* Cloudinary Warning */}
      <div className="mt-4 rounded-lg border border-gray-200 bg-gray-50 p-3">
        <p className="text-xs text-gray-600">
          <strong>Note:</strong>
          {' '}
          Meta must be able to fetch Cloudinary URLs. Ensure your Cloudinary
          delivery settings allow public access or generate signed URLs with TTL &gt; 1 hour.
        </p>
      </div>

      {/* Latest Failure */}
      {latestFailure && (
        <div className="mt-4 border-t pt-4">
          <div className="mb-2 flex items-center gap-2">
            <X className="size-4 text-red-500" />
            <span className="text-sm font-medium text-gray-900">
              Latest
              {' '}
              {scope === 'global' ? 'Platform' : 'Salon'}
              {' '}
              Failure
            </span>
          </div>
          <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm">
            <div className="mb-2 flex items-start justify-between">
              <span className="font-medium capitalize text-red-800">
                {latestFailure.platform}
              </span>
              <span className="text-xs text-red-600">
                Retry #
                {latestFailure.retryCount}
              </span>
            </div>
            {latestFailure.error && (
              <p className="mb-2 line-clamp-2 text-xs text-red-700">
                {latestFailure.error.length > 150
                  ? `${latestFailure.error.slice(0, 150)}...`
                  : latestFailure.error}
              </p>
            )}
            {latestFailure.processedAt && (
              <div className="flex items-center gap-1 text-xs text-red-600">
                <Clock className="size-3" />
                {new Date(latestFailure.processedAt).toLocaleString()}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// =============================================================================
// STATUS ROW COMPONENT
// =============================================================================

function StatusRow({
  label,
  configured,
}: {
  label: string;
  configured: boolean;
}) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-gray-600">{label}</span>
      {configured
        ? (
            <span className="flex items-center gap-1 text-green-600">
              <Check className="size-4" />
              Configured
            </span>
          )
        : (
            <span className="flex items-center gap-1 text-red-500">
              <X className="size-4" />
              Missing
            </span>
          )}
    </div>
  );
}
