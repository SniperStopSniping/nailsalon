'use client';

import { useEffect, useState } from 'react';

import { themeVars } from '@/theme';

// Confetti colors using theme
const confettiColors = [
  themeVars.primary,
  themeVars.accent,
  '#FFD700', // Gold
  '#FF69B4', // Hot pink
  '#87CEEB', // Sky blue
];

// Confetti particle component
function Confetti({ delay, color, left }: { delay: number; color: string; left: number }) {
  return (
    <div
      className="absolute size-3 rounded-sm"
      style={{
        left: `${left}%`,
        top: '-10px',
        backgroundColor: color,
        animation: `confetti-fall 2.5s ease-out ${delay}s forwards`,
        transform: `rotate(${Math.random() * 360}deg)`,
      }}
    />
  );
}

interface ConfettiPopupProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  message: string;
  emoji?: string;
  autoDismissMs?: number;
}

export function ConfettiPopup({
  isOpen,
  onClose,
  title,
  message,
  emoji = '🎊',
  autoDismissMs = 3000,
}: ConfettiPopupProps) {
  const [showConfetti, setShowConfetti] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    if (isOpen) {
      // Start animations
      setMounted(true);
      const confettiTimer = setTimeout(() => setShowConfetti(true), 100);

      // Auto-dismiss after specified time
      const dismissTimer = setTimeout(() => {
        onClose();
      }, autoDismissMs);

      return () => {
        clearTimeout(confettiTimer);
        clearTimeout(dismissTimer);
      };
    }
    setMounted(false);
    setShowConfetti(false);
    return undefined;
  }, [isOpen, autoDismissMs, onClose]);

  if (!isOpen) return null;

  return (
    <>
      <style jsx>{`
        @keyframes confetti-fall {
          0% {
            transform: translateY(0) rotate(0deg) scale(1);
            opacity: 1;
          }
          100% {
            transform: translateY(100vh) rotate(720deg) scale(0.5);
            opacity: 0;
          }
        }
        @keyframes modal-fade-in {
          from {
            opacity: 0;
            transform: scale(0.9) translateY(20px);
          }
          to {
            opacity: 1;
            transform: scale(1) translateY(0);
          }
        }
        @keyframes modal-backdrop-fade {
          from {
            opacity: 0;
          }
          to {
            opacity: 1;
          }
        }
        @keyframes emoji-bounce {
          0%, 100% {
            transform: scale(1);
          }
          25% {
            transform: scale(1.3) rotate(-10deg);
          }
          50% {
            transform: scale(1.1) rotate(10deg);
          }
          75% {
            transform: scale(1.2) rotate(-5deg);
          }
        }
      `}</style>

      {/* Confetti Layer */}
      {showConfetti && (
        <div className="pointer-events-none fixed inset-0 z-[60]">
          {Array.from({ length: 50 }).map((_, i) => (
            <Confetti
              key={`confetti-${i}`}
              delay={Math.random() * 0.5}
              color={confettiColors[i % confettiColors.length] || themeVars.primary}
              left={Math.random() * 100}
            />
          ))}
        </div>
      )}

      {/* Backdrop */}
      <div
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4"
        style={{
          animation: 'modal-backdrop-fade 200ms ease-out forwards',
        }}
        onClick={onClose}
      >
        {/* Modal */}
        <div
          className="relative w-full max-w-sm overflow-hidden rounded-2xl bg-white p-8 text-center shadow-2xl"
          style={{
            animation: mounted ? 'modal-fade-in 300ms ease-out forwards' : undefined,
          }}
          onClick={e => e.stopPropagation()}
        >
          {/* Emoji with animation */}
          <div
            className="mb-4 text-6xl"
            style={{
              animation: 'emoji-bounce 0.8s ease-out forwards',
            }}
          >
            {emoji}
          </div>

          {/* Title */}
          <h2
            className="mb-2 text-xl font-bold text-neutral-900"
            style={{
              opacity: mounted ? 1 : 0,
              transform: mounted ? 'translateY(0)' : 'translateY(10px)',
              transition: 'opacity 300ms ease-out 100ms, transform 300ms ease-out 100ms',
            }}
          >
            {title}
          </h2>

          {/* Message */}
          <p
            className="text-sm text-neutral-600"
            style={{
              opacity: mounted ? 1 : 0,
              transform: mounted ? 'translateY(0)' : 'translateY(10px)',
              transition: 'opacity 300ms ease-out 200ms, transform 300ms ease-out 200ms',
            }}
          >
            {message}
          </p>

          {/* Optional close button */}
          <button
            type="button"
            onClick={onClose}
            className="mt-6 w-full rounded-full py-3 text-sm font-semibold text-neutral-900 transition-all duration-200 hover:opacity-90 active:scale-[0.98]"
            style={{
              backgroundColor: themeVars.primary,
              opacity: mounted ? 1 : 0,
              transform: mounted ? 'translateY(0)' : 'translateY(10px)',
              transition: 'opacity 300ms ease-out 300ms, transform 300ms ease-out 300ms, background-color 200ms',
            }}
          >
            Yay! 🎉
          </button>
        </div>
      </div>
    </>
  );
}

