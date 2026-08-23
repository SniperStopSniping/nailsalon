const CANONICAL_BOOKING_SURFACE_SELECTOR
  = '[data-public-surface="serviceSelectionControls"]';
const AUTHORIZED_DRAFT_PREVIEW_SELECTOR
  = '[data-preview-variant="draft-config"], [data-preview-variant="draft-salon"]';
const COMPLETED_RENDERER_SELECTOR = '[data-builder-reorderable-section-order]';
const VIEW_ONLY_PREVIEW_STYLE_ID = 'luster-view-only-preview-guard';
const SAFE_SCROLL_SURFACE_SELECTOR = '[data-booking-page-preview-scroll]';

const guardedPreviewDocuments = new WeakSet<Document>();
const admittedPreviewByScrollSurface = new WeakMap<HTMLElement, {
  document: Document;
  frame: HTMLIFrameElement;
}>();
const guardedScrollSurfaces = new WeakSet<HTMLElement>();

type NormalizeBookingPagePreviewFrameOptions = Readonly<{
  expectedSrc: string;
  frame: HTMLIFrameElement;
}>;

export function disableBookingPagePreviewFrameInteraction(frame: HTMLIFrameElement): void {
  frame.classList.add('pointer-events-none');
  frame.classList.remove('pointer-events-auto');
  frame.setAttribute('inert', '');
  frame.blur();
}

function absoluteUrl(value: string, baseUrl: string): string | null {
  try {
    return new URL(value, baseUrl).href;
  } catch {
    return null;
  }
}

function scrollPreviewBy(scrollSurface: HTMLElement, deltaY: number): boolean {
  const admittedPreview = admittedPreviewByScrollSurface.get(scrollSurface);
  const frame = admittedPreview?.frame;
  if (!admittedPreview || !frame?.isConnected) {
    return false;
  }

  try {
    if (frame.contentDocument !== admittedPreview.document) {
      return false;
    }
    const previewWindow = frame.contentWindow;
    if (!previewWindow) {
      return false;
    }
    const before = previewWindow.scrollY;
    previewWindow.scrollBy(0, deltaY);
    return previewWindow.scrollY !== before;
  } catch {
    // Cross-origin, replacing, or otherwise unreadable documents remain
    // non-interactive. The parent page may continue its own native scroll.
    return false;
  }
}

function guardSafeScrollSurface(
  scrollSurface: HTMLElement,
  frame: HTMLIFrameElement,
  previewDocument: Document,
): void {
  admittedPreviewByScrollSurface.set(scrollSurface, {
    document: previewDocument,
    frame,
  });
  if (guardedScrollSurfaces.has(scrollSurface)) {
    return;
  }

  let lastTouchY: number | null = null;
  scrollSurface.addEventListener('wheel', (event) => {
    if (event.ctrlKey || event.metaKey) {
      return;
    }
    if (scrollPreviewBy(scrollSurface, event.deltaY)) {
      event.preventDefault();
    }
  }, { passive: false });
  scrollSurface.addEventListener('touchstart', (event) => {
    lastTouchY = event.touches.length === 1
      ? event.touches[0]?.clientY ?? null
      : null;
  }, { passive: true });
  scrollSurface.addEventListener('touchmove', (event) => {
    if (event.touches.length !== 1) {
      lastTouchY = null;
      return;
    }
    const nextTouchY = event.touches[0]?.clientY ?? null;
    if (lastTouchY === null || nextTouchY === null) {
      return;
    }
    const deltaY = lastTouchY - nextTouchY;
    lastTouchY = nextTouchY;
    if (scrollPreviewBy(scrollSurface, deltaY)) {
      event.preventDefault();
    }
  }, { passive: false });
  const clearTouch = () => {
    lastTouchY = null;
  };
  scrollSurface.addEventListener('touchend', clearTouch, { passive: true });
  scrollSurface.addEventListener('touchcancel', clearTouch, { passive: true });
  guardedScrollSurfaces.add(scrollSurface);
}

