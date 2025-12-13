import { Mail, Phone, XCircle } from 'lucide-react';
import Link from 'next/link';

export const metadata = {
  title: 'Account Cancelled',
  description: 'This salon account has been cancelled.',
};

export default function CancelledPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 p-4">
      <div className="w-full max-w-md rounded-2xl bg-white p-8 text-center shadow-lg">
        {/* Icon */}
        <div className="mx-auto mb-6 flex size-16 items-center justify-center rounded-full bg-red-100">
          <XCircle className="size-8 text-red-600" />
        </div>

        {/* Title */}
        <h1 className="mb-2 text-2xl font-bold text-gray-900">
          Account No Longer Active
        </h1>

        {/* Description */}
        <p className="mb-6 text-gray-600">
          This salon&apos;s booking system is no longer available. The salon may have
          closed or moved to a different location.
        </p>

        {/* Contact Info */}
        <div className="mb-6 rounded-xl bg-gray-50 p-4">
          <p className="mb-3 text-sm font-medium text-gray-700">
            Looking for this salon?
          </p>
          <div className="space-y-2">
            <a
              href="tel:"
              className="flex items-center justify-center gap-2 text-sm text-indigo-600 hover:text-indigo-700"
            >
              <Phone className="size-4" />
              Try contacting by phone
            </a>
            <a
              href="mailto:"
              className="flex items-center justify-center gap-2 text-sm text-indigo-600 hover:text-indigo-700"
            >
              <Mail className="size-4" />
              Send an email
            </a>
          </div>
        </div>

        {/* Actions */}
        <div className="space-y-3">
          <Link
            href="/"
            className="block w-full rounded-lg bg-gray-100 px-4 py-2.5 font-medium text-gray-700 transition-colors hover:bg-gray-200"
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
