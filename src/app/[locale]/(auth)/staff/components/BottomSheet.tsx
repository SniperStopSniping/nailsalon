'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { useModalFocusLifecycle } from '@/hooks/useModalFocusLifecycle';

// =============================================================================
// Cappuccino Design Tokens
// =============================================================================

const cappuccino = {
  cardBg: '#FAF8F5',
  cardBorder: '#E6DED6',
};

// =============================================================================
// Types
// =============================================================================

type SnapPoint = 'peek' | 'half' | 'full' | 'closed';
type OpenSnapPoint = Exclude<SnapPoint, 'closed'>;

type BottomSheetProps = {
  isOpen: boolean;
  onClose: () => void;
  children: React.ReactNode;
  /** Accessible name for the sheet and its resize control. */
  ariaLabel: string;
  /** Initial snap point when opening */
  initialSnap?: OpenSnapPoint;
};

// Snap point heights as percentage of viewport
const SNAP_HEIGHTS: Record<SnapPoint, number> = {
  peek: 30,
  half: 60,
  full: 92,
  closed: 0,
};
const RESIZABLE_SNAPS: SnapPoint[] = ['peek', 'half', 'full'];
const SNAP_LABELS: Record<Exclude<SnapPoint, 'closed'>, string> = {
  peek: 'Peek height',
  half: 'Half height',
  full: 'Full height',
};

// =============================================================================
// Bottom Sheet Component
// =============================================================================

