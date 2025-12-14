/**
 * Staff Send OTP API Route
 *
 * Validates that a technician exists for the given phone + salon,
 * then sends a verification code via Twilio Verify.
 *
 * POST /api/staff/send-otp
 * Body: { phone: string, salonSlug: string }
 */

import { Buffer } from 'node:buffer';

import { NextResponse } from 'next/server';

import { getSalonBySlug, getTechnicianByPhone } from '@/libs/queries';

// =============================================================================
// TYPES
// =============================================================================

type SendOtpRequest = {
  phone: string;
  salonSlug: string;
};

type TwilioVerifyResponse = {
  sid: string;
  status: 'pending' | 'approved' | 'canceled';
  to: string;
  channel: string;
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
 * Assumes US phone numbers (+1)
 */
function formatPhoneE164(phone: string): string {
  // Remove all non-digits
  const digits = phone.replace(/\D/g, '');

  // If already has country code (11 digits starting with 1)
  if (digits.length === 11 && digits.startsWith('1')) {
    return `+${digits}`;
  }

  // Assume US number (10 digits)
  if (digits.length === 10) {
    return `+1${digits}`;
  }

  throw new Error('Invalid phone number format');
}

/**
 * Validate phone number (10 digits for US)
 */
function validatePhone(phone: string): boolean {
  const digits = phone.replace(/\D/g, '');
  return digits.length === 10 || (digits.length === 11 && digits.startsWith('1'));
}

// =============================================================================
// ROUTE HANDLER
// =============================================================================

export async function POST(request: Request) {
  try {
    // Parse request body
    const body = (await request.json()) as SendOtpRequest;
    const { phone, salonSlug } = body;

    // Validate inputs
    if (!phone) {
      return NextResponse.json(
        { error: 'Phone number is required' },
        { status: 400 },
      );
    }

    if (!salonSlug) {
      return NextResponse.json(
        { error: 'Salon is required' },
        { status: 400 },
      );
    }

    if (!validatePhone(phone)) {
      return NextResponse.json(
        { error: 'Invalid phone number format. Please enter a 10-digit US number.' },
        { status: 400 },
      );
    }

    // Get salon
    const salon = await getSalonBySlug(salonSlug);
    if (!salon) {
      return NextResponse.json(
        { error: 'Salon not found' },
        { status: 404 },
      );
    }

    // Check if a technician exists with this phone at this salon
    const technician = await getTechnicianByPhone(phone, salon.id);
    if (!technician) {
      return NextResponse.json(
        { error: 'No technician account found for this phone number. Please contact your salon owner.' },
        { status: 404 },
      );
    }

    const formattedPhone = formatPhoneE164(phone);

    // ==========================================================================
    // DEVELOPMENT MODE: Skip Twilio, auto-approve
    // ==========================================================================
    if (!isTwilioConfigured) {
      console.warn(`[DEV MODE] Staff OTP would be sent to ${formattedPhone}`);
      console.warn('[DEV MODE] Use code "123456" to verify');
      console.warn(`[DEV MODE] Technician: ${technician.name} (${technician.id})`);

      return NextResponse.json({
        success: true,
        message: 'Verification code sent (dev mode)',
        technicianName: technician.name,
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
        To: formattedPhone,
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

    const data = (await response.json()) as TwilioVerifyResponse;
    console.warn(`Staff OTP sent to ${formattedPhone}, SID: ${data.sid}`);

    return NextResponse.json({
      success: true,
      message: 'Verification code sent',
      technicianName: technician.name,
    });
  } catch (error) {
    console.error('Staff send OTP error:', error);

    return NextResponse.json(
      { error: 'An unexpected error occurred' },
      { status: 500 },
    );
  }
}
