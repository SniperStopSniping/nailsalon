export function getApiErrorMessage(
  data: unknown,
  fallback: string,
): string {
  if (typeof data === 'object' && data !== null) {
    const error = 'error' in data ? (data as { error?: unknown }).error : undefined;
    const message = 'message' in data ? (data as { message?: unknown }).message : undefined;

    if (typeof error === 'string' && error.trim()) {
      return error;
    }

    if (typeof error === 'object' && error !== null && 'message' in error) {
      const nestedMessage = (error as { message?: unknown }).message;
      if (typeof nestedMessage === 'string' && nestedMessage.trim()) {
        return nestedMessage;
      }
    }

    if (typeof message === 'string' && message.trim()) {
      return message;
    }
  }

  return fallback;
}
