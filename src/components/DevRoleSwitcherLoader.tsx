'use client';

import dynamic from 'next/dynamic';

// Keep the development-only switcher out of server rendering. Next.js 15
// requires the no-SSR dynamic boundary itself to live in a Client Component.
const DevRoleSwitcher = dynamic(() => import('./DevRoleSwitcher'), { ssr: false });

export function DevRoleSwitcherLoader() {
  return process.env.NODE_ENV !== 'production'
    && process.env.NEXT_PUBLIC_DEV_MODE === 'true'
    ? <DevRoleSwitcher />
    : null;
}
