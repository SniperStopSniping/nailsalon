'use client';

import { Gift, Handshake, User } from 'lucide-react';
import { useRouter } from 'next/navigation';

const triggerHaptic = () => {
  if (typeof navigator !== 'undefined' && navigator.vibrate) {
    navigator.vibrate(10);
  }
};

/**
 * Shared floating dock for booking pages.
 * Shows navigation to Invite, Rewards, and Profile.
 * Used on service, tech, and time booking steps.
 */
export function BookingFloatingDock() {
  const router = useRouter();

  return (
    <div
      role="navigation"
      aria-label="Bottom Navigation"
      className="bg-[var(--n5-bg-card)]/90 fixed bottom-6 left-1/2 z-50 flex h-16 w-[90%] max-w-[400px] -translate-x-1/2 items-center justify-between rounded-[2rem] border border-white/50 px-8 shadow-[var(--n5-shadow-dock)] backdrop-blur-xl"
    >
      <button
        type="button"
        onClick={() => {
          triggerHaptic();
          router.push('/invite');
        }}
        aria-label="Go to Invite"
        className="p-2 text-[var(--n5-accent)] transition-colors hover:text-[var(--n5-accent-hover)]"
      >
        <Handshake strokeWidth={2} className="size-6" />
      </button>
      <button
        type="button"
        onClick={() => {
          triggerHaptic();
          router.push('/rewards');
        }}
        aria-label="Go to Rewards"
        className="p-2 text-[var(--n5-accent)] transition-colors hover:text-[var(--n5-accent-hover)]"
      >
        <Gift strokeWidth={2} className="size-6" />
      </button>
      <button
        type="button"
        onClick={() => {
          triggerHaptic();
          router.push('/profile');
        }}
        aria-label="Go to Profile"
        className="p-2 text-[var(--n5-accent)] transition-colors hover:text-[var(--n5-accent-hover)]"
      >
        <User strokeWidth={2} className="size-6" />
      </button>
    </div>
  );
}
