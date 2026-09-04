import 'server-only';

import { ONBOARDING_MEDIA_MAX_REQUEST_BYTES } from './media-limits';

export class OnboardingMediaRequestTooLarge extends Error {}

/** Enforce the body bound even when Content-Length is missing or untrusted. */
export const readOnboardingMediaForm = async (request: Request): Promise<FormData> => {
  const reader = request.body?.getReader();
  if (!reader) {
    throw new Error('Missing media body.');
  }
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      size += value.byteLength;
      if (size > ONBOARDING_MEDIA_MAX_REQUEST_BYTES) {
        throw new OnboardingMediaRequestTooLarge();
      }
      chunks.push(value);
    }
  } finally {
    await reader.cancel();
  }
  return new Response(Buffer.concat(chunks), {
    headers: { 'Content-Type': request.headers.get('content-type') ?? '' },
  }).formData();
};
