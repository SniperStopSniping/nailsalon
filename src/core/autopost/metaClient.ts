// =============================================================================
// META GRAPH API CLIENT
// =============================================================================
// HTTP wrapper for Facebook/Instagram Graph API.
// Handles authentication, error parsing, and rate limit detection.
//
// SECURITY: NEVER logs access tokens.
// =============================================================================

const GRAPH_VERSION = process.env.META_GRAPH_VERSION ?? 'v19.0';
const BASE_URL = `https://graph.facebook.com/${GRAPH_VERSION}`;

/**
 * Meta Graph API error structure
 */
export type MetaApiError = {
  platform: string;
  endpoint: string;
  code: number;
  subcode?: number;
  message: string;
  errorUserMsg?: string;
  retryAfterMs?: number;
};

/**
 * Custom error class for Meta API errors
 */
export class MetaGraphError extends Error {
  public readonly platform: string;
  public readonly endpoint: string;
  public readonly code: number;
  public readonly subcode?: number;
  public readonly errorUserMsg?: string;
  public readonly retryAfterMs?: number;

  constructor(error: MetaApiError) {
    super(error.message);
    this.name = 'MetaGraphError';
    this.platform = error.platform;
    this.endpoint = error.endpoint;
    this.code = error.code;
    this.subcode = error.subcode;
    this.errorUserMsg = error.errorUserMsg;
    this.retryAfterMs = error.retryAfterMs;
  }
}

/**
 * Get the Meta access token from environment.
 * Uses system user token for server-to-server calls.
 */
function getAccessToken(): string {
  const token = process.env.META_SYSTEM_USER_TOKEN;
  if (!token) {
    throw new Error('META_SYSTEM_USER_TOKEN is not configured');
  }
  return token;
}

/**
 * Parse rate limit headers from Meta response
 */
function parseRetryAfter(headers: Headers): number | undefined {
  // Meta uses x-business-use-case-usage or Retry-After
  const retryAfter = headers.get('Retry-After');
  if (retryAfter) {
    const seconds = Number.parseInt(retryAfter, 10);
    if (!Number.isNaN(seconds)) {
      return seconds * 1000; // Convert to ms
    }
  }
  return undefined;
}

/**
 * Make a GET request to the Meta Graph API
 */
export async function metaGet<T>(
  endpoint: string,
  params: Record<string, string> = {},
  platform: string = 'meta',
): Promise<T> {
  const url = new URL(`${BASE_URL}${endpoint}`);
  url.searchParams.set('access_token', getAccessToken());

  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }

  const response = await fetch(url.toString(), {
    method: 'GET',
    headers: {
      Accept: 'application/json',
    },
  });

  return handleResponse<T>(response, endpoint, platform);
}

/**
 * Make a POST request to the Meta Graph API
 */
export async function metaPost<T>(
  endpoint: string,
  body: Record<string, unknown>,
  platform: string = 'meta',
): Promise<T> {
  const url = `${BASE_URL}${endpoint}`;

  // Add access token to body
  const requestBody = {
    ...body,
    access_token: getAccessToken(),
  };

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
    body: JSON.stringify(requestBody),
  });

  return handleResponse<T>(response, endpoint, platform);
}

/**
 * Handle Meta API response, parsing errors and rate limits
 */
async function handleResponse<T>(
  response: Response,
  endpoint: string,
  platform: string,
): Promise<T> {
  const retryAfterMs = parseRetryAfter(response.headers);

  if (!response.ok) {
    let errorData: {
      error?: {
        code?: number;
        error_subcode?: number;
        message?: string;
        error_user_msg?: string;
      };
    } = {};

    try {
      errorData = await response.json();
    } catch {
      // Response wasn't JSON
    }

    const metaError = errorData.error;

    throw new MetaGraphError({
      platform,
      endpoint,
      code: metaError?.code ?? response.status,
      subcode: metaError?.error_subcode,
      message: metaError?.message ?? `HTTP ${response.status}`,
      errorUserMsg: metaError?.error_user_msg,
      retryAfterMs,
    });
  }

  return response.json() as Promise<T>;
}

/**
 * Check if an error indicates an invalid/expired token
 */
export function isTokenError(error: unknown): boolean {
  if (error instanceof MetaGraphError) {
    // Code 190 = Invalid OAuth access token
    // Code 102 = Session expired
    return error.code === 190 || error.code === 102;
  }
  return false;
}

/**
 * Check if an error indicates rate limiting
 */
export function isRateLimitError(error: unknown): boolean {
  if (error instanceof MetaGraphError) {
    // Code 4 = Application request limit reached
    // Code 17 = User request limit reached
    // Code 32 = Page request limit reached
    // Code 368 = Spam block
    return [4, 17, 32, 368].includes(error.code);
  }
  return false;
}

/**
 * Get Meta configuration from environment
 */
export function getMetaConfig() {
  return {
    facebookPageId: process.env.META_FACEBOOK_PAGE_ID,
    instagramAccountId: process.env.META_INSTAGRAM_ACCOUNT_ID,
    graphVersion: GRAPH_VERSION,
  };
}

/**
 * Check if Meta integration is configured
 */
export function isMetaConfigured(): boolean {
  return !!(
    process.env.META_SYSTEM_USER_TOKEN
    && (process.env.META_FACEBOOK_PAGE_ID || process.env.META_INSTAGRAM_ACCOUNT_ID)
  );
}
