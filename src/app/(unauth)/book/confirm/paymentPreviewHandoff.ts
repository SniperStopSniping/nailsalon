/**
 * A navigation hint, never payment authority. Only reuse a server-returned
 * private manage link on this origin; do not carry prices, tips or quote IDs.
 */
export function paymentPreviewHandoffUrl(manageUrl: string | null, origin: string): string | null {
  if (!manageUrl || manageUrl.trim() !== manageUrl || manageUrl.startsWith('//')
    || (!manageUrl.startsWith('/') && !/^https?:\/\//.test(manageUrl))
    || manageUrl.includes('\\') || manageUrl.includes('?') || manageUrl.includes('#')
    || [...manageUrl].some(character => character.charCodeAt(0) <= 32 || character.charCodeAt(0) === 127)) {
    return null;
  }
  try {
    const base = new URL(origin);
    const url = new URL(manageUrl, base.origin);
    if (!['http:', 'https:'].includes(url.protocol) || url.origin !== base.origin
      || url.username || url.password || url.search || url.hash
      || !/^\/(?:[a-z]{2}\/[a-z0-9-]+\/)?manage\/[\w-]+$/.test(url.pathname)) {
      return null;
    }
    return `${url.pathname}#customer-payment-preview`;
  } catch {
    return null;
  }
}
