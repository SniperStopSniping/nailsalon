// =============================================================================
// AUTOPOST POSTER
// =============================================================================
// Posts photos to Instagram and Facebook using Meta Graph API.
//
// Supported platforms:
// - instagram: IG Business accounts via container → publish flow
// - facebook: Facebook Pages via /photos endpoint
//
// NOT supported:
// - tiktok, twitter/x, personal instagram accounts
// =============================================================================

import { generateCaption } from './caption';
import { getFacebookSafeUrl, getInstagramSafeUrl } from './cloudinaryUrl';
import { getMetaConfig, isMetaConfigured, metaGet, MetaGraphError, metaPost } from './metaClient';

// =============================================================================
// TYPES
// =============================================================================

export type PostPayload = {
  payloadVersion: number;
  appointmentId: string;
  salonId: string;
  salonName?: string; // Included for caption personalization (added in Step 10 hardening)
  afterPhotoObjectKey: string;
  includePrice: boolean;
  includeColor: boolean;
  includeBrand: boolean;
  aiCaptionEnabled: boolean;
};

export type PostResult = {
  externalPostId: string;
  retryAfterMs?: number;
};

// =============================================================================
// INSTAGRAM CONTAINER STATUS POLLING
// =============================================================================

// Polling intervals for IG container readiness (ms)
const IG_POLL_INTERVALS = [2000, 2000, 5000, 5000, 10000];

type ContainerStatusResponse = {
  status_code?: string;
  status?: string;
  error_message?: string;
};

/**
 * Poll Instagram container until ready or error
 */
async function pollContainerStatus(
  containerId: string,
  appointmentId: string,
): Promise<void> {
  for (let i = 0; i < IG_POLL_INTERVALS.length; i++) {
    await new Promise(resolve => setTimeout(resolve, IG_POLL_INTERVALS[i]));

    const status = await metaGet<ContainerStatusResponse>(
      `/${containerId}`,
      { fields: 'status_code,status' },
      'instagram',
    );

    const statusCode = status.status_code?.toUpperCase() || status.status?.toUpperCase();

    if (statusCode === 'FINISHED' || statusCode === 'PUBLISHED') {
      return; // Ready to publish
    }

    if (statusCode === 'ERROR') {
      throw new Error(
        `Instagram container error for appointment ${appointmentId}: ${status.error_message || 'Unknown error'}`,
      );
    }

    // IN_PROGRESS or other status - continue polling
  }

  throw new Error(
    `Instagram container timeout for appointment ${appointmentId}: Container did not become ready after ${IG_POLL_INTERVALS.length} attempts`,
  );
}

// =============================================================================
// INSTAGRAM POSTING
// =============================================================================

type CreateMediaResponse = {
  id: string;
};

type PublishMediaResponse = {
  id: string;
};

/**
 * Post to Instagram Business account.
 *
 * Flow:
 * 1. Create media container with image URL and caption
 * 2. Poll container until ready
 * 3. Publish the container
 */
async function postToInstagram(
  payload: PostPayload,
  caption: string,
): Promise<string> {
  const config = getMetaConfig();

  if (!config.instagramAccountId) {
    throw new Error('META_INSTAGRAM_ACCOUNT_ID is not configured');
  }

  const imageUrl = getInstagramSafeUrl(payload.afterPhotoObjectKey);

  // Step 1: Create media container
  const createResponse = await metaPost<CreateMediaResponse>(
    `/${config.instagramAccountId}/media`,
    {
      image_url: imageUrl,
      caption,
    },
    'instagram',
  );

  if (!createResponse.id) {
    throw new Error(
      `Instagram container creation failed for appointment ${payload.appointmentId}: No container ID returned`,
    );
  }

  const containerId = createResponse.id;

  // Step 2: Poll container until ready
  await pollContainerStatus(containerId, payload.appointmentId);

  // Step 3: Publish
  const publishResponse = await metaPost<PublishMediaResponse>(
    `/${config.instagramAccountId}/media_publish`,
    {
      creation_id: containerId,
    },
    'instagram',
  );

  if (!publishResponse.id) {
    throw new Error(
      `Instagram publish failed for appointment ${payload.appointmentId}: No post ID returned`,
    );
  }

  return publishResponse.id;
}

// =============================================================================
// FACEBOOK POSTING
// =============================================================================

type FacebookPhotoResponse = {
  post_id?: string;
  id?: string;
};

/**
 * Post to Facebook Page.
 *
 * Uses the /photos endpoint for image posts.
 */
async function postToFacebook(
  payload: PostPayload,
  caption: string,
): Promise<string> {
  const config = getMetaConfig();

  if (!config.facebookPageId) {
    throw new Error('META_FACEBOOK_PAGE_ID is not configured');
  }

  const imageUrl = getFacebookSafeUrl(payload.afterPhotoObjectKey);

  const response = await metaPost<FacebookPhotoResponse>(
    `/${config.facebookPageId}/photos`,
    {
      url: imageUrl,
      caption,
      published: true,
    },
    'facebook',
  );

  // Prefer post_id, fall back to id
  const postId = response.post_id || response.id;

  if (!postId) {
    throw new Error(
      `Facebook post failed for appointment ${payload.appointmentId}: No post ID returned`,
    );
  }

  return postId;
}

// =============================================================================
// MAIN POSTER FUNCTION
// =============================================================================

/**
 * Post a photo to a social platform.
 *
 * @param args - Arguments object
 * @param args.platform - Target platform ('instagram' | 'facebook')
 * @param args.payload - Post payload from autopost queue
 * @returns Post result with external ID
 * @throws Error on failure (worker will retry)
 */
export async function postToPlatform(args: {
  platform: string;
  payload: PostPayload;
}): Promise<PostResult> {
  const { platform, payload } = args;

  // Check Meta is configured
  if (!isMetaConfigured()) {
    throw new Error(
      `Meta integration not configured for platform ${platform}, appointment ${payload.appointmentId}`,
    );
  }

  // Generate caption (fail-safe, always returns a string)
  // Pass salonName from payload for personalization (falls back to default if not present)
  const caption = await generateCaption(payload, payload.salonName);

  try {
    let externalPostId: string;

    switch (platform) {
      case 'instagram':
        externalPostId = await postToInstagram(payload, caption);
        break;

      case 'facebook':
        externalPostId = await postToFacebook(payload, caption);
        break;

      case 'tiktok':
        throw new Error(
          `TikTok posting not implemented for appointment ${payload.appointmentId}`,
        );

      default:
        throw new Error(
          `Unsupported platform "${platform}" for appointment ${payload.appointmentId}`,
        );
    }

    return { externalPostId };
  } catch (error) {
    // Enhance error with context
    if (error instanceof MetaGraphError) {
      const enhancedError = new Error(
        `Meta API error for ${platform}, appointment ${payload.appointmentId}: `
        + `[${error.code}${error.subcode ? `:${error.subcode}` : ''}] ${error.message}`,
      );
      // Attach retry hint if available
      (enhancedError as Error & { retryAfterMs?: number }).retryAfterMs = error.retryAfterMs;
      throw enhancedError;
    }

    // Re-throw other errors as-is
    throw error;
  }
}

/**
 * Validate that a platform is supported for real posting
 */
export function isSupportedPlatform(platform: string): boolean {
  return ['instagram', 'facebook'].includes(platform);
}
