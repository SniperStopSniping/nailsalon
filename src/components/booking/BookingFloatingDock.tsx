'use client';

import { Gift, Handshake, User } from 'lucide-react';
import { useParams, useRouter } from 'next/navigation';

import { appendSalonSlug } from '@/libs/bookingParams';
import { useSalon } from '@/providers/SalonProvider';

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
  const params = useParams();
  const { salonSlug } = useSalon();
  const routeSalonSlug = typeof params?.slug === 'string' ? params.slug : null;
  const locale = typeof params?.locale === 'string' ? params.locale : null;

  const navigate = (path: string) => {
    triggerHaptic();
    router.push(appendSalonSlug(path, salonSlug, {
      routeSalonSlug,
      locale,
    }));
  };

  const items = [
    { label: 'Invite', path: '/invite', Icon: Handshake },
    { label: 'Rewards', path: '/rewards', Icon: Gift },
    { label: 'Profile', path: '/profile', Icon: User },
  ];

  return (
    <div
      role="navigation"
      aria-label="Bottom Navigation"
      className="fixed bottom-6 left-1/2 z-50 flex h-16 w-[90%] max-w-[400px] -translate-x-1/2 items-center justify-between rounded-[2rem] border border-neutral-800 bg-[#101010]/95 px-7 shadow-[0_14px_40px_rgba(0,0,0,0.45)] backdrop-blur-xl"
    >
      {items.map(({ label, path, Icon }) => (
        <button
          key={path}
          type="button"
          onClick={() => navigate(path)}
          aria-label={`Go to ${label}`}
          className="flex flex-col items-center gap-0.5 p-2 text-[var(--n5-accent)] transition-colors hover:text-white"
        >
          <Icon strokeWidth={2} className="size-5" />
          <span className="text-[10px] font-medium tracking-wide">{label}</span>
        </button>
      ))}
    </div>
  );
}
