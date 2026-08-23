// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  BOOKING_PAGE_PREVIEW_FRAME_SELECTORS,
  normalizeBookingPagePreviewFrame,
} from './bookingPagePreviewFrame';

function authorizedPreviewFrame(src = '/en/salon-a/book/service?builderPreview=7') {
  const frame = document.createElement('iframe');
  frame.classList.add('pointer-events-none');
  frame.setAttribute('src', src);
  document.body.append(frame);
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
  const scrollTo = vi.fn(() => {
    previewDocument.documentElement.scrollTop = 0;
    previewDocument.body.scrollTop = 0;
  });
  const previewWindow = {
    history: { scrollRestoration: 'auto' },
    scrollTo,
  } as unknown as Window;
  Object.defineProperty(frame, 'contentDocument', {
    configurable: true,
    value: previewDocument,
  });
  Object.defineProperty(frame, 'contentWindow', {
    configurable: true,
    value: previewWindow,
  });

  return { frame, previewDocument, previewWindow, scrollTo, src };
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
    const { frame, previewDocument, scrollTo, src } = authorizedPreviewFrame();

    expect(normalizeBookingPagePreviewFrame({ expectedSrc: src, frame })).toBe(true);
    expect(previewDocument.documentElement.scrollTop).toBe(0);
    expect(previewDocument.body.scrollTop).toBe(0);
    expect(scrollTo).toHaveBeenCalledWith(0, 0);
    expect(frame.contentWindow?.history.scrollRestoration).toBe('manual');
    expect(frame).not.toHaveClass('pointer-events-none');
    expect(frame).toHaveClass('pointer-events-auto');

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
    const { frame, previewDocument, scrollTo, src } = authorizedPreviewFrame();
    const link = previewDocument.createElement('a');
    link.href = '/leave-preview';
    previewDocument.body.append(link);

    expect(normalizeBookingPagePreviewFrame({ expectedSrc: src, frame })).toBe(true);

    const click = new MouseEvent('click', { bubbles: true, cancelable: true });
    const auxiliaryClick = new MouseEvent('auxclick', { bubbles: true, cancelable: true });
    const submit = new Event('submit', { bubbles: true, cancelable: true });

    expect(link.dispatchEvent(click)).toBe(false);
    expect(link.dispatchEvent(auxiliaryClick)).toBe(false);
    expect(previewDocument.body.dispatchEvent(submit)).toBe(false);
    expect(click.defaultPrevented).toBe(true);
    expect(auxiliaryClick.defaultPrevented).toBe(true);
    expect(submit.defaultPrevented).toBe(true);
    expect(previewDocument.querySelector(
      BOOKING_PAGE_PREVIEW_FRAME_SELECTORS.interactionGuard,
    )?.textContent).toContain('pointer-events: none');
    expect(scrollTo).toHaveBeenCalledWith(0, 0);
  });

  it.each([
    ['stale source', '/en/salon-a/book/service?builderPreview=8', null],
    ['anonymous/live document', '/en/salon-a/book/service?builderPreview=7', BOOKING_PAGE_PREVIEW_FRAME_SELECTORS.authorizedDraft],
    ['noncanonical document', '/en/salon-a/book/service?builderPreview=7', BOOKING_PAGE_PREVIEW_FRAME_SELECTORS.canonicalBookingSurface],
    ['partial renderer', '/en/salon-a/book/service?builderPreview=7', BOOKING_PAGE_PREVIEW_FRAME_SELECTORS.completedRenderer],
  ])('fails closed for a %s', (_caseName, expectedSrc, removedSelector) => {
    const { frame, previewDocument, scrollTo } = authorizedPreviewFrame();
    if (removedSelector) {
      previewDocument.querySelector(removedSelector)?.remove();
    }

    expect(normalizeBookingPagePreviewFrame({ expectedSrc, frame })).toBe(false);
    expect(frame).toHaveClass('pointer-events-none');
    expect(frame).not.toHaveClass('pointer-events-auto');
    expect(previewDocument.documentElement.scrollTop).toBe(640);
    expect(previewDocument.body.scrollTop).toBe(640);
    expect(scrollTo).not.toHaveBeenCalled();
  });

  it('fails closed when the loaded document does not match the expected iframe identity', () => {
    const { frame, previewDocument, scrollTo, src } = authorizedPreviewFrame();
    Object.defineProperty(previewDocument, 'URL', {
      configurable: true,
      value: new URL('/en/salon-a/book/service?builderPreview=6', document.baseURI).href,
    });

    expect(normalizeBookingPagePreviewFrame({ expectedSrc: src, frame })).toBe(false);
    expect(frame).toHaveClass('pointer-events-none');
    expect(frame).not.toHaveClass('pointer-events-auto');
    expect(previewDocument.documentElement.scrollTop).toBe(640);
    expect(previewDocument.body.scrollTop).toBe(640);
    expect(scrollTo).not.toHaveBeenCalled();
  });
});