export function BottomSheet({
  isOpen,
  onClose,
  children,
  ariaLabel,
  initialSnap = 'half',
}: BottomSheetProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const sheetRef = useRef<HTMLDivElement>(null);
  const resizeHandleRef = useRef<HTMLDivElement>(null);
  const [currentSnap, setCurrentSnap] = useState<SnapPoint>('closed');
  const [isDragging, setIsDragging] = useState(false);
  const [dragOffset, setDragOffset] = useState(0);
  const isDraggingRef = useRef(false);
  const activePointerIdRef = useRef<number | null>(null);
  const startYRef = useRef(0);
  const currentYRef = useRef(0);
  const previousOverflowRef = useRef<string>('');
  const renderedSnap: OpenSnapPoint = currentSnap === 'closed' ? initialSnap : currentSnap;
  const renderedSnapRef = useRef<OpenSnapPoint>(renderedSnap);
  renderedSnapRef.current = renderedSnap;

  const releasePointerCapture = useCallback(() => {
    const pointerId = activePointerIdRef.current;
    const handle = resizeHandleRef.current;
    activePointerIdRef.current = null;
    if (pointerId === null || !handle?.hasPointerCapture?.(pointerId)) {
      return;
    }
    handle.releasePointerCapture(pointerId);
  }, []);

  const cancelDrag = useCallback(() => {
    releasePointerCapture();
    isDraggingRef.current = false;
    setIsDragging(false);
    setDragOffset(0);
  }, [releasePointerCapture]);

  const closeSheet = useCallback(() => {
    cancelDrag();
    setCurrentSnap('closed');
    onClose();
  }, [cancelDrag, onClose]);

  useModalFocusLifecycle({
    isOpen,
    onClose: closeSheet,
    rootRef,
    contentRef: sheetRef,
    initialFocusRef: resizeHandleRef,
  });

  // =============================================================================
  // Scroll Lock
  // =============================================================================

  useEffect(() => {
    if (isOpen) {
      previousOverflowRef.current = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
      setCurrentSnap(initialSnap);
    } else {
      cancelDrag();
      document.body.style.overflow = previousOverflowRef.current;
      setCurrentSnap('closed');
    }

    return () => {
      document.body.style.overflow = previousOverflowRef.current;
    };
  }, [cancelDrag, isOpen, initialSnap]);

  // =============================================================================
  // Drag Handlers
  // =============================================================================

  const commitSnap = useCallback((nextSnap: SnapPoint) => {
    setDragOffset(0);
    if (nextSnap === 'closed') {
      closeSheet();
      return;
    }
    setCurrentSnap(nextSnap);
  }, [closeSheet]);

  const handlePointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || isDraggingRef.current) {
      return;
    }

    activePointerIdRef.current = event.pointerId;
    startYRef.current = event.clientY;
    currentYRef.current = event.clientY;
    isDraggingRef.current = true;
    setIsDragging(true);
    event.currentTarget.setPointerCapture?.(event.pointerId);
  }, []);

  const handlePointerMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (!isDraggingRef.current || activePointerIdRef.current !== event.pointerId) {
      return;
    }

    const currentY = event.clientY;
    const deltaY = currentY - startYRef.current;
    currentYRef.current = currentY;
    setDragOffset(deltaY);
  }, []);

  const commitPointerDrag = useCallback(() => {
    if (!isDraggingRef.current) {
      return;
    }
    isDraggingRef.current = false;
    setIsDragging(false);

    const settledDragOffset = currentYRef.current - startYRef.current;
    const viewportHeight = window.innerHeight;
    const activeSnap = renderedSnapRef.current;
    const currentHeight = SNAP_HEIGHTS[activeSnap];
    const currentPixelHeight = (currentHeight / 100) * viewportHeight;
    const newPixelHeight = currentPixelHeight - settledDragOffset;
    const newPercentHeight = (newPixelHeight / viewportHeight) * 100;

    // Determine which snap point to go to based on velocity and position
    const velocity = settledDragOffset / 100; // Simple velocity approximation

    let newSnap: SnapPoint = activeSnap;

    if (settledDragOffset > 100 || velocity > 1.5) {
      // Dragged down significantly - go to lower snap or close
      if (activeSnap === 'full') {
        newSnap = 'half';
      } else if (activeSnap === 'half') {
        newSnap = 'peek';
      } else {
        newSnap = 'closed';
      }
    } else if (settledDragOffset < -100 || velocity < -1.5) {
      // Dragged up significantly - go to higher snap
      if (activeSnap === 'peek') {
        newSnap = 'half';
      } else if (activeSnap === 'half') {
        newSnap = 'full';
      } else {
        newSnap = 'full';
      }
    } else {
      // Snap to nearest
      const snapPoints: SnapPoint[] = ['peek', 'half', 'full'];
      newSnap = snapPoints.reduce((closest, snap) => {
        const snapHeight = SNAP_HEIGHTS[snap];
        const closestHeight = SNAP_HEIGHTS[closest];
        if (closestHeight === undefined) {
          return snap;
        }
        if (snapHeight === undefined) {
          return closest;
        }
        return Math.abs(newPercentHeight - snapHeight) < Math.abs(newPercentHeight - closestHeight)
          ? snap
          : closest;
      }, activeSnap);
    }

    commitSnap(newSnap);
  }, [commitSnap]);

  const handlePointerUp = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (activePointerIdRef.current !== event.pointerId) {
      return;
    }
    releasePointerCapture();
    commitPointerDrag();
  }, [commitPointerDrag, releasePointerCapture]);

  const handlePointerCancel = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (activePointerIdRef.current === event.pointerId) {
      cancelDrag();
    }
  }, [cancelDrag]);

  const handleResizeKeyDown = useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
    const currentIndex = RESIZABLE_SNAPS.indexOf(renderedSnap);
    let nextSnap: SnapPoint | null = null;

    if (event.key === 'ArrowUp' || event.key === 'ArrowRight') {
      nextSnap = RESIZABLE_SNAPS[Math.min(currentIndex + 1, RESIZABLE_SNAPS.length - 1)]!;
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowLeft') {
      nextSnap = RESIZABLE_SNAPS[Math.max(currentIndex - 1, 0)]!;
    } else if (event.key === 'Home') {
      nextSnap = 'peek';
    } else if (event.key === 'End') {
      nextSnap = 'full';
    }

    if (nextSnap) {
      event.preventDefault();
      commitSnap(nextSnap);
    }
  }, [commitSnap, renderedSnap]);

  // =============================================================================
  // Backdrop Click
  // =============================================================================

  const handleBackdropClick = useCallback(() => {
    closeSheet();
  }, [closeSheet]);

  // =============================================================================
  // Render
  // =============================================================================

  if (!isOpen) {
    return null;
  }

  const targetHeight = SNAP_HEIGHTS[renderedSnap];
  const translateY = isDragging
    ? `calc(${100 - targetHeight}vh + ${dragOffset}px)`
    : `${100 - targetHeight}vh`;

  return (
    <div
      ref={rootRef}
      role="presentation"
      data-modal-focus-root="true"
      data-testid="staff-bottom-sheet-root"
      className="fixed inset-0 z-50"
    >
      {/* Backdrop */}
      <div
        aria-hidden="true"
        className="absolute inset-0 bg-black transition-opacity duration-300"
        style={{
          opacity: isOpen ? 0.5 : 0,
          pointerEvents: isOpen ? 'auto' : 'none',
        }}
        onClick={handleBackdropClick}
      />

      {/* Sheet */}
      <div
        ref={sheetRef}
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabel}
        tabIndex={-1}
        data-modal-focus-content="true"
        data-snap-point={renderedSnap}
        data-testid="staff-bottom-sheet"
        className="absolute inset-x-0 bottom-0 rounded-t-3xl shadow-2xl motion-reduce:!transition-none"
        style={{
          backgroundColor: cappuccino.cardBg,
          height: '100vh',
          transform: `translateY(${translateY})`,
          transition: isDragging ? 'none' : 'transform 0.35s cubic-bezier(0.32, 0.72, 0, 1)',
          willChange: 'transform',
        }}
      >
        {/* Drag Handle */}
        <div
          ref={resizeHandleRef}
          role="slider"
          tabIndex={0}
          aria-label={`Resize ${ariaLabel}`}
          aria-valuemin={SNAP_HEIGHTS.peek}
          aria-valuemax={SNAP_HEIGHTS.full}
          aria-valuenow={SNAP_HEIGHTS[renderedSnap]}
          aria-valuetext={`${SNAP_LABELS[renderedSnap]}, ${SNAP_HEIGHTS[renderedSnap]}% of viewport`}
          className="flex h-11 min-h-11 cursor-grab touch-none items-center justify-center rounded-t-3xl outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#4B2E1E] active:cursor-grabbing"
          onKeyDown={handleResizeKeyDown}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerCancel}
          onLostPointerCapture={handlePointerCancel}
        >
          <div
            className="h-1 w-10 rounded-full"
            style={{ backgroundColor: cappuccino.cardBorder }}
          />
        </div>

        {/* Content */}
        <div
          className="h-full overflow-y-auto overscroll-contain px-4 pb-8"
          style={{
            maxHeight: 'calc(100vh - 44px)',
            paddingBottom: 'max(2rem, env(safe-area-inset-bottom, 0px))',
          }}
        >
          {children}
        </div>
      </div>
    </div>
  );
}

export default BottomSheet;
