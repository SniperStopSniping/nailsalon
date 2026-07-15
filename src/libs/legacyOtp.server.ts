import 'server-only';

import { NextResponse } from 'next/server';

import { isLegacyOtpAuthEnabled } from './authConfig.server';

export function rejectDisabledLegacyOtp(): NextResponse | null {
  if (isLegacyOtpAuthEnabled()) {
    return null;
  }

  return NextResponse.json(
    { error: 'LEGACY_OTP_DISABLED' },
    { status: 410 },
  );
}
