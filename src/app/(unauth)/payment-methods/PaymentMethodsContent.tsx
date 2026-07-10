'use client';

import { motion } from 'framer-motion';
import {
  Banknote,
  ChevronRight,
  CreditCard,
  Gift,
  Home,
  Lock,
  Sparkles,
  User,
} from 'lucide-react';
import { useParams, useRouter } from 'next/navigation';
import React, { useCallback } from 'react';

import { appendSalonSlug } from '@/libs/bookingParams';
import { n5 } from '@/theme';

// Simple web haptic helper
const triggerHaptic = () => {
  if (typeof window !== 'undefined' && 'vibrate' in navigator) {
    navigator.vibrate(10);
  }
};

/**
 * Payments Page
 *
 * Honest payment info for clients: payment happens in person at the salon.
 * Online card storage / deposits are intentionally NOT promised here —
 * this page should only start offering card management once Stripe is
 * actually configured and a real payment-methods API exists.
 */
export default function PaymentMethodsContent({
  salonSlug,
}: {
  salonSlug?: string | null;
}) {
  const router = useRouter();
  const params = useParams();
  const locale = (params?.locale as string) || 'en';
  const routeSalonSlug = typeof params?.slug === 'string' ? params.slug : null;

  const handleBack = useCallback(() => {
    triggerHaptic();
    router.back();
  }, [router]);

  const handleNavigate = useCallback(
    (path: string) => {
      router.push(
        appendSalonSlug(path, salonSlug, {
          routeSalonSlug,
          locale,
        }),
      );
    },
    [locale, routeSalonSlug, router, salonSlug],
  );

  return (
    <div
      className="min-h-screen bg-[var(--n5-bg-page)]"
      style={{ fontFamily: n5.fontBody }}
    >
      {/* Navbar - Fixed & Blurred */}
      <nav
        className="fixed inset-x-0 top-0 z-40 flex items-center justify-between border-b px-5 pb-2 pt-12 backdrop-blur-md"
        style={{
          backgroundColor: 'color-mix(in srgb, var(--n5-bg-page) 80%, transparent)',
          borderColor: 'var(--n5-border-muted)',
        }}
      >
        <button
          type="button"
          onClick={handleBack}
          aria-label="Go back"
          className="flex size-10 items-center justify-center bg-[var(--n5-bg-card)] text-[var(--n5-ink-main)] shadow-sm transition-transform active:scale-90"
          style={{ borderRadius: n5.radiusPill }}
        >
          <ChevronRight className="size-5 rotate-180" />
        </button>
        <span className="font-heading text-lg font-semibold tracking-tight text-[var(--n5-ink-main)]">
          Payments
        </span>
        <div className="size-10" />
      </nav>

      {/* Main Content */}
      <main className="mx-auto max-w-lg space-y-4 px-5 pb-36 pt-28">
        <p className="font-body mb-2 text-center text-sm text-[var(--n5-ink-muted)]">
          How paying for your appointment works.
        </p>

        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="space-y-4"
        >
          {/* Pay at your visit */}
          <section
            className="border bg-[var(--n5-bg-card)] p-6"
            style={{
              borderRadius: n5.radiusCard,
              borderColor: 'var(--n5-border)',
              boxShadow: n5.shadowSm,
            }}
          >
            <div className="flex flex-col items-center text-center">
              <div
                className="mb-4 flex size-16 items-center justify-center rounded-full border border-[var(--n5-border)]"
                style={{
                  background: 'linear-gradient(to top right, var(--n5-bg-page), white)',
                }}
              >
                <Banknote size={28} strokeWidth={1.5} className="text-[var(--n5-accent)]" />
              </div>
              <h2 className="font-heading mb-2 text-xl tracking-tight text-[var(--n5-ink-main)]">
                Pay at your visit
              </h2>
              <p className="font-body text-sm leading-relaxed text-[var(--n5-ink-muted)]">
                No payment is needed to book. You pay in person at the end of
                your appointment — cash and card are both accepted at the
                front desk.
              </p>
            </div>
          </section>

          {/* Rewards note */}
          <section
            className="flex items-start gap-3 border bg-[var(--n5-bg-card)] p-5"
            style={{
              borderRadius: n5.radiusCard,
              borderColor: 'var(--n5-border)',
            }}
          >
            <Gift className="mt-0.5 size-5 shrink-0 text-[var(--n5-accent)]" />
            <div>
              <h3 className="font-body text-sm font-bold text-[var(--n5-ink-main)]">
                Rewards apply automatically
              </h3>
              <p className="font-body mt-1 text-[13px] leading-relaxed text-[var(--n5-ink-muted)]">
                If you redeem a reward when booking, the discount is already
                reflected in your total — just pay the discounted amount at
                the salon.
              </p>
            </div>
          </section>

          {/* Online payments - coming soon, no false promises */}
          <section
            className="border border-dashed p-5"
            style={{
              borderRadius: n5.radiusCard,
              borderColor: 'var(--n5-border)',
            }}
          >
            <div className="flex items-start gap-3">
              <CreditCard className="mt-0.5 size-5 shrink-0 text-[var(--n5-ink-muted)]" />
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="font-body text-sm font-bold text-[var(--n5-ink-main)]">
                    Saved cards &amp; online deposits
                  </h3>
                  <span
                    className="font-body rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-[var(--n5-ink-muted)]"
                    style={{ backgroundColor: 'var(--n5-bg-surface)' }}
                  >
                    Coming soon
                  </span>
                </div>
                <p className="font-body mt-1 text-[13px] leading-relaxed text-[var(--n5-ink-muted)]">
                  Securely saving a card and paying deposits online isn&apos;t
                  available yet. Until then, nothing is charged online.
                </p>
              </div>
            </div>
          </section>

          {/* Security footer */}
          <div className="flex items-center justify-center gap-1.5 pt-4 opacity-50">
            <Lock className="size-3 text-[var(--n5-ink-muted)]" />
            <p className="font-body text-[11px] text-[var(--n5-ink-muted)]">
              We never ask for card details by text or phone.
            </p>
          </div>
        </motion.div>
      </main>

      {/* Floating dock */}
      <div
        className="fixed bottom-6 left-1/2 z-50 flex h-16 w-[90%] max-w-[400px] -translate-x-1/2 items-center justify-between px-8"
        style={{
          backgroundColor: 'var(--n5-bg-card)',
          backdropFilter: 'blur(20px) saturate(150%)',
          WebkitBackdropFilter: 'blur(20px) saturate(150%)',
          borderWidth: 1,
          borderColor: 'var(--n5-border)',
          boxShadow: n5.shadowDock,
          borderRadius: n5.radiusCard,
        }}
        role="navigation"
        aria-label="Bottom Navigation"
      >
        <button
          type="button"
          onClick={() => {
            triggerHaptic();
            handleNavigate('/book');
          }}
          aria-label="Book"
          className="flex flex-col items-center gap-1 text-[var(--n5-ink-muted)] transition-colors active:text-[var(--n5-accent)]"
        >
          <Home className="size-5" />
          <span className="font-body text-[10px] font-bold uppercase tracking-wider">Book</span>
        </button>
        <button
          type="button"
          onClick={() => {
            triggerHaptic();
            handleNavigate('/rewards');
          }}
          aria-label="Rewards"
          className="flex flex-col items-center gap-1 text-[var(--n5-ink-muted)] transition-colors active:text-[var(--n5-accent)]"
        >
          <Sparkles className="size-5" />
          <span className="font-body text-[10px] font-bold uppercase tracking-wider">Rewards</span>
        </button>
        <button
          type="button"
          onClick={() => {
            triggerHaptic();
            handleNavigate('/profile');
          }}
          aria-label="Profile"
          className="flex flex-col items-center gap-1 text-[var(--n5-ink-muted)] transition-colors active:text-[var(--n5-accent)]"
        >
          <User className="size-5" />
          <span className="font-body text-[10px] font-bold uppercase tracking-wider">Profile</span>
        </button>
      </div>
    </div>
  );
}
