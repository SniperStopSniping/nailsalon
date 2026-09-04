// Keep multipart requests and private proxy responses below Vercel's 4.5 MB
// function payload limit. Reserve 250 KB for multipart framing and metadata.
export const ONBOARDING_MEDIA_MAX_REQUEST_BYTES = 4_000_000;
export const ONBOARDING_MEDIA_MAX_FILE_BYTES = 3_750_000;
