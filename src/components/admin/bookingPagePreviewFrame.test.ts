// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  BOOKING_PAGE_PREVIEW_FRAME_SELECTORS,
  normalizeBookingPagePreviewFrame,
} from './bookingPagePreviewFrame';

function authorizedPreviewFrame(src = '/en/admin/booking-page/preview/salon-a?builderPreview=7') {
  const scrollSurface = document.createElement('div');
  scrollSurface.setAttribute('data-booking-page-preview-scroll', '');
  scrollSurface.style.height = '620px';
  scrollSurface.style.overflowY = 'auto';
  Object.defineProperty(scrollSurface, 'clientHeight', {
    configurable: true,
    value: 620,
  });
  scrollSurface.scrollTop = 640;
  const frame = document.createElement('iframe');
  frame.classList.add('pointer-events-none');
  frame.setAttribute('src', src);
  scrollSurface.append(frame);
  document.body.append(scrollSurface);
  const previewDocument = document.implementation.createHTMLDocument('preview');
  Object.defineProperty(previewDocument, 'URL', {
    configurable: true,
    value: new URL(src, document.baseURI).href,
  });
  previewDocument.body.innerHTML = `
    <div data-preview-variant="draft-config"></div>
    <div data-public-surface="serviceSelectionControls"></div>
    <div data-builder-reorderable-section-order="featuredServices policies"></div>
  `;
  Object.defineProperty(previewDocument.documentElement, 'scrollTop', {
    configurable: true,
    value: 640,
    writable: true,
  });
  Object.defineProperty(previewDocument.body, 'scrollTop', {
    configurable: true,
    value: 640,
    writable: true,
  });
  Object.defineProperty(previewDocument.documentElement, 'scrollHeight', {
    configurable: true,
    value: 1800,
  });
  Object.defineProperty(previewDocument.body, 'scrollHeight', {
    configurable: true,
    value: 1700,
  });
  let previewScrollY = 640;
  const scrollTo = vi.fn(() => {
    previewScrollY = 0;
    previewDocument.documentElement.scrollTop = 0;
    previewDocument.body.scrollTop = 0;
  });
  const scrollBy = vi.fn((_x: number, deltaY: number) => {
    previewScrollY = Math.max(0, Math.min(1200, previewScrollY + deltaY));
  });
  const previewWindow = Object.assign(new EventTarget(), {
    history: { scrollRestoration: 'auto' },
    scrollBy,
    scrollTo,
  }) as unknown as Window;
  Object.defineProperty(previewWindow, 'scrollY', {
    configurable: true,
    get: () => previewScrollY,
  });
  Object.defineProperty(frame, 'contentDocument', {
    configurable: true,
    value: previewDocument,
  });
  Object.defineProperty(frame, 'contentWindow', {
    configurable: true,
    value: previewWindow,
  });

  return {
    frame,
    previewDocument,
    previewWindow,
    scrollBy,
    scrollSurface,
    scrollTo,
    src,
  };
}

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe('normalizeBookingPagePreviewFrame', () => {
  it('normalizes an exact authorized canonical preview immediately and after WebKit restoration frames', () => {
    const animationFrames: FrameRequestCallback[] = [];
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      animationFrames.push(callback);
      return animationFrames.length;
    });
    const { frame, previewDocument, scrollSurface, scrollTo, src } = authorizedPreviewFrame();

    expect(normalizeBookingPagePreviewFrame({ expectedSrc: src, frame })).toBe(true);
    expect(previewDocument.documentElement.scrollTop).toBe(0);
    expect(previewDocument.body.scrollTop).toBe(0);
    expect(scrollTo).toHaveBeenCalledWith(0, 0);
    expect(frame.contentWindow?.history.scrollRestoration).toBe('manual');
    expect(frame).toHaveClass('pointer-events-none');
    expect(frame).not.toHaveClass('pointer-events-auto');
    expect(frame).toHaveAttribute('inert');
    expect(scrollSurface.scrollTop).toBe(0);

    previewDocument.documentElement.scrollTop = 500;
    previewDocument.body.scrollTop = 500;
    animationFrames.shift()?.(0);

    expect(previewDocument.documentElement.scrollTop).toBe(0);
    expect(previewDocument.body.scrollTop).toBe(0);

    previewDocument.documentElement.scrollTop = 300;
    previewDocument.body.scrollTop = 300;
    animationFrames.shift()?.(16);

    expect(previewDocument.documentElement.scrollTop).toBe(0);
    expect(previewDocument.body.scrollTop).toBe(0);
    expect(scrollTo).toHaveBeenCalledTimes(3);
  });

  it('keeps the canonical preview view-only without blocking its scroll lifecycle', () => {
    const {
      frame,
      previewDocument,
      scrollBy,
      scrollSurface,
      scrollTo,
      src,
    } = authorizedPreviewFrame();
    const link = previewDocument.createElement('a');
    link.href = '/leave-preview';
    const button = previewDocument.createElement('button');
    const input = previewDocument.createElement('input');
    const form = previewDocument.createElement('form');
    form.append(input, button);
    previewDocument.body.append(link, form);

    expect(normalizeBookingPagePreviewFrame({ expectedSrc: src, frame })).toBe(true);

    const click = new MouseEvent('click', { bubbles: true, cancelable: true });
    const buttonClick = new MouseEvent('click', { bubbles: true, cancelable: true });
    const auxiliaryClick = new MouseEvent('auxclick', { bubbles: true, cancelable: true });
    const beforeInput = new Event('beforeinput', { bubbles: true, cancelable: true });
    const keyDown = new KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      key: 'Enter',
    });
    const submit = new Event('submit', { bubbles: true, cancelable: true });
    const wheel = new WheelEvent('wheel', {
      bubbles: true,
      cancelable: true,
      deltaY: 600,
    });
    const blur = vi.spyOn(input, 'blur');

    expect(link.dispatchEvent(click)).toBe(false);
    expect(button.dispatchEvent(buttonClick)).toBe(false);
    expect(link.dispatchEvent(auxiliaryClick)).toBe(false);
    expect(input.dispatchEvent(beforeInput)).toBe(false);
    expect(input.dispatchEvent(keyDown)).toBe(false);
    expect(form.dispatchEvent(submit)).toBe(false);

    input.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));

    expect(scrollSurface.dispatchEvent(wheel)).toBe(false);
    expect(click.defaultPrevented).toBe(true);
    expect(buttonClick.defaultPrevented).toBe(true);
    expect(auxiliaryClick.defaultPrevented).toBe(true);
    expect(beforeInput.defaultPrevented).toBe(true);
    expect(keyDown.defaultPrevented).toBe(true);
    expect(submit.defaultPrevented).toBe(true);
    expect(wheel.defaultPrevented).toBe(true);
    expect(blur).toHaveBeenCalledTimes(1);
    expect(previewDocument.querySelector(
      BOOKING_PAGE_PREVIEW_FRAME_SELECTORS.interactionGuard,
    )?.textContent).toContain('pointer-events: none');
    expect(scrollTo).toHaveBeenCalledWith(0, 0);
    expect(scrollBy).toHaveBeenCalledWith(0, 600);
    expect(frame).toHaveClass('pointer-events-none');
    expect(frame).toHaveAttribute('inert');
  });

  it('translates parent-owned touch movement into child scrolling without exposing the frame', () => {
    const { frame, previewWindow, scrollBy, scrollSurface, src } = authorizedPreviewFrame();

    expect(normalizeBookingPagePreviewFrame({ expectedSrc: src, frame })).toBe(true);

    const touchStart = new Event('touchstart', { bubbles: true, cancelable: true });
    Object.defineProperty(touchStart, 'touches', { value: [{ clientY: 300 }] });
    const touchMove = new Event('touchmove', { bubbles: true, cancelable: true });
    Object.defineProperty(touchMove, 'touches', { value: [{ clientY: 180 }] });

    expect(scrollSurface.dispatchEvent(touchStart)).toBe(true);
    expect(scrollSurface.dispatchEvent(touchMove)).toBe(false);
    expect(touchMove.defaultPrevented).toBe(true);
    expect(scrollBy).toHaveBeenLastCalledWith(0, 120);
    expect(previewWindow.scrollY).toBe(120);
    expect(frame).toHaveClass('pointer-events-none');
    expect(frame).toHaveAttribute('inert');
  });

  it('leaves browser zoom gestures untouched', () => {
    const { frame, scrollBy, scrollSurface, src } = authorizedPreviewFrame();

    expect(normalizeBookingPagePreviewFrame({ expectedSrc: src, frame })).toBe(true);

    const zoomWheel = new WheelEvent('wheel', {
      bubbles: true,
      cancelable: true,
      ctrlKey: true,
      deltaY: 200,
    });

    expect(scrollSurface.dispatchEvent(zoomWheel)).toBe(true);
    expect(zoomWheel.defaultPrevented).toBe(false);

    const pinchStart = new Event('touchstart', { bubbles: true, cancelable: true });
    Object.defineProperty(pinchStart, 'touches', {
      value: [{ clientY: 300 }, { clientY: 500 }],
    });
    const pinchMove = new Event('touchmove', { bubbles: true, cancelable: true });
    Object.defineProperty(pinchMove, 'touches', {
      value: [{ clientY: 220 }, { clientY: 580 }],
    });

    expect(scrollSurface.dispatchEvent(pinchStart)).toBe(true);
    expect(scrollSurface.dispatchEvent(pinchMove)).toBe(true);
    expect(pinchMove.defaultPrevented).toBe(false);
    expect(scrollBy).not.toHaveBeenCalled();
  });

  it.each(['beforeunload', 'pagehide'])(
    'keeps an admitted iframe permanently inert across %s replacement signals',
    (lifecycleEvent) => {
      const { frame, previewWindow, src } = authorizedPreviewFrame();

      expect(normalizeBookingPagePreviewFrame({ expectedSrc: src, frame })).toBe(true);
      expect(frame).toHaveClass('pointer-events-none');
      expect(frame).toHaveAttribute('inert');

      previewWindow.dispatchEvent(new Event(lifecycleEvent));

      expect(frame).toHaveClass('pointer-events-none');
      expect(frame).not.toHaveClass('pointer-events-auto');
      expect(frame).toHaveAttribute('inert');
    },
  );

  it('fails closed for a same-URL replacement and safely reuses the frame afterward', () => {
    const first = authorizedPreviewFrame();
    const { frame, src } = first;

    expect(normalizeBookingPagePreviewFrame({ expectedSrc: src, frame })).toBe(true);

    const unattestedReplacement = authorizedPreviewFrame(src);
    unattestedReplacement.frame.remove();
    unattestedReplacement.previewDocument.querySelector(
      BOOKING_PAGE_PREVIEW_FRAME_SELECTORS.authorizedDraft,
    )?.remove();
    Object.defineProperty(frame, 'contentDocument', {
      configurable: true,
      value: unattestedReplacement.previewDocument,
    });
    Object.defineProperty(frame, 'contentWindow', {
      configurable: true,
      value: unattestedReplacement.previewWindow,
    });

    expect(normalizeBookingPagePreviewFrame({ expectedSrc: src, frame })).toBe(false);
    expect(frame).toHaveClass('pointer-events-none');
    expect(frame).toHaveAttribute('inert');

    const staleWheel = new WheelEvent('wheel', {
      bubbles: true,
      cancelable: true,
      deltaY: 300,
    });

    expect(first.scrollSurface.dispatchEvent(staleWheel)).toBe(true);
    expect(staleWheel.defaultPrevented).toBe(false);
    expect(unattestedReplacement.scrollBy).not.toHaveBeenCalled();

    const replacement = authorizedPreviewFrame(src);
    replacement.frame.remove();
    Object.defineProperty(frame, 'contentDocument', {
      configurable: true,
      value: replacement.previewDocument,
    });
    Object.defineProperty(frame, 'contentWindow', {
      configurable: true,
      value: replacement.previewWindow,
    });

    expect(normalizeBookingPagePreviewFrame({ expectedSrc: src, frame })).toBe(true);
    expect(frame).toHaveClass('pointer-events-none');
    expect(frame).toHaveAttribute('inert');

    const admittedWheel = new WheelEvent('wheel', {
      bubbles: true,
      cancelable: true,
      deltaY: 300,
    });

    expect(first.scrollSurface.dispatchEvent(admittedWheel)).toBe(false);
    expect(admittedWheel.defaultPrevented).toBe(true);
    expect(replacement.scrollBy).toHaveBeenCalledWith(0, 300);

    first.previewWindow.dispatchEvent(new Event('pagehide'));

    expect(frame).toHaveClass('pointer-events-none');
    expect(frame).toHaveAttribute('inert');
  });

  it.each([
    ['stale source', '/en/admin/booking-page/preview/salon-a?builderPreview=8', null],
    ['anonymous/live document', '/en/admin/booking-page/preview/salon-a?builderPreview=7', BOOKING_PAGE_PREVIEW_FRAME_SELECTORS.authorizedDraft],
    ['noncanonical document', '/en/admin/booking-page/preview/salon-a?builderPreview=7', BOOKING_PAGE_PREVIEW_FRAME_SELECTORS.canonicalBookingSurface],
    ['partial renderer', '/en/admin/booking-page/preview/salon-a?builderPreview=7', BOOKING_PAGE_PREVIEW_FRAME_SELECTORS.completedRenderer],
  ])('fails closed for a %s', (_caseName, expectedSrc, removedSelector) => {
    const { frame, previewDocument, scrollTo } = authorizedPreviewFrame();
    if (removedSelector) {
      previewDocument.querySelector(removedSelector)?.remove();
    }

    expect(normalizeBookingPagePreviewFrame({ expectedSrc, frame })).toBe(false);
    expect(frame).toHaveClass('pointer-events-none');
    expect(frame).not.toHaveClass('pointer-events-auto');
    expect(frame).toHaveAttribute('inert');
    expect(previewDocument.documentElement.scrollTop).toBe(640);
    expect(previewDocument.body.scrollTop).toBe(640);
    expect(scrollTo).not.toHaveBeenCalled();
  });

  it('fails closed when the loaded document does not match the expected iframe identity', () => {
    const { frame, previewDocument, scrollTo, src } = authorizedPreviewFrame();
    Object.defineProperty(previewDocument, 'URL', {
      configurable: true,
      value: new URL('/en/admin/booking-page/preview/salon-a?builderPreview=6', document.baseURI).href,
    });

    expect(normalizeBookingPagePreviewFrame({ expectedSrc: src, frame })).toBe(false);
    expect(frame).toHaveClass('pointer-events-none');
    expect(frame).not.toHaveClass('pointer-events-auto');
    expect(frame).toHaveAttribute('inert');
    expect(previewDocument.documentElement.scrollTop).toBe(640);
    expect(previewDocument.body.scrollTop).toBe(640);
    expect(scrollTo).not.toHaveBeenCalled();
  });

  it('fails closed when a cross-origin document cannot be inspected', () => {
    const { frame, scrollTo, src } = authorizedPreviewFrame();
    Object.defineProperty(frame, 'contentDocument', {
      configurable: true,
      get: () => {
        throw new DOMException('Blocked a frame with origin', 'SecurityError');
      },
    });

    expect(normalizeBookingPagePreviewFrame({ expectedSrc: src, frame })).toBe(false);
    expect(frame).toHaveClass('pointer-events-none');
    expect(frame).not.toHaveClass('pointer-events-auto');
    expect(frame).toHaveAttribute('inert');
    expect(scrollTo).not.toHaveBeenCalled();
  });
});
