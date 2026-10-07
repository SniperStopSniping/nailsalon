import Link from 'next/link';

import { OwnerSignInCard } from '@/components/auth/OwnerSignInCard';

import { LusterEntryShell, LusterWordmark } from './LusterEntryShell';

export function OwnerSignInScreen({ className, createSalonUrl, dashboardUrl }: {
  className?: string;
  createSalonUrl?: string;
  dashboardUrl: string;
}) {
  return (
    <LusterEntryShell className={className}>
      <main>
        <LusterWordmark />
        <header className="luster-entry-header">
          <h1>Welcome back</h1>
          <p>Sign in to manage your salon, bookings and clients.</p>
        </header>
        <OwnerSignInCard dashboardUrl={dashboardUrl} createSalonUrl={createSalonUrl} />
        <nav className="luster-auth-legal" aria-label="Legal">
          <Link href="/privacy">Privacy</Link>
          <span aria-hidden="true">·</span>
          <Link href="/terms">Terms</Link>
        </nav>
      </main>
    </LusterEntryShell>
  );
}
