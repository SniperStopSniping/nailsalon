/** URLs come only from the capability-authenticated recovery endpoint, never the model. */
export function customerBookingRecoveryUrl(value: string, action: 'resume' | 'manage'): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.port || url.hash) {
      return null;
    }
    if (action === 'resume') {
      return url.hostname === 'checkout.stripe.com' ? url.href : null;
    }
    // The server's canonical tenant host can differ from the booking alias.
    // Retain that authority, with only the canonical opaque guest-link shape.
    return !url.search && /^\/(?:[a-z]{2}\/[a-z0-9-]+\/)?manage\/[\w-]+$/.test(url.pathname) ? url.href : null;
  } catch {
    return null;
  }
}
