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
 *
 * The panel is portalled into document.body, outside the workspace shell, so
 * it carries `owner-theme-scope` to resolve the --owner-* token layer. Every
 * ?app= modal in the workspace is wrapped by this component, so its chrome is
 * the single place the owner palette is applied to modal headers and back
 * controls (no iOS system colours).
 */

import type { PanInfo } from 'framer-motion';
import { AnimatePresence, motion, useAnimation, useDragControls } from 'framer-motion';
import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { useBodyScrollLock } from '@/hooks/useBodyScrollLock';
import { useModalFocusLifecycle } from '@/hooks/useModalFocusLifecycle';

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
  /** Whether the modal itself can be dragged down to dismiss */
  allowDragToDismiss?: boolean;
};

export function AppModal({
  isOpen,
  onClose,
  children,
  title,
  allowDragToDismiss = true,
}: AppModalProps) {
  const controls = useAnimation();
  const dragControls = useDragControls();
  const [portalReady, setPortalReady] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setPortalReady(true);
  }, []);

  // Lock body scroll when modal is open
  useBodyScrollLock(isOpen);
  useModalFocusLifecycle({
    isOpen: isOpen && portalReady,
    onClose,
    rootRef: panelRef,
    contentRef,
    initialFocusRef: contentRef,
  });

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

  if (!portalReady) {
    return null;
  }

  return createPortal(
    <AnimatePresence>
      {isOpen && (
        <>
          {/*
            Backdrop. It covers the viewport and any tap outside the sheet
            dismisses; the sheet's own top inset below keeps a reachable strip
            of it on a phone. Keyboard users dismiss with Escape (handled by
            useModalFocusLifecycle), so this stays out of the a11y tree.
          */}
          <motion.div
            aria-hidden="true"
            data-testid="app-modal-backdrop"
            className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.3 }}
            onClick={onClose}
          />

          {/* Modal */}
          <motion.div
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-label={title}
            data-modal-focus-root="true"
            data-testid="app-modal-panel"
            className="owner-theme-scope fixed inset-x-0 bottom-0 z-50 flex min-h-0 flex-col overflow-hidden rounded-t-owner-sheet bg-[var(--owner-surface)] text-[var(--owner-ink)] shadow-2xl"
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{
              type: 'spring',
              damping: 30,
              stiffness: 300,
            }}
            drag={allowDragToDismiss ? 'y' : false}
            // Drag starts only from the grab handle (dragListener disabled),
            // so the content area keeps native touch scrolling instead of
            // fighting the dismiss gesture.
            dragControls={dragControls}
            dragListener={false}
            dragConstraints={
              allowDragToDismiss ? { top: 0, bottom: 0 } : undefined
            }
            dragElastic={
              allowDragToDismiss ? { top: 0, bottom: 0.5 } : undefined
            }
            onDragEnd={allowDragToDismiss ? handleDragEnd : undefined}
            style={{
              // A 12 px strip is not a dismissal target on a phone. Inset the
              // sheet far enough to leave a thumb-sized (>= 44 px) band of
              // backdrop, which is what the tap-outside affordance promises.
              top: 'max(calc(env(safe-area-inset-top, 0px) + 12px), 44px)',
              paddingBottom: 'env(safe-area-inset-bottom, 0px)',
            }}
          >
            {/* Drag Handle — the only surface that starts the dismiss gesture */}
            <div
              className={`flex justify-center pb-2 pt-3 ${allowDragToDismiss ? 'cursor-grab touch-none active:cursor-grabbing' : ''}`}
              onPointerDown={allowDragToDismiss ? event => dragControls.start(event) : undefined}
            >
              <div className="h-1 w-9 rounded-full bg-[var(--owner-line-strong)]" />
            </div>

            {/* Optional Header */}
            {title && (
              <div className="border-b border-[var(--owner-line)] px-4 pb-3">
                <h2 className="owner-title text-center text-[19px] font-semibold text-[var(--owner-ink)]">
                  {title}
                </h2>
              </div>
            )}

            {/* Content */}
            <div
              ref={contentRef}
              tabIndex={-1}
              data-dialog-initial-focus="true"
              data-modal-focus-content="true"
              data-testid="app-modal-scroll-region"
              className="min-h-0 flex-1 touch-pan-y overflow-y-auto overscroll-contain"
            >
              {children}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>,
    document.body,
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
        ${transparent ? 'bg-transparent' : 'border-b border-[var(--owner-line)] bg-[var(--owner-surface)] backdrop-blur-xl'}
      `}
    >
      <div className="flex h-[52px] items-center justify-between px-4">
        <div className="flex w-20 justify-start">{leftAction}</div>
        <div className="flex flex-1 flex-col items-center">
          <span className="owner-title text-[19px] font-semibold leading-none text-[var(--owner-ink)]">
            {title}
          </span>
          {subtitle && (
            <span className="mt-0.5 text-[11px] font-medium text-[var(--owner-muted)]">
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
      className="-mx-1 flex min-h-11 items-center rounded-full px-1 text-[17px] font-medium text-[var(--owner-accent)] transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--owner-focus)] active:opacity-50"
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
