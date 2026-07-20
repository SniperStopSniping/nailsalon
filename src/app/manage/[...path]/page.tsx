import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { verifyAppointmentAccessToken } from '@/libs/appointmentAccess';
import { AppConfig } from '@/utils/AppConfig';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  robots: { index: false, follow: false, nocache: true },
};

/**
 * Host-relative management links.
 *
 * Salons on a custom domain (or a tenant subdomain) receive links shaped
 * `https://their-domain/manage/<token>` — there is no locale/slug prefix to
 * hang them on, and before this route those links 404'd. The token itself
 * identifies the salon, so resolve it server-side and continue to the
 * canonical tenant path on the same host, preserving any sub-path
 * (`/reschedule`, `/calendar.ics`).
 *
 * An unresolvable token gets the same generic invalid-link page as everywhere
 * else — never a redirect into the public booking flow, and never a hint about
 * which salon or appointment the token might have belonged to.
 */
export default async function HostRelativeManageRedirect({ params }: { params: { path: string[] } }) {
  const [token, ...rest] = params.path;
  const capability = token ? await verifyAppointmentAccessToken(token) : null;

  if (!capability?.salonSlug) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-stone-50 px-4 py-14">
        <div className="w-full max-w-md rounded-3xl bg-white p-8 text-center shadow-sm">
          <h1 className="text-2xl font-semibold text-stone-900">This link is not valid</h1>
          <p className="mt-3 text-sm leading-6 text-stone-600">
            The link may have been copied incompletely, or it has already been replaced by a newer one.
            Request a fresh private link from the salon and we will email it to the address on file.
          </p>
        </div>
      </main>
    );
  }

  const suffix = rest.length > 0 ? `/${rest.map(encodeURIComponent).join('/')}` : '';
  redirect(`/${AppConfig.defaultLocale}/${capability.salonSlug}/manage/${encodeURIComponent(token!)}${suffix}`);
}
