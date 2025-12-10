import { Gift, Mail, Phone } from 'lucide-react';
import Link from 'next/link';

export const metadata = {
  title: 'Rewards Unavailable',
  description: 'The rewards program is not currently available for this salon.',
};

export default function RewardsDisabledPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 p-4">
      <div className="w-full max-w-md rounded-2xl bg-white p-8 text-center shadow-lg">
        {/* Icon */}
        <div className="mx-auto mb-6 flex size-16 items-center justify-center rounded-full bg-purple-100">
          <Gift className="size-8 text-purple-600" />
        </div>

        {/* Title */}
        <h1 className="mb-2 text-2xl font-bold text-gray-900">
          Rewards Program Unavailable
        </h1>

        {/* Description */}
        <p className="mb-6 text-gray-600">
          The rewards program is not currently available for this salon.
          Please contact the salon directly for information about promotions
          and special offers.
        </p>

        {/* Contact Info */}
        <div className="mb-6 rounded-xl bg-gray-50 p-4">
          <p className="mb-3 text-sm font-medium text-gray-700">
            Questions? Contact the salon:
          </p>
          <div className="space-y-2">
            <a
              href="tel:"
              className="flex items-center justify-center gap-2 text-sm text-indigo-600 hover:text-indigo-700"
            >
              <Phone className="size-4" />
              Call us
            </a>
            <a
              href="mailto:"
              className="flex items-center justify-center gap-2 text-sm text-indigo-600 hover:text-indigo-700"
            >
              <Mail className="size-4" />
              Email us
            </a>
          </div>
        </div>

        {/* Actions */}
        <div className="space-y-3">
          <Link
            href="/book/service"
            className="block w-full rounded-lg bg-indigo-600 px-4 py-2.5 font-medium text-white transition-colors hover:bg-indigo-700"
          >
            Book an Appointment
          </Link>
          <Link
            href="/"
            className="block w-full rounded-lg bg-gray-100 px-4 py-2.5 font-medium text-gray-700 transition-colors hover:bg-gray-200"
          >
            Go Back Home
          </Link>
        </div>

        {/* Footer */}
        <p className="mt-6 text-xs text-gray-400">
          The rewards program may be temporarily unavailable or not offered by this salon.
        </p>
      </div>
    </div>
  );
}
