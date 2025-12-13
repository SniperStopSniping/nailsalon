'use client';

import Link from 'next/link';
import React, { useState } from 'react';

import type { SystemStatusData } from './page';

// =============================================================================
// SYSTEM STATUS CLIENT COMPONENT
// =============================================================================
// Displays platform health and diagnostics for Super Admin.
// Read-only view with retry functionality for failed jobs.
// =============================================================================

type Props = {
  data: SystemStatusData;
  locale: string;
};

export function SystemStatusClient({ data, locale }: Props) {
  const { envStatus, queueSummary, failedJobs } = data;
  const [retryingId, setRetryingId] = useState<string | null>(null);
  const [retryResult, setRetryResult] = useState<{
    id: string;
    success: boolean;
    message: string;
  } | null>(null);

  const handleRetry = async (jobId: string) => {
    setRetryingId(jobId);
    setRetryResult(null);

    try {
      const response = await fetch('/api/super-admin/autopost/retry', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ queueId: jobId }),
      });

      const result = await response.json();

      if (response.ok) {
        setRetryResult({
          id: jobId,
          success: true,
          message: 'Job queued for retry',
        });
      } else {
        setRetryResult({
          id: jobId,
          success: false,
          message: result.error?.message ?? 'Failed to retry',
        });
      }
    } catch {
      setRetryResult({
        id: jobId,
        success: false,
        message: 'Network error',
      });
    } finally {
      setRetryingId(null);
    }
  };

  return (
    <div className="mx-auto max-w-4xl p-6">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900">System Status</h1>
        <p className="text-gray-600">Platform health and diagnostics</p>
      </div>

      {/* Navigation */}
      <div className="mb-8 flex gap-4">
        <Link
          href={`/${locale}/super-admin`}
          className="text-sm text-blue-600 hover:underline"
        >
          ← Back to Dashboard
        </Link>
        <Link
          href={`/${locale}/super-admin/policies`}
          className="text-sm text-blue-600 hover:underline"
        >
          Policy Settings →
        </Link>
      </div>

      {/* Environment Status */}
      <section className="mb-8">
        <h2 className="mb-4 text-lg font-semibold text-gray-800">
          Environment Configuration
        </h2>
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <StatusCard
            label="Meta API"
            configured={envStatus.metaConfigured}
          />
          <StatusCard
            label="Cloudinary"
            configured={envStatus.cloudinaryConfigured}
          />
          <StatusCard
            label="Redis"
            configured={envStatus.redisConfigured}
          />
          <StatusCard
            label="Cron Secret"
            configured={envStatus.cronSecretConfigured}
          />
        </div>
        <p className="mt-2 text-sm text-gray-500">
          Meta Graph Version:
          {' '}
          {envStatus.metaGraphVersion}
        </p>
      </section>

      {/* Queue Summary */}
      <section className="mb-8">
        <h2 className="mb-4 text-lg font-semibold text-gray-800">
          Autopost Queue Summary
        </h2>
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <QueueCard
            label="Queued"
            count={queueSummary.queued}
            color="blue"
          />
          <QueueCard
            label="Processing"
            count={queueSummary.processing}
            color="yellow"
          />
          <QueueCard
            label="Posted"
            count={queueSummary.posted}
            color="green"
          />
          <QueueCard
            label="Failed"
            count={queueSummary.failed}
            color="red"
          />
        </div>
      </section>

      {/* Failed Jobs */}
      <section>
        <h2 className="mb-4 text-lg font-semibold text-gray-800">
          Recent Failed Jobs
        </h2>
        {failedJobs.length === 0
          ? (
              <p className="text-gray-500">No failed jobs</p>
            )
          : (
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-4 py-2 text-left text-xs font-medium uppercase text-gray-500">
                        Platform
                      </th>
                      <th className="px-4 py-2 text-left text-xs font-medium uppercase text-gray-500">
                        Error
                      </th>
                      <th className="px-4 py-2 text-left text-xs font-medium uppercase text-gray-500">
                        Retries
                      </th>
                      <th className="px-4 py-2 text-left text-xs font-medium uppercase text-gray-500">
                        Last Attempt
                      </th>
                      <th className="px-4 py-2 text-left text-xs font-medium uppercase text-gray-500">
                        Action
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200 bg-white">
                    {failedJobs.map(job => (
                      <tr key={job.id}>
                        <td className="whitespace-nowrap px-4 py-2 text-sm">
                          <span className="font-medium capitalize">
                            {job.platform}
                          </span>
                        </td>
                        <td className="max-w-xs truncate px-4 py-2 text-sm text-gray-600">
                          {job.error ?? 'Unknown error'}
                        </td>
                        <td className="whitespace-nowrap px-4 py-2 text-sm">
                          {job.retryCount}
                          /5
                        </td>
                        <td className="whitespace-nowrap px-4 py-2 text-sm text-gray-500">
                          {job.processedAt
                            ? new Date(job.processedAt).toLocaleString()
                            : '-'}
                        </td>
                        <td className="whitespace-nowrap px-4 py-2 text-sm">
                          {retryResult?.id === job.id
                            ? (
                                <span
                                  className={
                                    retryResult.success
                                      ? 'text-green-600'
                                      : 'text-red-600'
                                  }
                                >
                                  {retryResult.message}
                                </span>
                              )
                            : (
                                <button
                                  type="button"
                                  onClick={() => handleRetry(job.id)}
                                  disabled={retryingId === job.id}
                                  className="rounded bg-blue-600 px-3 py-1 text-white hover:bg-blue-700 disabled:opacity-50"
                                >
                                  {retryingId === job.id ? 'Retrying...' : 'Retry'}
                                </button>
                              )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
      </section>

      {/* Health Check Info */}
      <section className="mt-8 rounded-lg border border-gray-200 bg-gray-50 p-4">
        <h3 className="mb-2 font-medium text-gray-800">Health Check Endpoint</h3>
        <p className="mb-2 text-sm text-gray-600">
          Use this endpoint for uptime monitoring:
        </p>
        <code className="block rounded bg-gray-100 p-2 text-sm">
          GET /api/health
        </code>
      </section>
    </div>
  );
}

// =============================================================================
// SUB-COMPONENTS
// =============================================================================

function StatusCard({
  label,
  configured,
}: {
  label: string;
  configured: boolean;
}) {
  return (
    <div className="rounded-lg border bg-white p-4">
      <p className="text-sm font-medium text-gray-600">{label}</p>
      <div className="mt-1 flex items-center gap-2">
        <span
          className={`size-3 rounded-full ${
            configured ? 'bg-green-500' : 'bg-red-500'
          }`}
        />
        <span className="text-sm">
          {configured ? 'Configured' : 'Not configured'}
        </span>
      </div>
    </div>
  );
}

function QueueCard({
  label,
  count,
  color,
}: {
  label: string;
  count: number;
  color: 'blue' | 'yellow' | 'green' | 'red';
}) {
  const colorClasses = {
    blue: 'bg-blue-100 text-blue-800',
    yellow: 'bg-yellow-100 text-yellow-800',
    green: 'bg-green-100 text-green-800',
    red: 'bg-red-100 text-red-800',
  };

  return (
    <div className="rounded-lg border bg-white p-4">
      <p className="text-sm font-medium text-gray-600">{label}</p>
      <p className={`mt-1 inline-block rounded px-2 py-1 text-lg font-bold ${colorClasses[color]}`}>
        {count}
      </p>
    </div>
  );
}
