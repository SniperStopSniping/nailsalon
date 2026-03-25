import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Canvas OS Dev',
  description: 'Development tools for Canvas Flow OS',
};

/**
 * Root layout for (dev) route group.
 * Minimal layout for development/debugging pages.
 * Does not include auth, i18n, or salon context.
 */
export default function DevLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
