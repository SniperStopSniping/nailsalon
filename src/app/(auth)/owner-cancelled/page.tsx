import { ExternalLink, Mail, XCircle } from 'lucide-react';
import Link from 'next/link';

export const metadata = {
  title: 'Account Cancelled',
  description: 'Your salon account has been cancelled.',
};

/**
 * Owner Cancelled Page
 *
 * This page is shown to salon owners when their account has been cancelled.
 * They can view this page but cannot access the admin dashboard.
 */
export default function OwnerCancelledPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 p-4">
      <div className="w-full max-w-md rounded-2xl bg-white p-8 text-center shadow-lg">
        {/* Icon */}
        <div className="mx-auto mb-6 flex size-16 items-center justify-center rounded-full bg-red-100">
          <XCircle className="size-8 text-red-600" />
        </div>

        {/* Title */}
        <h1 className="mb-2 text-2xl font-bold text-gray-900">
          Account Cancelled
        </h1>

        {/* Description */}
        <p className="mb-6 text-gray-600">
          Your salon account has been cancelled. This may be due to a payment issue,
          a request to close the account, or a policy violation.
        </p>

        {/* What you can do */}
        <div className="mb-6 rounded-xl bg-gray-50 p-4 text-left">
          <p className="mb-3 text-sm font-medium text-gray-700">
            What you can do:
          </p>
          <ul className="space-y-2 text-sm text-gray-600">
            <li className="flex items-start gap-2">
              <span className="mt-1 text-gray-400">•</span>
              <span>Contact support to discuss reactivating your account</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="mt-1 text-gray-400">•</span>
              <span>Request a data export of your salon information</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="mt-1 text-gray-400">•</span>
              <span>Create a new salon account if eligible</span>
            </li>
          </ul>
        </div>

        {/* Contact Support */}
        <div className="space-y-3">
          <a
            href="mailto:support@example.com"
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-indigo-600 px-4 py-2.5 font-medium text-white transition-colors hover:bg-indigo-700"
          >
            <Mail className="size-4" />
            Contact Support
          </a>
          <Link
            href="/"
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-gray-100 px-4 py-2.5 font-medium text-gray-700 transition-colors hover:bg-gray-200"
          >
            Go to Homepage
          </Link>
        </div>

        {/* FAQ Link */}
        <div className="mt-6 border-t border-gray-100 pt-6">
          <button
            type="button"
            className="inline-flex items-center gap-1 text-sm text-indigo-600 hover:text-indigo-700"
          >
            View Account Cancellation FAQ
            <ExternalLink className="size-3" />
          </button>
        </div>

        {/* Footer */}
        <p className="mt-6 text-xs text-gray-400">
          If you believe this is an error, please contact our support team
          with your account email address.
        </p>
      </div>
    </div>
  );
}
