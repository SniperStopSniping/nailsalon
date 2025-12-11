'use client';

import type { Easing } from 'framer-motion';
import {
  AnimatePresence,
  motion,
  useMotionValue,
  useReducedMotion,
  useSpring,
  useTransform,
} from 'framer-motion';
import {
  ChevronRight,
  CreditCard,
  Home,
  Lock,
  Mail,
  Plus,
  Shield,
  Trash2,
  User,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import React, { useCallback, useEffect, useRef, useState } from 'react';

import { n5 } from '@/theme';
import { cn } from '@/utils/Helpers';

// --- Types ---
type CardBrand = 'visa' | 'mastercard' | 'amex' | 'discover';

type PaymentCard = {
  id: string;
  brand: CardBrand;
  last4: string;
  expMonth: number;
  expYear: number;
  isDefault: boolean;
};

type BillingPreferences = {
  autoChargeDeposits: boolean;
  authorizeNoShowFees: boolean;
  emailReceipts: boolean;
};

// Simple web haptic helper
const triggerHaptic = () => {
  if (typeof navigator !== 'undefined' && navigator.vibrate) {
    navigator.vibrate(10);
  }
};

// --- Animation Variants ---
const meshVariant = {
  animate: {
    scale: [1, 1.1, 0.9, 1],
    x: [0, 20, -20, 0],
    y: [0, -20, 20, 0],
    rotate: [0, 10, -10, 0],
    transition: {
      duration: 15,
      repeat: Infinity,
      ease: 'easeInOut' as Easing,
    },
  },
};

// --- Brand Icons ---
const BrandIcon = ({ brand, size = 32 }: { brand: CardBrand; size?: number }) => {
  const colors = {
    visa: { bg: '#1A1F71', text: '#FFFFFF' },
    mastercard: { bg: '#EB001B', text: '#FFFFFF' },
    amex: { bg: '#006FCF', text: '#FFFFFF' },
    discover: { bg: '#FF6600', text: '#FFFFFF' },
  };

  const theme = colors[brand] || colors.visa;

  return (
    <div
      className="flex items-center justify-center font-bold uppercase"
      style={{
        width: size,
        height: size * 0.65,
        backgroundColor: theme.bg,
        color: theme.text,
        borderRadius: 4,
        fontSize: size * 0.25,
        letterSpacing: '0.05em',
      }}
    >
      {brand === 'visa' && 'VISA'}
      {brand === 'mastercard' && 'MC'}
      {brand === 'amex' && 'AMEX'}
      {brand === 'discover' && 'DISC'}
    </div>
  );
};

// --- Subcomponents ---

/**
 * 1. DEFAULT CARD HERO (Parallax Credit Card)
 */
const DefaultCardHero = ({
  card,
  onAddCard,
}: {
  card: PaymentCard | null;
  onAddCard: () => void;
}) => {
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const shouldReduceMotion = useReducedMotion();

  // Gyroscope Logic for Mobile
  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }
    if (shouldReduceMotion) {
      return;
    }

    const handleOrientation = (e: DeviceOrientationEvent) => {
      const gamma = e.gamma;
      const beta = e.beta;

      if (gamma === null || beta === null) {
        return;
      }

      const clampedX = Math.min(Math.max(gamma, -20), 20);
      const clampedY = Math.min(Math.max(beta, -20), 20);
      x.set(clampedX * 2);
      y.set(clampedY * 2);
    };

    window.addEventListener('deviceorientation', handleOrientation);
    return () => window.removeEventListener('deviceorientation', handleOrientation);
  }, [x, y, shouldReduceMotion]);

  const rotateX = useTransform(y, [-100, 100], [5, -5]);
  const rotateY = useTransform(x, [-100, 100], [-5, 5]);

  const springConfig = { damping: 25, stiffness: 150 };
  const rotateXSpring = useSpring(rotateX, springConfig);
  const rotateYSpring = useSpring(rotateY, springConfig);

  function handleMouseMove(event: React.MouseEvent<HTMLDivElement, MouseEvent>) {
    if (shouldReduceMotion) {
      return;
    }
    const rect = event.currentTarget.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    x.set(event.clientX - centerX);
    y.set(event.clientY - centerY);
  }

  function handleMouseLeave() {
    x.set(0);
    y.set(0);
  }

  // Empty state
  if (!card) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2 }}
        className="relative w-full overflow-hidden bg-[var(--n5-bg-card)] text-center"
        style={{
          borderRadius: n5.radiusCard,
          boxShadow: n5.shadowSm,
          padding: n5.spaceLg,
        }}
        aria-label="No payment methods saved"
      >
        <div
          className="mx-auto mb-4 flex size-16 items-center justify-center bg-[var(--n5-bg-surface)]"
          style={{ borderRadius: n5.radiusPill }}
        >
          <CreditCard className="size-8 text-[var(--n5-ink-muted)]" strokeWidth={1.5} />
        </div>
        <h3 className="font-heading text-lg font-semibold text-[var(--n5-ink-main)]">
          No card on file yet
        </h3>
        <p className="mt-1 text-sm text-[var(--n5-ink-muted)] font-body">
          Add a card for deposits and easy checkout
        </p>
        <button
          type="button"
          onClick={() => {
            triggerHaptic();
            onAddCard();
          }}
          aria-label="Add payment method"
          className="mt-6 px-6 py-3 text-[13px] font-semibold tracking-wide text-[var(--n5-ink-inverse)] transition-all active:scale-[0.96] bg-[var(--n5-accent)] font-body"
          style={{
            borderRadius: n5.radiusMd,
            boxShadow: n5.shadowSm,
          }}
        >
          Add Payment Method
        </button>
      </motion.div>
    );
  }

  const expiry = `${card.expMonth.toString().padStart(2, '0')}/${card.expYear.toString().slice(-2)}`;

  return (
    <motion.div
      style={{
        rotateX: shouldReduceMotion ? 0 : rotateXSpring,
        rotateY: shouldReduceMotion ? 0 : rotateYSpring,
        perspective: 1000,
      }}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      className="group relative z-10 aspect-[1.58/1] w-full cursor-grab select-none active:cursor-grabbing"
      aria-label={`Default payment card ending in ${card.last4}`}
      role="region"
    >
      {/* Container with Luxury Layered Shadow */}
      <div
        className="absolute inset-0 border-[1.5px] bg-[var(--n5-bg-card)] transition-transform duration-500 hover:scale-[1.02]"
        style={{
          borderRadius: n5.radiusCard,
          boxShadow: n5.shadowLg,
          borderColor: 'var(--n5-border)',
        }}
      >
        {/* A. Animated Mesh Background */}
        <div
          className="absolute inset-0 overflow-hidden"
          style={{ borderRadius: n5.radiusCard }}
        >
          {!shouldReduceMotion && (
            <>
              <motion.div
                variants={meshVariant}
                animate="animate"
                className="absolute -top-1/2 left-[-20%] h-full w-4/5 rounded-full opacity-80 blur-[80px] bg-[var(--n5-bg-highlight)]"
              />
              <motion.div
                variants={meshVariant}
                animate="animate"
                transition={{ delay: 2, duration: 18, repeat: Infinity, ease: 'easeInOut' }}
                className="absolute bottom-[-20%] right-[-10%] h-4/5 w-3/5 rounded-full opacity-50 mix-blend-multiply blur-[60px] bg-[var(--n5-accent-soft)]"
              />
              <motion.div
                variants={meshVariant}
                animate="animate"
                transition={{ delay: 5, duration: 20, repeat: Infinity, ease: 'easeInOut' }}
                className="absolute right-[10%] top-[20%] h-3/5 w-2/5 rounded-full opacity-20 blur-[90px] bg-[var(--n5-accent)]"
              />
            </>
          )}
        </div>

        {/* B. Glass Surface */}
        <div
          className="absolute inset-0 bg-[var(--n5-bg-card)]/30 backdrop-blur-[20px]"
          style={{ borderRadius: n5.radiusCard }}
        />

        {/* C. Content Layer */}
        <div
          className="relative flex h-full flex-col justify-between text-[var(--n5-ink-main)]"
          style={{ padding: n5.spaceLg }}
        >
          {/* Top Row */}
          <div className="flex items-start justify-between">
            <div className="flex items-center space-x-2">
              <Shield className="size-4 text-[var(--n5-accent)]" />
              <span className="text-[10px] font-bold uppercase tracking-[0.2em] opacity-90 font-body">
                Default Card
              </span>
            </div>
            <BrandIcon brand={card.brand} size={40} />
          </div>

          {/* Card Number */}
          <div className="flex items-center space-x-3">
            <div className="flex space-x-2">
              {[1, 2, 3].map(i => (
                <div key={i} className="flex space-x-1">
                  {[1, 2, 3, 4].map(j => (
                    <div
                      key={j}
                      className="size-2 rounded-full bg-[var(--n5-ink-main)] opacity-40"
                    />
                  ))}
                </div>
              ))}
              <span className="font-heading text-xl font-semibold tracking-wider">
                {card.last4}
              </span>
            </div>
          </div>

          {/* Bottom Row */}
          <div className="flex items-end justify-between">
            <div>
              <span className="text-[9px] uppercase tracking-widest text-[var(--n5-ink-muted)] font-body">
                Expires
              </span>
              <p className="font-heading text-lg font-semibold leading-none">
                {expiry}
              </p>
            </div>
            <div
              className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-wide bg-[var(--n5-accent)]/10 text-[var(--n5-accent)] font-body"
              style={{ borderRadius: n5.radiusPill }}
            >
              Used for deposits
            </div>
          </div>
        </div>
      </div>
    </motion.div>
  );
};

