'use client';

import { BadgeDollarSign, Gift, Star, Users } from 'lucide-react';
import { useState } from 'react';

import { BackButton, ModalHeader } from './AppModal';
import { OwnerAppHub, type OwnerAppHubItem } from './OwnerAppHub';
import { ReviewsModal } from './ReviewsModal';
import { RewardsModal } from './RewardsModal';

type RewardsReviewsView = 'home' | 'rewards' | 'referrals' | 'reviews' | 'offers';

const ITEMS: ReadonlyArray<OwnerAppHubItem<Exclude<RewardsReviewsView, 'home'>>> = [
  { id: 'rewards', title: 'Rewards Program', description: 'Active, used and expired client rewards', icon: Gift },
  { id: 'referrals', title: 'Referrals', description: 'Sent, claimed, booked and earned referrals', icon: Users },
  { id: 'reviews', title: 'Reviews', description: 'Review results and manual reward grants', icon: Star },
  { id: 'offers', title: 'Offers', description: 'Current referral, friend, review and visit offers', icon: BadgeDollarSign },
];

export function RewardsReviewsModal({
  onClose,
  initialView = 'home',
  rewardsAvailable = true,
  reviewsAvailable = true,
}: {
  onClose: () => void;
  initialView?: RewardsReviewsView;
  rewardsAvailable?: boolean;
  reviewsAvailable?: boolean;
}) {
  const [view, setView] = useState<RewardsReviewsView>(initialView);
  const items = ITEMS.map(item => item.id === 'reviews'
    ? { ...item, disabled: !reviewsAvailable, status: reviewsAvailable ? undefined : 'Not included on this plan' }
    : item.id === 'rewards' || item.id === 'referrals' || item.id === 'offers'
      ? { ...item, disabled: !rewardsAvailable, status: rewardsAvailable ? undefined : 'Turn on Rewards in Features' }
      : item);

  if (view === 'home') {
    return <OwnerAppHub title="Rewards & Reviews" subtitle="Loyalty, referrals and client feedback" items={items} onBack={onClose} onOpen={setView} />;
  }
  if (view === 'reviews') {
    return <ReviewsModal onClose={() => setView('home')} />;
  }
  if (view === 'rewards' || view === 'referrals') {
    return <RewardsModal onClose={() => setView('home')} initialTab={view} />;
  }

  return (
    <div className="flex min-h-full w-full flex-col bg-[var(--owner-ground)] text-[var(--owner-ink)]">
      <ModalHeader title="Offers" subtitle="Current rewards offered to clients" leftAction={<BackButton onClick={() => setView('home')} label="Rewards & Reviews" />} />
      <div className="px-4 pb-10">
        <div className="overflow-hidden rounded-2xl border border-[var(--owner-line)] bg-[var(--owner-surface)]">
          {[
            ['Referral reward', '$10 for the referrer'],
            ['Friend offer', '$10 off first appointment'],
            ['Google review reward', '$10 off · granted manually'],
            ['Visit earning', '20 points per $1 spent'],
          ].map(([label, value], index, rows) => (
            <div className={`flex min-h-14 items-center justify-between gap-4 px-4 py-3 ${index < rows.length - 1 ? 'border-b border-[var(--owner-line)]' : ''}`} key={label}>
              <span className="text-[15px]">{label}</span>
              <span className="text-right text-[14px] font-medium text-[var(--owner-muted)]">{value}</span>
            </div>
          ))}
        </div>
        <p className="mt-3 text-[13px] leading-5 text-[var(--owner-muted)]">These are the current Luster program values. They are shown here as program rules, not feature-entitlement settings.</p>
      </div>
    </div>
  );
}
