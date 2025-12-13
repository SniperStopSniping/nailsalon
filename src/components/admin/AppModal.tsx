'use client';

/**
 * AppModal Component
 *
 * Fullscreen modal wrapper with iOS-style animations.
 * Features:
 * - Push-up entrance animation
 * - Swipe-down to dismiss gesture
 * - Backdrop blur
 * - Drag handle indicator
 */

import type { PanInfo } from 'framer-motion';
import { AnimatePresence, motion, useAnimation } from 'framer-motion';
import { type ReactNode, useCallback, useEffect } from 'react';

// Dismiss threshold in pixels
const DISMISS_THRESHOLD = 100;
const VELOCITY_THRESHOLD = 500;

type AppModalProps = {
  /** Whether modal is open */
  isOpen: boolean;
  /** Callback when modal should close */
  onClose: () => void;
  /** Modal content */
  children: ReactNode;
  /** Modal title (optional, shown in header) */
  title?: string;
};

export function AppModal({ isOpen, onClose, children, title }: AppModalProps) {
  const controls = useAnimation();

  // Close on escape key
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };

    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [isOpen, onClose]);

  // Lock body scroll when modal is open
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [isOpen]);

  const handleDragEnd = useCallback(
    (_: MouseEvent | TouchEvent | PointerEvent, info: PanInfo) => {
      const { offset, velocity } = info;

      // Dismiss if dragged down past threshold or with high velocity
      if (offset.y > DISMISS_THRESHOLD || velocity.y > VELOCITY_THRESHOLD) {
        onClose();
      } else {
        // Snap back to original position
        controls.start({ y: 0 });
      }
    },
    [onClose, controls],
  );

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.3 }}
            onClick={onClose}
          />

          {/* Modal */}
          <motion.div
            className="fixed inset-x-0 bottom-0 top-12 z-50 flex flex-col overflow-hidden rounded-t-[20px] bg-white shadow-2xl"
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{
              type: 'spring',
              damping: 30,
              stiffness: 300,
            }}
            drag="y"
            dragConstraints={{ top: 0, bottom: 0 }}
            dragElastic={{ top: 0, bottom: 0.5 }}
            onDragEnd={handleDragEnd}
            style={{ touchAction: 'pan-x' }}
          >
            {/* Drag Handle */}
            <div className="flex cursor-grab justify-center pb-2 pt-3 active:cursor-grabbing">
              <div className="h-1 w-9 rounded-full bg-gray-300" />
            </div>

            {/* Optional Header */}
            {title && (
              <div className="border-b border-gray-100 px-4 pb-3">
                <h2 className="text-center text-[17px] font-semibold text-[#1C1C1E]">
                  {title}
                </h2>
              </div>
            )}

            {/* Content */}
            <div className="flex-1 overflow-y-auto overscroll-contain">
              {children}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

/**
 * Modal Header Component
 * For use inside modal content when you need a sticky header
 */
type ModalHeaderProps = {
  title: string;
  subtitle?: string;
  leftAction?: ReactNode;
  rightAction?: ReactNode;
  transparent?: boolean;
};

export function ModalHeader({
  title,
  subtitle,
  leftAction,
  rightAction,
  transparent = false,
}: ModalHeaderProps) {
  return (
    <div
      className={`
        sticky top-0 z-10
        ${transparent ? 'bg-transparent' : 'border-b border-gray-200 bg-white/85 backdrop-blur-xl'}
      `}
    >
      <div className="flex h-[52px] items-center justify-between px-4">
        <div className="flex w-20 justify-start">{leftAction}</div>
        <div className="flex flex-1 flex-col items-center">
          <span className="text-[17px] font-semibold leading-none text-[#1C1C1E]">
            {title}
          </span>
          {subtitle && (
            <span className="mt-0.5 text-[11px] font-medium text-gray-500">
              {subtitle}
            </span>
          )}
        </div>
        <div className="flex w-20 justify-end">{rightAction}</div>
      </div>
    </div>
  );
}

/**
 * Back Button for Modal Headers
 */
type BackButtonProps = {
  onClick: () => void;
  label?: string;
};

export function BackButton({ onClick, label = 'Back' }: BackButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center text-[17px] text-[#007AFF] transition-opacity active:opacity-50"
    >
      <svg
        className="-ml-1 size-6"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M15 19l-7-7 7-7"
        />
      </svg>
      {label}
    </button>
  );
}