/**
 * 2. SAVED CARDS LIST
 */
const SavedCardsList = ({
  cards,
  onSetDefault,
  onRemove,
}: {
  cards: PaymentCard[];
  onSetDefault: (id: string) => void;
  onRemove: (id: string) => void;
}) => {
  if (cards.length === 0) {
    return null;
  }

  return (
    <div className="mt-8">
      <h3
        className="mb-2 px-4 text-xs font-bold uppercase tracking-widest opacity-80 text-[var(--n5-ink-muted)] font-heading"
      >
        Saved Cards
      </h3>
      <div
        className="overflow-hidden bg-[var(--n5-bg-card)]"
        style={{
          borderRadius: n5.radiusCard,
          boxShadow: n5.shadowSm,
        }}
      >
        {cards.map((card, i) => {
          const expiry = `${card.expMonth.toString().padStart(2, '0')}/${card.expYear.toString().slice(-2)}`;

          return (
            <div
              key={card.id}
              className="group flex min-h-[72px] w-full items-center justify-between p-4 transition-colors last:border-0 hover:bg-[var(--n5-bg-surface)]"
              style={{
                borderBottomWidth: i < cards.length - 1 ? 1 : 0,
                borderColor: 'var(--n5-border-muted)',
              }}
            >
              <div className="flex items-center space-x-4">
                <BrandIcon brand={card.brand} size={36} />
                <div>
                  <div className="flex items-center space-x-2">
                    <span className="text-[15px] font-medium text-[var(--n5-ink-main)] font-body">
                      ····
                      {' '}
                      {card.last4}
                    </span>
                    {card.isDefault && (
                      <span
                        className="px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide bg-[var(--n5-accent)]/10 text-[var(--n5-accent)] font-body"
                        style={{ borderRadius: n5.radiusPill }}
                      >
                        Default
                      </span>
                    )}
                  </div>
                  <span className="text-[13px] text-[var(--n5-ink-muted)] font-body">
                    Expires
                    {' '}
                    {expiry}
                  </span>
                </div>
              </div>

              <div className="flex items-center space-x-2">
                {!card.isDefault && (
                  <button
                    type="button"
                    onClick={() => {
                      triggerHaptic();
                      onSetDefault(card.id);
                    }}
                    aria-label={`Set card ending in ${card.last4} as default`}
                    className="px-3 py-1.5 text-[11px] font-semibold transition-colors hover:bg-[var(--n5-accent)]/10 text-[var(--n5-accent)] font-body"
                    style={{ borderRadius: n5.radiusSm }}
                  >
                    Set Default
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => {
                    triggerHaptic();
                    onRemove(card.id);
                  }}
                  aria-label={`Remove card ending in ${card.last4}`}
                  className="p-2 transition-colors hover:bg-[var(--n5-error)]/10 text-[var(--n5-ink-muted)] hover:text-[var(--n5-error)]"
                  style={{ borderRadius: n5.radiusSm }}
                >
                  <Trash2 className="size-4" />
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

/**
 * 3. ADD CARD BUTTON
 */
const AddCardButton = ({ onClick }: { onClick: () => void }) => (
  <button
    type="button"
    onClick={() => {
      triggerHaptic();
      onClick();
    }}
    aria-label="Add new card"
    className="mt-4 flex w-full items-center justify-center space-x-2 py-4 text-[13px] font-semibold transition-all active:scale-[0.98] bg-[var(--n5-bg-card)] text-[var(--n5-accent)] font-body"
    style={{
      borderRadius: n5.radiusMd,
      boxShadow: n5.shadowSm,
    }}
  >
    <Plus className="size-4" />
    <span>Add New Card</span>
  </button>
);

/**
 * 4. BILLING PREFERENCES SECTION
 */
const BillingPreferencesSection = ({
  preferences,
  onToggle,
}: {
  preferences: BillingPreferences;
  onToggle: (key: keyof BillingPreferences) => void;
}) => {
  const items = [
    {
      key: 'autoChargeDeposits' as const,
      label: 'Auto-charge deposits',
      description: 'Use my saved card for deposits automatically',
      icon: CreditCard,
      enabled: preferences.autoChargeDeposits,
    },
    {
      key: 'authorizeNoShowFees' as const,
      label: 'No-show fee authorization',
      description: 'Charge this card for late cancellations',
      icon: Shield,
      enabled: preferences.authorizeNoShowFees,
    },
    {
      key: 'emailReceipts' as const,
      label: 'Email receipts',
      description: 'Send me a receipt after each payment',
      icon: Mail,
      enabled: preferences.emailReceipts,
    },
  ];

  return (
    <div className="mt-8">
      <h3
        className="mb-2 px-4 text-xs font-bold uppercase tracking-widest opacity-80 text-[var(--n5-ink-muted)] font-heading"
      >
        Billing Preferences
      </h3>
      <div
        className="overflow-hidden bg-[var(--n5-bg-card)]"
        style={{
          borderRadius: n5.radiusCard,
          boxShadow: n5.shadowSm,
        }}
      >
        {items.map((item, i) => (
          <button
            type="button"
            key={item.key}
            onClick={() => {
              triggerHaptic();
              onToggle(item.key);
            }}
            aria-label={`Toggle ${item.label}`}
            aria-pressed={item.enabled ? 'true' : 'false'}
            className="group flex min-h-[72px] w-full items-center justify-between p-4 transition-colors last:border-0 hover:bg-[var(--n5-bg-surface)] active:bg-[var(--n5-bg-selected)]"
            style={{
              borderBottomWidth: i < items.length - 1 ? 1 : 0,
              borderColor: 'var(--n5-border-muted)',
            }}
          >
            <div className="flex items-center space-x-3">
              <div
                className="p-2 transition-colors group-hover:text-[var(--n5-accent-hover)] bg-[var(--n5-bg-surface)] text-[var(--n5-accent)]"
                style={{ borderRadius: n5.radiusSm }}
              >
                <item.icon size={18} strokeWidth={2} />
              </div>
              <div className="text-left">
                <span className="text-[15px] font-medium text-[var(--n5-ink-main)] font-body">
                  {item.label}
                </span>
                <p className="text-[12px] text-[var(--n5-ink-muted)] font-body">
                  {item.description}
                </p>
              </div>
            </div>

            {/* Toggle Switch */}
            <div
              className={cn(
                'relative h-7 w-12 rounded-full transition-colors duration-200',
                item.enabled ? 'bg-[var(--n5-accent)]' : 'bg-[var(--n5-border)]',
              )}
            >
              <motion.div
                animate={{ x: item.enabled ? 20 : 0 }}
                transition={{ type: 'spring', stiffness: 500, damping: 30 }}
                className="absolute left-1 top-1 size-5 rounded-full bg-white shadow-sm"
              />
            </div>
          </button>
        ))}
      </div>
    </div>
  );
};

/**
 * 5. ADD CARD SHEET (Bottom Sheet Modal)
 */
const AddCardSheet = ({
  isOpen,
  onClose,
}: {
  isOpen: boolean;
  onClose: () => void;
}) => {
  const sheetRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isOpen) {
      setTimeout(() => sheetRef.current?.focus(), 50);
    }
  }, [isOpen]);

  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    if (isOpen) {
      window.addEventListener('keydown', handleEsc);
    }
    return () => window.removeEventListener('keydown', handleEsc);
  }, [isOpen, onClose]);

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 z-[60] backdrop-blur-sm"
            style={{ backgroundColor: 'color-mix(in srgb, var(--n5-ink-main) 40%, transparent)' }}
            aria-hidden="true"
          />
          <motion.div
            ref={sheetRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="add-card-title"
            tabIndex={-1}
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', damping: 25, stiffness: 200 }}
            className="fixed inset-x-0 bottom-0 z-[70] overflow-hidden bg-[var(--n5-bg-card)] p-6 pb-12 outline-none"
            style={{
              borderRadius: `${n5.radiusSheet} ${n5.radiusSheet} 0 0`,
              boxShadow: n5.shadowModal,
            }}
          >
            {/* Drag Handle */}
            <div className="mx-auto mb-8 h-1.5 w-12 rounded-full bg-[var(--n5-border-muted)]" />

            <div className="flex flex-col items-center text-center">
              {/* Icon */}
              <div
                className="mb-6 flex size-20 items-center justify-center rounded-full border border-[var(--n5-border)] shadow-[var(--n5-shadow-lg)]"
                style={{
                  background: 'linear-gradient(to top right, var(--n5-bg-page), white)',
                }}
              >
                <CreditCard size={32} strokeWidth={1.5} className="text-[var(--n5-accent)]" />
              </div>

              <p className="font-body mb-2 text-[11px] font-bold uppercase tracking-[0.2em] text-[var(--n5-ink-muted)]">
                Secure Payment
              </p>
              <h2
                id="add-card-title"
                className="font-heading mb-2 text-2xl tracking-tight text-[var(--n5-ink-main)]"
              >
                Add New Card
              </h2>

              {/* Security Notice */}
              <div
                className="mb-6 flex items-center space-x-2 px-4 py-3 bg-[var(--n5-bg-surface)]"
                style={{ borderRadius: n5.radiusMd }}
              >
                <Lock className="size-4 text-[var(--n5-success)]" />
                <p className="text-left text-[12px] text-[var(--n5-ink-muted)] font-body">
                  Your payment info is securely stored by our payment provider. We never see or store your full card number.
                </p>
              </div>

              {/* Stripe Elements Placeholder */}
              <div
                className="w-full space-y-4 p-4 border border-dashed border-[var(--n5-border)]"
                style={{ borderRadius: n5.radiusMd }}
              >
                <div className="h-12 w-full animate-pulse rounded-lg bg-[var(--n5-bg-surface)]" />
                <div className="flex space-x-4">
                  <div className="h-12 flex-1 animate-pulse rounded-lg bg-[var(--n5-bg-surface)]" />
                  <div className="h-12 flex-1 animate-pulse rounded-lg bg-[var(--n5-bg-surface)]" />
                </div>
                <p className="text-center text-[11px] text-[var(--n5-ink-muted)] font-body italic">
                  Stripe Elements will be integrated here
                </p>
              </div>

              {/* Actions */}
              <button
                type="button"
                onClick={() => {
                  triggerHaptic();
                  onClose();
                }}
                className="mt-6 w-full py-4 text-[13px] font-bold tracking-wide text-[var(--n5-ink-inverse)] transition-all active:scale-[0.98] bg-[var(--n5-accent)] font-body"
                style={{
                  borderRadius: n5.radiusMd,
                  boxShadow: n5.shadowSm,
                }}
              >
                Add Card
              </button>

              <button
                type="button"
                onClick={onClose}
                className="font-body mt-4 text-xs font-bold uppercase tracking-widest text-[var(--n5-ink-muted)] transition-colors"
              >
                Cancel
              </button>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
};

/**
 * 6. FLOATING DOCK
 */
const FloatingDock = ({ onHome, onProfile }: { onHome: () => void; onProfile: () => void }) => (
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
        onHome();
      }}
      className="p-2 transition-colors hover:text-[var(--n5-ink-main)] text-[var(--n5-ink-muted)]"
      aria-label="Go to Home"
    >
      <Home strokeWidth={2} className="size-6" />
    </button>
    <div className="relative p-2">
      <button
        type="button"
        onClick={triggerHaptic}
        aria-label="Current Page: Payment Methods"
        className="text-[var(--n5-accent)]"
      >
        <CreditCard strokeWidth={2} className="size-6" />
      </button>
      <div
        className="absolute bottom-1 left-1/2 size-1 -translate-x-1/2 rounded-full bg-[var(--n5-accent)]"
      />
    </div>
    <button
      type="button"
      onClick={() => {
        triggerHaptic();
        onProfile();
      }}
      className="p-2 transition-colors hover:text-[var(--n5-ink-main)] text-[var(--n5-ink-muted)]"
      aria-label="Go to Profile"
    >
      <User strokeWidth={2} className="size-6" />
    </button>
  </div>
);

// --- MAIN PAGE ---

export default function PaymentMethodsContent() {
  const router = useRouter();
  const [isAddCardSheetOpen, setIsAddCardSheetOpen] = useState(false);

  // Mock data - in production, this would come from API
  const [cards, setCards] = useState<PaymentCard[]>([
    {
      id: '1',
      brand: 'visa',
      last4: '4242',
      expMonth: 8,
      expYear: 2027,
      isDefault: true,
    },
    {
      id: '2',
      brand: 'mastercard',
      last4: '5555',
      expMonth: 12,
      expYear: 2026,
      isDefault: false,
    },
  ]);

  const [preferences, setPreferences] = useState<BillingPreferences>({
    autoChargeDeposits: true,
    authorizeNoShowFees: true,
    emailReceipts: true,
  });

  const defaultCard = cards.find(c => c.isDefault) || null;

  const handleBack = useCallback(() => {
    triggerHaptic();
    router.back();
  }, [router]);

  const handleSetDefault = useCallback((cardId: string) => {
    setCards(prev =>
      prev.map(card => ({
        ...card,
        isDefault: card.id === cardId,
      })),
    );
  }, []);

  const handleRemoveCard = useCallback((cardId: string) => {
    setCards(prev => {
      const filtered = prev.filter(card => card.id !== cardId);
      // If we removed the default card, make the first remaining card default
      if (filtered.length > 0 && !filtered.some(c => c.isDefault)) {
        filtered[0]!.isDefault = true;
      }
      return filtered;
    });
  }, []);

  const handleTogglePreference = useCallback((key: keyof BillingPreferences) => {
    setPreferences(prev => ({
      ...prev,
      [key]: !prev[key],
    }));
  }, []);

  const handleNavigate = useCallback((path: string) => {
    router.push(path);
  }, [router]);

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
          className="flex size-10 items-center justify-center bg-[var(--n5-bg-card)] shadow-sm transition-transform active:scale-90 text-[var(--n5-ink-main)]"
          style={{ borderRadius: n5.radiusPill }}
        >
          <ChevronRight className="size-5 rotate-180" />
        </button>
        <span
          className="font-heading text-lg font-semibold tracking-tight text-[var(--n5-ink-main)]"
        >
          Payment Methods
        </span>
        <div className="size-10" /> {/* Spacer for centering */}
      </nav>

      {/* Main Content */}
      <main className="mx-auto max-w-lg space-y-2 px-5 pb-28 pt-28">
        {/* Subtitle */}
        <p className="mb-6 text-center text-sm text-[var(--n5-ink-muted)] font-body">
          Manage the cards you use for bookings.
        </p>

        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
        >
          {/* Default Card Hero */}
          <DefaultCardHero
            card={defaultCard}
            onAddCard={() => setIsAddCardSheetOpen(true)}
          />

          {/* Saved Cards List */}
          <SavedCardsList
            cards={cards}
            onSetDefault={handleSetDefault}
            onRemove={handleRemoveCard}
          />

          {/* Add Card Button (only show if we have cards) */}
          {cards.length > 0 && (
            <AddCardButton onClick={() => setIsAddCardSheetOpen(true)} />
          )}

          {/* Billing Preferences */}
          <BillingPreferencesSection
            preferences={preferences}
            onToggle={handleTogglePreference}
          />

          {/* Footer */}
          <div className="pt-10 text-center opacity-40">
            <p className="font-heading text-[10px] italic text-[var(--n5-ink-main)]">
              Powered by Stripe
            </p>
            <p className="mt-1 text-[9px] text-[var(--n5-ink-muted)] font-body">
              PCI-DSS Compliant
            </p>
          </div>
        </motion.div>
      </main>

      <FloatingDock
        onHome={() => handleNavigate('/book')}
        onProfile={() => handleNavigate('/profile')}
      />

      {/* Add Card Sheet */}
      <AddCardSheet
        isOpen={isAddCardSheetOpen}
        onClose={() => setIsAddCardSheetOpen(false)}
      />
    </div>
  );
}
