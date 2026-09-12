import type { Metadata } from 'next';

import { LuckyCharmLab } from '@/components/labs/LuckyCharmLab';

export const metadata: Metadata = {
  title: 'Lucky Charm Loading Lab · Luster',
  description: 'An isolated motion and material study for Luster loading states.',
};

export default function LuckyCharmLabPage() {
  return <LuckyCharmLab />;
}
