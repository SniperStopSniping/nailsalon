/**
 * Verify OTP API Route
 *
 * Verifies the OTP code entered by the user using Twilio Verify.
 *
 * POST /api/auth/verify-otp
 * Body: { phone: string, code: string }
 */

import { NextResponse } from 'next/server';

import {
  assertClientSessionStorageReady,
  createClientSession,
  setClientSessionCookies,
} from '@/libs/clientAuth';
import { getClientByPhone } from '@/libs/queries';

// =============================================================================
// TYPES
// =============================================================================

type VerifyOtpRequest = {
  phone: string;
  code: string;
};

type TwilioVerifyCheckResponse = {
  sid: string;
  status: 'pending' | 'approved' | 'canceled';
  to: string;
  channel: string;
  valid: boolean;
  code?: number;
  message?: string;
};

// =============================================================================
// ENVIRONMENT
// =============================================================================

const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID;
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN;
const TWILIO_VERIFY_SERVICE_SID = process.env.TWILIO_VERIFY_SERVICE_SID;

// Check if Twilio is configured
const isTwilioConfigured = Boolean(
  TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN && TWILIO_VERIFY_SERVICE_SID,
);

// =============================================================================
// HELPERS
// =============================================================================

/**
 * Format phone number to E.164 format
 */
function formatPhoneE164(phone: string): string {
  const digits = phone.replace(/\D/g, '');

  if (digits.length === 11 && digits.startsWith('1')) {
    return `+${digits}`;
  }

  if (digits.length === 10) {
    return `+1${digits}`;
  }

  throw new Error('Invalid phone number format');
}

function getClientSessionSetupErrorMessage(error: unknown): string {
  const code = typeof error === 'object' && error !== null && 'code' in error
    ? String((error as { code?: unknown }).code)
    : '';
  const message = typeof error === 'object' && error !== null && 'message' in error
    ? String((error as { message?: unknown }).message)
    : '';

  if (
    code === '42P01'
    || code === '42703'
    || message.includes('client_session')
  ) {
    return 'Verification succeeded, but customer login storage is not ready. Run the latest database migrations and try again.';
  }

  return 'Verification succeeded, but we could not create your login session. Please try again.';
}

function handleClientSessionSetupError(stage: string, error: unknown) {
  console.error(`${stage}:`, error);

  return NextResponse.json(
    { error: getClientSessionSetupErrorMessage(error) },
    { status: 500 },
  );
}

async function finalizeClientLogin(formattedPhone: string, clientName?: string | null) {
  const sessionId = await createClientSession(formattedPhone);
  await setClientSessionCookies({
    sessionId,
    phone: formattedPhone,
    clientName: clientName ?? null,
  });
}

// =============================================================================
// ROUTE HANDLER
// =============================================================================

export async function POST(request: Request) {
  try {
    // Parse request body
    const body = (await request.json()) as VerifyOtpRequest;
    const { phone, code } = body;

    // Validate inputs
    if (!phone || !code) {
      return NextResponse.json(
        { error: 'Phone and code are required' },
        { status: 400 },
      );
    }

    if (code.length !== 6 || !/^\d+$/.test(code)) {
      return NextResponse.json(
        { error: 'Invalid verification code format' },
        { status: 400 },
      );
    }

    const formattedPhone = formatPhoneE164(phone);

    try {
      await assertClientSessionStorageReady();
    } catch (error) {
      return handleClientSessionSetupError('Verify OTP session storage check failed', error);
    }

    // ==========================================================================
    // DEVELOPMENT MODE: Accept "123456" as valid code
    // ==========================================================================
    if (!isTwilioConfigured) {
      if (code === '123456') {
        console.warn(`[DEV MODE] OTP verified for ${formattedPhone}`);

        try {
          const existingClient = await getClientByPhone(formattedPhone);
          await finalizeClientLogin(formattedPhone, existingClient?.firstName);

          return NextResponse.json({
            success: true,
            message: 'Verification successful (dev mode)',
            phone: formattedPhone,
            clientName: existingClient?.firstName,
            devMode: true,
          });
        } catch (error) {
          return handleClientSessionSetupError('Verify OTP session creation failed', error);
        }
      }

      return NextResponse.json(
        { error: 'Invalid code. Use "123456" in dev mode.' },
        { status: 401 },
      );
    }

    // ==========================================================================
    // PRODUCTION: Verify via Twilio Verify
    // ==========================================================================

    const twilioUrl = `https://verify.twilio.com/v2/Services/${TWILIO_VERIFY_SERVICE_SID}/VerificationCheck`;

    const response = await fetch(twilioUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': `Basic ${Buffer.from(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`).toString('base64')}`,
      },
      body: new URLSearchParams({
        To: formattedPhone,
        Code: code,
      }),
    });

    const data = (await response.json()) as TwilioVerifyCheckResponse;

    // Check if verification was successful
    if (!response.ok || data.status !== 'approved') {
      const error =
        data.status === 'canceled'
          ? 'This verification code has expired or was already used. Please request a new code.'
          : 'This verification code is incorrect or no longer current. Please request a new code and try again.';

      console.warn(`OTP verification failed for ${formattedPhone}:`, {
        httpStatus: response.status,
        twilioStatus: data.status,
        valid: data.valid,
        code: data.code,
        message: data.message,
      });

      return NextResponse.json(
        { error },
        { status: 401 },
      );
    }

    console.warn(`OTP verified for ${formattedPhone}, SID: ${data.sid}`);

    try {
      const existingClient = await getClientByPhone(formattedPhone);
      await finalizeClientLogin(formattedPhone, existingClient?.firstName);

      return NextResponse.json({
        success: true,
        message: 'Verification successful',
        phone: formattedPhone,
        clientName: existingClient?.firstName,
      });
    } catch (error) {
      return handleClientSessionSetupError('Verify OTP session creation failed', error);
    }
  } catch (error) {
    console.error('Verify OTP error:', error);

    return NextResponse.json(
      { error: 'An unexpected error occurred' },
      { status: 500 },
    );
  }
}
