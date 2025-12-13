'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

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

type BottomSheetProps = {
  isOpen: boolean;
  onClose: () => void;
  children: React.ReactNode;
  /** Initial snap point when opening */
  initialSnap?: SnapPoint;
};

// Snap point heights as percentage of viewport
const SNAP_HEIGHTS: Record<SnapPoint, number> = {
  peek: 30,
  half: 60,
  full: 92,
  closed: 0,
};

// =============================================================================
// Bottom Sheet Component
// =============================================================================

export function BottomSheet({
  isOpen,
  onClose,
  children,
  initialSnap = 'half',
}: BottomSheetProps) {
  const sheetRef = useRef<HTMLDivElement>(null);
  const [currentSnap, setCurrentSnap] = useState<SnapPoint>('closed');
  const [isDragging, setIsDragging] = useState(false);
  const [dragOffset, setDragOffset] = useState(0);
  const startYRef = useRef(0);
  const currentYRef = useRef(0);
  const previousOverflowRef = useRef<string>('');

  // =============================================================================
  // Scroll Lock
  // =============================================================================

  useEffect(() => {
    if (isOpen) {
      previousOverflowRef.current = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
      setCurrentSnap(initialSnap);
    } else {
      document.body.style.overflow = previousOverflowRef.current;
      setCurrentSnap('closed');
    }

    return () => {
      document.body.style.overflow = previousOverflowRef.current;
    };
  }, [isOpen, initialSnap]);

  // =============================================================================
  // Drag Handlers
  // =============================================================================

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    const touch = e.touches[0];
    if (!touch) {
      return;
    }
    startYRef.current = touch.clientY;
    currentYRef.current = touch.clientY;
    setIsDragging(true);
  }, []);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (!isDragging) {
      return;
    }

    const touch = e.touches[0];
    if (!touch) {
      return;
    }

    const currentY = touch.clientY;
    const deltaY = currentY - startYRef.current;
    currentYRef.current = currentY;

    // Only allow dragging down (positive deltaY) or up (negative deltaY)
    setDragOffset(deltaY);
  }, [isDragging]);

  const handleTouchEnd = useCallback(() => {
    if (!isDragging) {
      return;
    }
    setIsDragging(false);

    const viewportHeight = window.innerHeight;
    const currentHeight = SNAP_HEIGHTS[currentSnap];
    const currentPixelHeight = (currentHeight / 100) * viewportHeight;
    const newPixelHeight = currentPixelHeight - dragOffset;
    const newPercentHeight = (newPixelHeight / viewportHeight) * 100;

    // Determine which snap point to go to based on velocity and position
    const velocity = dragOffset / 100; // Simple velocity approximation

    let newSnap: SnapPoint = currentSnap;

    if (dragOffset > 100 || velocity > 1.5) {
      // Dragged down significantly - go to lower snap or close
      if (currentSnap === 'full') {
        newSnap = 'half';
      } else if (currentSnap === 'half') {
        newSnap = 'peek';
      } else {
        newSnap = 'closed';
        onClose();
      }
    } else if (dragOffset < -100 || velocity < -1.5) {
      // Dragged up significantly - go to higher snap
      if (currentSnap === 'peek') {
        newSnap = 'half';
      } else if (currentSnap === 'half') {
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
      }, currentSnap);
    }

    if (newSnap === 'closed') {
      onClose();
    } else {
      setCurrentSnap(newSnap);
    }

    setDragOffset(0);
  }, [isDragging, currentSnap, dragOffset, onClose]);

  // =============================================================================
  // Mouse Handlers (for desktop testing)
  // =============================================================================

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    startYRef.current = e.clientY;
    currentYRef.current = e.clientY;
    setIsDragging(true);
  }, []);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!isDragging) {
      return;
    }
    const deltaY = e.clientY - startYRef.current;
    setDragOffset(deltaY);
  }, [isDragging]);

  const handleMouseUp = useCallback(() => {
    if (isDragging) {
      handleTouchEnd();
    }
  }, [isDragging, handleTouchEnd]);

  // Global mouse up listener
  useEffect(() => {
    const handleGlobalMouseUp = () => {
      if (isDragging) {
        handleTouchEnd();
      }
    };

    if (isDragging) {
      window.addEventListener('mouseup', handleGlobalMouseUp);
      return () => window.removeEventListener('mouseup', handleGlobalMouseUp);
    }
    return undefined;
  }, [isDragging, handleTouchEnd]);

  // =============================================================================
  // Backdrop Click
  // =============================================================================

  const handleBackdropClick = useCallback(() => {
    onClose();
  }, [onClose]);

  // =============================================================================
  // Render
  // =============================================================================

  if (!isOpen && currentSnap === 'closed') {
    return null;
  }

  const targetHeight = SNAP_HEIGHTS[currentSnap];
  const translateY = isDragging
    ? `calc(${100 - targetHeight}vh + ${dragOffset}px)`
    : `${100 - targetHeight}vh`;

  return (
    <div className="fixed inset-0 z-50">
      {/* Backdrop */}
      <div
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
        className="absolute inset-x-0 bottom-0 rounded-t-3xl shadow-2xl"
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
          className="flex h-8 cursor-grab items-center justify-center active:cursor-grabbing"
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
        >
          <div
            className="h-1 w-10 rounded-full"
            style={{ backgroundColor: cappuccino.cardBorder }}
          />
        </div>

        {/* Content */}
        <div
          className="h-full overflow-y-auto overscroll-contain px-4 pb-8"
          style={{ maxHeight: 'calc(100vh - 32px)' }}
        >
          {children}
        </div>
      </div>
    </div>
  );
}

export default BottomSheet;
