import { type RefObject, useEffect, useState } from 'react';

const isTextEntry = (element: Element | null): element is HTMLElement => {
  if (!(element instanceof HTMLElement)) {
    return false;
  }
  if (element instanceof HTMLTextAreaElement) {
    return !element.disabled && !element.readOnly;
  }
  if (element instanceof HTMLInputElement) {
    return !element.disabled && !element.readOnly && ![
      'button',
      'checkbox',
      'color',
      'date',
      'file',
      'hidden',
      'image',
      'month',
      'radio',
      'range',
      'reset',
      'submit',
      'time',
      'week',
    ].includes(element.type) && element.inputMode !== 'none';
  }
  return element.isContentEditable;
};

/** Keep owner navigation out of the software keyboard's editing viewport. */
export function useOnboardingKeyboard(root: RefObject<HTMLElement | null>): boolean {
  const [keyboardOpen, setKeyboardOpen] = useState(false);

  useEffect(() => {
    const viewport = window.visualViewport;
    const touchCapable = () => navigator.maxTouchPoints > 0
      || window.matchMedia?.('(any-pointer: coarse)').matches;
    const layoutHeight = () => Math.max(window.innerHeight, document.documentElement.clientHeight);
    let restingHeight = layoutHeight();
    let viewportWidth = window.innerWidth;
    let visible = false;
    let frame = 0;
    let swipe: { x: number; y: number } | undefined;

    const activeEditor = () => {
      const active = document.activeElement;
      return isTextEntry(active) && root.current?.contains(active) ? active : null;
    };

    const measure = () => {
      frame = 0;
      if (window.innerWidth !== viewportWidth) {
        viewportWidth = window.innerWidth;
        restingHeight = layoutHeight();
      }
      const editor = activeEditor();
      if (!editor && !visible) {
        restingHeight = layoutHeight();
      }
      // Normalize zoom back to layout pixels: pinch zoom alone must not look
      // like a keyboard, but Safari's focus zoom must not mask an actual one.
      const height = (viewport?.height ?? window.innerHeight) * (viewport?.scale ?? 1);
      // Ignore browser toolbar changes. Retain the resting height for browsers
      // that resize the layout viewport along with the software keyboard.
      const reduced = Math.max(restingHeight, layoutHeight()) - height > 120;
      const next = Boolean(touchCapable() && (editor || visible) && reduced);
      if (next !== visible) {
        visible = next;
        setKeyboardOpen(next);
      }
      if (!next && !editor) {
        restingHeight = layoutHeight();
      }
    };
    const scheduleMeasure = () => {
      if (!frame) {
        frame = window.requestAnimationFrame(measure);
      }
    };

    const protectsEditing = (target: EventTarget | null, editor: HTMLElement) => {
      if (!(target instanceof Element)) {
        return false;
      }
      const field = target.closest('input, textarea, [contenteditable]');
      if (isTextEntry(field)) {
        return true;
      }
      const label = target.closest('label');
      if (label instanceof HTMLLabelElement && isTextEntry(label.control)) {
        return true;
      }
      // Do not blur a combobox before its suggestion's click handler can run.
      return (editor.getAttribute('aria-controls') ?? '').split(/\s+/u)
        .some(id => id && document.getElementById(id)?.contains(target));
    };
    const onClick = (event: MouseEvent) => {
      const editor = activeEditor();
      if (touchCapable() && editor && !protectsEditing(event.target, editor)) {
        editor.blur();
      }
    };
    const onTouchStart = (event: TouchEvent) => {
      swipe = undefined;
      const editor = activeEditor();
      const touch = event.touches[0];
      if (editor && touch && event.touches.length === 1 && !protectsEditing(event.target, editor)) {
        swipe = { x: touch.clientX, y: touch.clientY };
      }
    };
    const onTouchMove = (event: TouchEvent) => {
      const touch = event.touches[0];
      if (!swipe || !touch || event.touches.length !== 1) {
        return;
      }
      const distanceY = Math.abs(touch.clientY - swipe.y);
      if (distanceY > 14 && distanceY > Math.abs(touch.clientX - swipe.x)) {
        activeEditor()?.blur();
        swipe = undefined;
      }
    };
    const clearSwipe = () => {
      swipe = undefined;
    };

    // Only intentional gestures dismiss editing, never focus auto-scrolling,
    // validation scrollIntoView, or the visual viewport moving above a keyboard.
    document.addEventListener('focusin', scheduleMeasure);
    document.addEventListener('focusout', scheduleMeasure);
    document.addEventListener('click', onClick);
    document.addEventListener('touchstart', onTouchStart, { passive: true });
    document.addEventListener('touchmove', onTouchMove, { passive: true });
    document.addEventListener('touchend', clearSwipe, { passive: true });
    document.addEventListener('touchcancel', clearSwipe, { passive: true });
    window.addEventListener('resize', scheduleMeasure, { passive: true });
    viewport?.addEventListener('resize', scheduleMeasure, { passive: true });
    measure();
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener('focusin', scheduleMeasure);
      document.removeEventListener('focusout', scheduleMeasure);
      document.removeEventListener('click', onClick);
      document.removeEventListener('touchstart', onTouchStart);
      document.removeEventListener('touchmove', onTouchMove);
      document.removeEventListener('touchend', clearSwipe);
      document.removeEventListener('touchcancel', clearSwipe);
      window.removeEventListener('resize', scheduleMeasure);
      viewport?.removeEventListener('resize', scheduleMeasure);
    };
  }, [root]);

  return keyboardOpen;
}
