/**
 * Admin Send OTP API Route
 *
 * Sends OTP for admin login with invite/user gating.
 * Only sends OTP if phone:
 * - Belongs to existing admin
 * - Has valid (unused, unexpired) invite
 * - Is bootstrap phone AND no super admins exist
 *
 * Always returns success to prevent phone enumeration.
 */

import { Buffer } from 'node:buffer';

import { NextResponse } from 'next/server';

import {
  canReceiveAdminOtp,
  formatPhoneE164,
  isValidPhone,
} from '@/libs/adminAuth';
import { checkOtpRateLimit, getClientIp } from '@/libs/rateLimit';

// =============================================================================
// ENVIRONMENT
// =============================================================================

const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID;
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN;
const TWILIO_VERIFY_SERVICE_SID = process.env.TWILIO_VERIFY_SERVICE_SID;

const isTwilioConfigured = Boolean(
  TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN && TWILIO_VERIFY_SERVICE_SID,
);

// =============================================================================
// ROUTE HANDLER
// =============================================================================

export async function POST(request: Request) {
  try {
    // Parse request body
    const body = await request.json();
    const { phone } = body;

    // Validate phone format
    if (!phone || !isValidPhone(phone)) {
      return NextResponse.json(
        { error: 'Invalid phone number format' },
        { status: 400 },
      );
    }

    const phoneE164 = formatPhoneE164(phone);
    const ip = getClientIp(request);

    // Rate limit check
    const rateLimit = checkOtpRateLimit(ip, phoneE164);
    if (!rateLimit.allowed) {
      // Don't reveal rate limit details - just return generic error
      return NextResponse.json(
        { error: 'Too many requests. Please try again later.' },
        { status: 429 },
      );
    }

    // Check if phone is allowed to receive OTP
    const canReceive = await canReceiveAdminOtp(phoneE164);

    if (!canReceive) {
      // Still return success to prevent enumeration
      // But don't actually send OTP
      console.warn(`[ADMIN OTP] Phone ${phoneE164} not authorized - returning fake success`);
      return NextResponse.json({
        success: true,
        message: 'If this phone is authorized, a code will be sent.',
      });
    }

    // ==========================================================================
    // DEVELOPMENT MODE: Skip Twilio, auto-approve
    // ==========================================================================
    if (!isTwilioConfigured) {
      console.warn(`[DEV MODE] Admin OTP would be sent to ${phoneE164}`);
      console.warn('[DEV MODE] Use code "123456" to verify');

      return NextResponse.json({
        success: true,
        message: 'Verification code sent (dev mode)',
        devMode: true,
      });
    }

    // ==========================================================================
    // PRODUCTION: Send via Twilio Verify
    // ==========================================================================

    const twilioUrl = `https://verify.twilio.com/v2/Services/${TWILIO_VERIFY_SERVICE_SID}/Verifications`;

    const response = await fetch(twilioUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': `Basic ${Buffer.from(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`).toString('base64')}`,
      },
      body: new URLSearchParams({
        To: phoneE164,
        Channel: 'sms',
      }),
    });

    if (!response.ok) {
      const errorData = await response.json();
      console.error('Twilio Verify error:', errorData);

      // Handle specific Twilio error codes
      if (errorData.code === 60200) {
        return NextResponse.json(
          { error: 'Invalid phone number' },
          { status: 400 },
        );
      }

      if (errorData.code === 60203) {
        return NextResponse.json(
          { error: 'Too many attempts. Please wait before trying again.' },
          { status: 429 },
        );
      }

      return NextResponse.json(
        { error: 'Failed to send verification code. Please try again.' },
        { status: 500 },
      );
    }

    await response.json();

    return NextResponse.json({
      success: true,
      message: 'Verification code sent',
    });
  } catch (error) {
    console.error('Admin send OTP error:', error);

    return NextResponse.json(
      { error: 'An unexpected error occurred' },
      { status: 500 },
    );
  }
}
