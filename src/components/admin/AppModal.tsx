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

import { motion, useAnimation, PanInfo, AnimatePresence } from 'framer-motion';
import { useEffect, useCallback, type ReactNode } from 'react';

// Dismiss threshold in pixels
const DISMISS_THRESHOLD = 100;
const VELOCITY_THRESHOLD = 500;

interface AppModalProps {
  /** Whether modal is open */
  isOpen: boolean;
  /** Callback when modal should close */
  onClose: () => void;
  /** Modal content */
  children: ReactNode;
  /** Modal title (optional, shown in header) */
  title?: string;
}

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
    [onClose, controls]
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
            className="fixed inset-x-0 bottom-0 top-12 z-50 bg-white rounded-t-[20px] shadow-2xl overflow-hidden flex flex-col"
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
            <div className="flex justify-center pt-3 pb-2 cursor-grab active:cursor-grabbing">
              <div className="w-9 h-1 bg-gray-300 rounded-full" />
            </div>

            {/* Optional Header */}
            {title && (
              <div className="px-4 pb-3 border-b border-gray-100">
                <h2 className="text-[17px] font-semibold text-center text-[#1C1C1E]">
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
interface ModalHeaderProps {
  title: string;
  subtitle?: string;
  leftAction?: ReactNode;
  rightAction?: ReactNode;
  transparent?: boolean;
}

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
        ${transparent ? 'bg-transparent' : 'bg-white/85 backdrop-blur-xl border-b border-gray-200'}
      `}
    >
      <div className="flex items-center justify-between px-4 h-[52px]">
        <div className="w-20 flex justify-start">{leftAction}</div>
        <div className="flex flex-col items-center flex-1">
          <span className="text-[17px] font-semibold leading-none text-[#1C1C1E]">
            {title}
          </span>
          {subtitle && (
            <span className="text-[11px] text-gray-500 font-medium mt-0.5">
              {subtitle}
            </span>
          )}
        </div>
        <div className="w-20 flex justify-end">{rightAction}</div>
      </div>
    </div>
  );
}

/**
 * Back Button for Modal Headers
 */
interface BackButtonProps {
  onClick: () => void;
  label?: string;
}

export function BackButton({ onClick, label = 'Back' }: BackButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center text-[#007AFF] text-[17px] active:opacity-50 transition-opacity"
    >
      <svg
        className="w-6 h-6 -ml-1"
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

