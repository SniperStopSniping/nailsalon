const CANONICAL_BOOKING_SURFACE_SELECTOR
  = '[data-public-surface="serviceSelectionControls"]';
const AUTHORIZED_DRAFT_PREVIEW_SELECTOR
  = '[data-preview-variant="draft-config"], [data-preview-variant="draft-salon"]';
const COMPLETED_RENDERER_SELECTOR = '[data-builder-reorderable-section-order]';
const VIEW_ONLY_PREVIEW_STYLE_ID = 'luster-view-only-preview-guard';

const guardedPreviewDocuments = new WeakSet<Document>();

type NormalizeBookingPagePreviewFrameOptions = Readonly<{
  expectedSrc: string;
  frame: HTMLIFrameElement;
}>;

export function disableBookingPagePreviewFrameInteraction(frame: HTMLIFrameElement): void {
  frame.classList.add('pointer-events-none');
  frame.classList.remove('pointer-events-auto');
}

function absoluteUrl(value: string, baseUrl: string): string | null {
  try {
    return new URL(value, baseUrl).href;
  } catch {
    return null;
  }
}

function guardViewOnlyPreview(previewDocument: Document): void {
  if (guardedPreviewDocuments.has(previewDocument)) {
    return;
  }

  // The canonical page remains the source of preview markup, but its controls
  // are deliberately inert in this script-disabled, view-only surface. Wheel
  // and touch scrolling do not dispatch these activation events.
  const preventActivation = (event: Event) => event.preventDefault();
  previewDocument.addEventListener('click', preventActivation, true);
  previewDocument.addEventListener('auxclick', preventActivation, true);
  previewDocument.addEventListener('submit', preventActivation, true);

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
  if (!previewRoot || !previewBody) {
    return false;
  }

  guardViewOnlyPreview(previewDocument);

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
  };

  normalize();
  frame.classList.remove('pointer-events-none');
  frame.classList.add('pointer-events-auto');

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
});
