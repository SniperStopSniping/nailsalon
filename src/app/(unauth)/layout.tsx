'use client';

import { SalonProvider } from '@/providers/SalonProvider';

export default function UnauthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <SalonProvider>{children}</SalonProvider>;
}
