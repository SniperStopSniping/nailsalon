export type AssetStorageErrorCode =
  | 'blocked'
  | 'closed'
  | 'invalid_asset'
  | 'not_found'
  | 'not_staged'
  | 'quota_exceeded'
  | 'security'
  | 'transaction_failed'
  | 'unavailable'
  | 'unknown';

export class AssetStorageError extends Error {
  readonly code: AssetStorageErrorCode;
  readonly cause?: unknown;

  constructor(code: AssetStorageErrorCode, message: string, cause?: unknown) {
    super(message);
    this.name = 'AssetStorageError';
    this.code = code;
    this.cause = cause;
  }
}

export const toAssetStorageError = (
  error: unknown,
  fallbackMessage: string,
): AssetStorageError => {
  if (error instanceof AssetStorageError) {
    return error;
  }

  if (error instanceof DOMException) {
    if (error.name === 'ConstraintError' || error.name === 'DataError') {
      return new AssetStorageError(
        'invalid_asset',
        'An image with this asset ID already exists or is invalid.',
        error,
      );
    }

    if (error.name === 'QuotaExceededError') {
      return new AssetStorageError(
        'quota_exceeded',
        'This browser does not have enough storage for the design image.',
        error,
      );
    }

    if (error.name === 'SecurityError' || error.name === 'NotAllowedError') {
      return new AssetStorageError(
        'security',
        'Browser storage is unavailable or has been denied.',
        error,
      );
    }
  }

  return new AssetStorageError('unknown', fallbackMessage, error);
};
