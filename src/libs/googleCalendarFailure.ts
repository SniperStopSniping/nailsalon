/**
 * Google Calendar failure classification.
 *
 * Before this existed, every failure collapsed into one of two statuses and the
 * precise reason was overwritten by a generic string, so an operator looking at
 * a dead connection could not tell "the refresh token was revoked" from "Google
 * was briefly unreachable". Worse, both latched the salon off bookings the same
 * way. This module names the failure exactly once, and everything downstream —
 * whether to retry, whether to latch, whether to email the owner — reads that
 * single classification.
 */

/** Machine-readable failure kinds, most specific first. */
export type GoogleFailureKind =
  /** The stored refresh token could not be decrypted (key rotated or corrupt). */
  | 'token_decrypt_failed'
  /** Google rejected the refresh token outright: expired, revoked, or reissued. */
  | 'invalid_grant'
  /** The user or Google removed our authorization. */
  | 'access_revoked'
  /** A Calendar API call returned 401 — the access token is not accepted. */
  | 'api_unauthorized'
  /** Our own OAuth client id/secret are missing or rejected. */
  | 'client_misconfigured'
  /** Network error, timeout, 5xx or rate limit — expected to pass. */
  | 'temporary';

export type GoogleFailureClassification = {
  kind: GoogleFailureKind;
  /** Whether the salon must re-authorize before Calendar can work again. */
  requiresReconnect: boolean;
  /** Whether a single immediate retry is reasonable. */
  retryable: boolean;
  /** Stable operator-facing text, safe to persist and display. Never a token. */
  message: string;
};

const NON_RETRYABLE: Record<Exclude<GoogleFailureKind, 'temporary'>, { requiresReconnect: boolean; message: string }> = {
  token_decrypt_failed: {
    // Deliberately NOT a reconnect prompt: re-authorizing writes a fresh token
    // with the current key and would mask a key-management problem affecting
    // every stored secret, not just this one.
    requiresReconnect: false,
    message: 'Stored Google credentials could not be read. This usually means the integration encryption key changed; check key configuration before reconnecting.',
  },
  invalid_grant: {
    requiresReconnect: true,
    message: 'Google rejected the saved authorization (invalid_grant). This happens when the token is expired, revoked, or superseded — the salon must reconnect Google Calendar.',
  },
  access_revoked: {
    requiresReconnect: true,
    message: 'Access to Google Calendar was revoked. The salon must reconnect Google Calendar.',
  },
  api_unauthorized: {
    requiresReconnect: true,
    message: 'Google Calendar refused the request as unauthorized (401). The salon must reconnect Google Calendar.',
  },
  client_misconfigured: {
    requiresReconnect: false,
    message: 'The Google OAuth client is not configured correctly on the server. Reconnecting will not help until the configuration is fixed.',
  },
};

function build(kind: GoogleFailureKind, detail?: string): GoogleFailureClassification {
  if (kind === 'temporary') {
    return {
      kind,
      requiresReconnect: false,
      retryable: true,
      message: detail
        ? `Google Calendar was temporarily unavailable: ${detail}`
        : 'Google Calendar was temporarily unavailable.',
    };
  }
  const entry = NON_RETRYABLE[kind];
  return {
    kind,
    requiresReconnect: entry.requiresReconnect,
    // A confirmed credential rejection is never retried: repeating the same
    // refresh request cannot change the answer and only burns quota.
    retryable: false,
    message: detail ? `${entry.message} (${detail})` : entry.message,
  };
}

/**
 * Classify a failed OAuth token-refresh response.
 *
 * `error` / `errorDescription` come straight from Google's token endpoint.
 */
export function classifyTokenRefreshFailure(args: {
  httpStatus: number;
  error?: string | null;
  errorDescription?: string | null;
}): GoogleFailureClassification {
  const error = args.error?.trim().toLowerCase() ?? '';
  const detail = args.errorDescription?.trim() || args.error?.trim() || undefined;

  if (error === 'invalid_grant') {
    // Google reuses invalid_grant for "expired or revoked"; the description is
    // the only thing that separates them, and it is worth keeping distinct
    // because a revocation is a deliberate human act.
    if (/revok/i.test(args.errorDescription ?? '')) {
      return build('access_revoked', detail);
    }
    return build('invalid_grant', detail);
  }
  if (error === 'invalid_client' || error === 'unauthorized_client') {
    return build('client_misconfigured', detail);
  }
  if (args.httpStatus === 429 || args.httpStatus >= 500) {
    return build('temporary', detail ?? `HTTP ${args.httpStatus}`);
  }
  if (args.httpStatus === 401 || args.httpStatus === 403) {
    return build('api_unauthorized', detail);
  }
  // An unrecognized 4xx is not something a retry fixes, but it is also not
  // proof the grant is dead — treat it as needing a reconnect only if Google
  // said so. Anything else is temporary so we never latch on a surprise.
  return build('temporary', detail ?? `HTTP ${args.httpStatus}`);
}

/** Classify a failure from a Calendar API call (not the token endpoint). */
export function classifyApiFailure(httpStatus: number, detail?: string): GoogleFailureClassification {
  if (httpStatus === 401) {
    return build('api_unauthorized', detail);
  }
  if (httpStatus === 429 || httpStatus >= 500) {
    return build('temporary', detail ?? `HTTP ${httpStatus}`);
  }
  if (httpStatus === 403) {
    // 403 is overloaded: quota exhaustion (temporary) vs a genuine permission
    // loss. Google's payload names rate limiting explicitly.
    if (/rate|quota|limit/i.test(detail ?? '')) {
      return build('temporary', detail);
    }
    return build('api_unauthorized', detail);
  }
  return build('temporary', detail ?? `HTTP ${httpStatus}`);
}

export function classifyDecryptFailure(): GoogleFailureClassification {
  return build('token_decrypt_failed');
}

export function classifyNetworkFailure(detail?: string): GoogleFailureClassification {
  return build('temporary', detail ?? 'network error');
}

export function classifyMissingClientConfig(): GoogleFailureClassification {
  return build('client_misconfigured');
}

/**
 * The connection status a classification implies. `degraded` keeps the salon
 * connected and self-healing; `reconnect_required` is the latched state that
 * demands a human, so only a confirmed credential rejection may set it.
 */
export function statusForClassification(
  classification: GoogleFailureClassification,
): 'degraded' | 'reconnect_required' {
  return classification.requiresReconnect ? 'reconnect_required' : 'degraded';
}

/** Persisted form: a stable code an operator can grep, plus the human text. */
export function formatPersistedError(classification: GoogleFailureClassification): string {
  return `[${classification.kind}] ${classification.message}`;
}
