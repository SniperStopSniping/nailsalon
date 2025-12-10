import { XCircle, Mail, Phone } from 'lucide-react';
import Link from 'next/link';

export const metadata = {
  title: 'Account Cancelled',
  description: 'This salon account has been cancelled.',
};

export default function CancelledPage() {
  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="max-w-md w-full bg-white rounded-2xl shadow-lg p-8 text-center">
        {/* Icon */}
        <div className="mx-auto w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mb-6">
          <XCircle className="w-8 h-8 text-red-600" />
        </div>

        {/* Title */}
        <h1 className="text-2xl font-bold text-gray-900 mb-2">
          Account No Longer Active
        </h1>

        {/* Description */}
        <p className="text-gray-600 mb-6">
          This salon&apos;s booking system is no longer available. The salon may have 
          closed or moved to a different location.
        </p>

        {/* Contact Info */}
        <div className="bg-gray-50 rounded-xl p-4 mb-6">
          <p className="text-sm font-medium text-gray-700 mb-3">
            Looking for this salon?
          </p>
          <div className="space-y-2">
            <a
              href="tel:"
              className="flex items-center justify-center gap-2 text-sm text-indigo-600 hover:text-indigo-700"
            >
              <Phone className="w-4 h-4" />
              Try contacting by phone
            </a>
            <a
              href="mailto:"
              className="flex items-center justify-center gap-2 text-sm text-indigo-600 hover:text-indigo-700"
            >
              <Mail className="w-4 h-4" />
              Send an email
            </a>
          </div>
        </div>

        {/* Actions */}
        <div className="space-y-3">
          <Link
            href="/"
            className="block w-full px-4 py-2.5 bg-gray-100 text-gray-700 font-medium rounded-lg hover:bg-gray-200 transition-colors"
          >
            Go Back Home
          </Link>
        </div>

        {/* Footer */}
        <p className="mt-6 text-xs text-gray-400">
          We&apos;re sorry for any inconvenience this may have caused.
        </p>
      </div>
    </div>
  );
}
