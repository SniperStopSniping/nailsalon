import { useEffect } from 'react';

type BodyStyleSnapshot = {
  overflow: string;
  position: string;
  top: string;
  width: string;
  scrollY: number;
};

let activeLockCount = 0;
let bodyStyleSnapshot: BodyStyleSnapshot | null = null;

/**
 * Locks body scrolling while `active` is true, preserving and restoring the
 * scroll position. Shared by every overlay so the page behind a modal or
 * sheet can never scroll on touch devices.
 */
export function useBodyScrollLock(active: boolean): void {
  useEffect(() => {
    if (!active) {
      return undefined;
    }

    if (activeLockCount === 0) {
      bodyStyleSnapshot = {
        overflow: document.body.style.overflow,
        position: document.body.style.position,
        top: document.body.style.top,
        width: document.body.style.width,
        scrollY: window.scrollY,
      };
      document.body.style.overflow = 'hidden';
      document.body.style.position = 'fixed';
      document.body.style.top = `-${bodyStyleSnapshot.scrollY}px`;
      document.body.style.width = '100%';
    }
    activeLockCount += 1;

    return () => {
      activeLockCount = Math.max(0, activeLockCount - 1);
      if (activeLockCount > 0 || !bodyStyleSnapshot) {
        return;
      }

      const previous = bodyStyleSnapshot;
      bodyStyleSnapshot = null;
      document.body.style.overflow = previous.overflow;
      document.body.style.position = previous.position;
      document.body.style.top = previous.top;
      document.body.style.width = previous.width;
      // Skip when there is nothing to restore — also keeps jsdom (which does
      // not implement scrollTo and always reports scrollY 0) quiet in tests.
      if (previous.scrollY !== 0) {
        window.scrollTo(0, previous.scrollY);
      }
    };
  }, [active]);
}
