import { useEffect } from 'react';

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
    const scrollY = window.scrollY;
    const previous = {
      overflow: document.body.style.overflow,
      position: document.body.style.position,
      top: document.body.style.top,
      width: document.body.style.width,
    };
    document.body.style.overflow = 'hidden';
    document.body.style.position = 'fixed';
    document.body.style.top = `-${scrollY}px`;
    document.body.style.width = '100%';
    return () => {
      document.body.style.overflow = previous.overflow;
      document.body.style.position = previous.position;
      document.body.style.top = previous.top;
      document.body.style.width = previous.width;
      // Skip when there is nothing to restore — also keeps jsdom (which does
      // not implement scrollTo and always reports scrollY 0) quiet in tests.
      if (scrollY !== 0) {
        window.scrollTo(0, scrollY);
      }
    };
  }, [active]);
}
