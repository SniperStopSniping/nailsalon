function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' ? value as Record<string, unknown> : {};
}

function booleanOrNull(value: unknown) {
  return typeof value === 'boolean' ? value : null;
}

// Clerk payloads contain identities and tokens. Keep only the exact booleans
// needed to diagnose client piggybacking; never retain raw provider responses.
export function clerkResponseShape(payload: unknown) {
  const body = record(payload);
  const errors = Array.isArray(body.errors) ? body.errors : [];
  return {
    clientCaptchaBypass: booleanOrNull(record(body.client).captcha_bypass),
    identifierNotFound: errors.some(error => record(error).code === 'form_identifier_not_found'),
    metaClientCaptchaBypass: booleanOrNull(record(record(body.meta).client).captcha_bypass),
    responseCaptchaBypass: booleanOrNull(record(body.response).captcha_bypass),
  };
}
