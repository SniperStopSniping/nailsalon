import { XCircle, Mail, ExternalLink } from 'lucide-react';
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
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="max-w-md w-full bg-white rounded-2xl shadow-lg p-8 text-center">
        {/* Icon */}
        <div className="mx-auto w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mb-6">
          <XCircle className="w-8 h-8 text-red-600" />
        </div>

        {/* Title */}
        <h1 className="text-2xl font-bold text-gray-900 mb-2">
          Account Cancelled
        </h1>

        {/* Description */}
        <p className="text-gray-600 mb-6">
          Your salon account has been cancelled. This may be due to a payment issue, 
          a request to close the account, or a policy violation.
        </p>

        {/* What you can do */}
        <div className="bg-gray-50 rounded-xl p-4 mb-6 text-left">
          <p className="text-sm font-medium text-gray-700 mb-3">
            What you can do:
          </p>
          <ul className="space-y-2 text-sm text-gray-600">
            <li className="flex items-start gap-2">
              <span className="text-gray-400 mt-1">•</span>
              <span>Contact support to discuss reactivating your account</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-gray-400 mt-1">•</span>
              <span>Request a data export of your salon information</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-gray-400 mt-1">•</span>
              <span>Create a new salon account if eligible</span>
            </li>
          </ul>
        </div>

        {/* Contact Support */}
        <div className="space-y-3">
          <a
            href="mailto:support@example.com"
            className="flex items-center justify-center gap-2 w-full px-4 py-2.5 bg-indigo-600 text-white font-medium rounded-lg hover:bg-indigo-700 transition-colors"
          >
            <Mail className="w-4 h-4" />
            Contact Support
          </a>
          <Link
            href="/"
            className="flex items-center justify-center gap-2 w-full px-4 py-2.5 bg-gray-100 text-gray-700 font-medium rounded-lg hover:bg-gray-200 transition-colors"
          >
            Go to Homepage
          </Link>
        </div>

        {/* FAQ Link */}
        <div className="mt-6 pt-6 border-t border-gray-100">
          <a
            href="#"
            className="inline-flex items-center gap-1 text-sm text-indigo-600 hover:text-indigo-700"
          >
            View Account Cancellation FAQ
            <ExternalLink className="w-3 h-3" />
          </a>
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