function guardViewOnlyPreview({
  previewDocument,
}: {
  previewDocument: Document;
}): void {
  if (guardedPreviewDocuments.has(previewDocument)) {
    return;
  }

  // The canonical page remains the source of preview markup, but its controls
  // are deliberately inert in this script-disabled, view-only surface. Wheel
  // and touch scrolling do not dispatch these activation events.
  const preventActivation = (event: Event) => event.preventDefault();
  const removeFocus = (event: Event) => {
    const focusTarget = event.target as HTMLElement | null;
    focusTarget?.blur?.();
  };
  previewDocument.addEventListener('click', preventActivation, true);
  previewDocument.addEventListener('auxclick', preventActivation, true);
  previewDocument.addEventListener('beforeinput', preventActivation, true);
  previewDocument.addEventListener('keydown', preventActivation, true);
  previewDocument.addEventListener('submit', preventActivation, true);
  previewDocument.addEventListener('focusin', removeFocus, true);

  const interactionGuard = previewDocument.createElement('style');
  interactionGuard.id = VIEW_ONLY_PREVIEW_STYLE_ID;
  interactionGuard.textContent = 'body * { pointer-events: none !important; }';
  previewDocument.head.append(interactionGuard);
  guardedPreviewDocuments.add(previewDocument);
}

/**
 * Establishes the starting viewport for an authorization-bound, same-origin
 * booking-page preview. The iframe remains script-disabled; this parent-side
 * lifecycle is the only code allowed to normalize its child browsing context.
 */
export function normalizeBookingPagePreviewFrame({
  expectedSrc,
  frame,
}: NormalizeBookingPagePreviewFrameOptions): boolean {
  // A child document can become visible before its load event fires. Keep the
  // frame inert until this exact document has passed every authorization and
  // canonical-renderer check and its view-only activation guards are installed.
  disableBookingPagePreviewFrameInteraction(frame);

  const ownerDocument = frame.ownerDocument;
  const actualSrc = frame.getAttribute('src');
  const expectedUrl = absoluteUrl(expectedSrc, ownerDocument.baseURI);
  const actualUrl = actualSrc ? absoluteUrl(actualSrc, ownerDocument.baseURI) : null;

  if (!expectedUrl || actualUrl !== expectedUrl) {
    return false;
  }

  let previewDocument: Document | null;
  let previewWindow: Window | null;
  try {
    previewDocument = frame.contentDocument;
    previewWindow = frame.contentWindow;
  } catch {
    return false;
  }

  if (!previewDocument
    || !previewWindow
    || !previewDocument.querySelector(CANONICAL_BOOKING_SURFACE_SELECTOR)
    || !previewDocument.querySelector(AUTHORIZED_DRAFT_PREVIEW_SELECTOR)
    || !previewDocument.querySelector(COMPLETED_RENDERER_SELECTOR)) {
    return false;
  }

  const loadedUrl = absoluteUrl(previewDocument.URL, ownerDocument.baseURI);
  if (loadedUrl !== expectedUrl) {
    return false;
  }

  const previewRoot = previewDocument.documentElement;
  const previewBody = previewDocument.body;
  const scrollSurface = frame.closest<HTMLElement>(SAFE_SCROLL_SURFACE_SELECTOR);
  if (!previewRoot || !previewBody || !scrollSurface) {
    return false;
  }

  guardViewOnlyPreview({ previewDocument });
  guardSafeScrollSurface(scrollSurface, frame, previewDocument);

  const normalize = () => {
    if (!frame.isConnected || frame.contentDocument !== previewDocument) {
      return;
    }

    try {
      previewWindow.history.scrollRestoration = 'manual';
    } catch {
      // A browser that does not expose history restoration still receives the
      // explicit root/body/window reset below.
    }
    previewRoot.scrollTop = 0;
    previewBody.scrollTop = 0;
    previewWindow.scrollTo(0, 0);
    // WebKit can apply child-frame restoration at the end of the load turn.
    // Reassert the DOM offsets after scrollTo so either scroll owner is reset.
    previewRoot.scrollTop = 0;
    previewBody.scrollTop = 0;
    scrollSurface.scrollTop = 0;
  };

  normalize();

  const parentWindow = ownerDocument.defaultView;
  if (parentWindow && typeof parentWindow.requestAnimationFrame === 'function') {
    parentWindow.requestAnimationFrame(() => {
      normalize();
      parentWindow.requestAnimationFrame(normalize);
    });
  }

  return true;
}

export const BOOKING_PAGE_PREVIEW_FRAME_SELECTORS = Object.freeze({
  authorizedDraft: AUTHORIZED_DRAFT_PREVIEW_SELECTOR,
  canonicalBookingSurface: CANONICAL_BOOKING_SURFACE_SELECTOR,
  completedRenderer: COMPLETED_RENDERER_SELECTOR,
  interactionGuard: `#${VIEW_ONLY_PREVIEW_STYLE_ID}`,
  safeScrollSurface: SAFE_SCROLL_SURFACE_SELECTOR,
});
