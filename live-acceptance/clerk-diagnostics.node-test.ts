import assert from 'node:assert/strict';
import { test } from 'node:test';

import { clerkResponseShape } from './clerk-diagnostics';

test('records error piggybacking without retaining provider identities or values', () => {
  assert.deepEqual(clerkResponseShape({
    client: { captcha_bypass: true, id: 'private-identity' },
    errors: [{ code: 'form_identifier_not_found', long_message: 'private-message' }],
    meta: { client: { captcha_bypass: false, token: 'private-value' } },
    response: { captcha_bypass: true, email_address: 'private-address' },
  }), {
    clientCaptchaBypass: true,
    identifierNotFound: true,
    metaClientCaptchaBypass: false,
    responseCaptchaBypass: true,
  });
});

test('handles absent or malformed provider response fields without exposing values', () => {
  for (const payload of [null, 'private-value', [], { errors: 'private-value' }, { response: { captcha_bypass: 'private-value' } }]) {
    assert.deepEqual(clerkResponseShape(payload), {
      clientCaptchaBypass: null,
      identifierNotFound: false,
      metaClientCaptchaBypass: null,
      responseCaptchaBypass: null,
    });
  }
});
