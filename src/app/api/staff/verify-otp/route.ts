/**
 * Staff Verify OTP API Route
 *
 * Verifies the OTP code entered by the staff member using Twilio Verify,
 * then creates a staff session via cookies.
 *
 * POST /api/staff/verify-otp
 * Body: { phone: string, code: string, salonSlug: string }
 */

import { Buffer } from 'node:buffer';

import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

import { getSalonBySlug, getTechnicianByPhone } from '@/libs/queries';

// =============================================================================
// TYPES
// =============================================================================

type VerifyOtpRequest = {
  phone: string;
  code: string;
  salonSlug: string;
};

type TwilioVerifyCheckResponse = {
  sid: string;
  status: 'pending' | 'approved' | 'canceled';
  to: string;
  channel: string;
  valid: boolean;
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

/**
 * Generate a simple session token
 */
function generateSessionToken(phone: string, salonSlug: string): string {
  const timestamp = Date.now();
  const data = `staff:${phone}:${salonSlug}:${timestamp}`;
  return Buffer.from(data).toString('base64');
}

// =============================================================================
// ROUTE HANDLER
// =============================================================================

export async function POST(request: Request) {
  try {
    // Parse request body
    const body = (await request.json()) as VerifyOtpRequest;
    const { phone, code, salonSlug } = body;

    // Validate inputs
    if (!phone || !code || !salonSlug) {
      return NextResponse.json(
        { error: 'Phone, code, and salon are required' },
        { status: 400 },
      );
    }

    if (code.length !== 6 || !/^\d+$/.test(code)) {
      return NextResponse.json(
        { error: 'Invalid verification code format' },
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

    // Verify technician exists
    const technician = await getTechnicianByPhone(phone, salon.id);
    if (!technician) {
      return NextResponse.json(
        { error: 'No technician account found for this phone number.' },
        { status: 404 },
      );
    }

    const formattedPhone = formatPhoneE164(phone);

    // ==========================================================================
    // DEVELOPMENT MODE: Accept "123456" as valid code
    // ==========================================================================
    if (!isTwilioConfigured) {
      if (code === '123456') {
        console.warn(`[DEV MODE] Staff OTP verified for ${formattedPhone}`);

        // Set session cookies
        const sessionToken = generateSessionToken(formattedPhone, salonSlug);
        const cookieStore = await cookies();

        // Staff session token (HttpOnly for security)
        cookieStore.set('staff_session', sessionToken, {
          httpOnly: true,
          secure: process.env.NODE_ENV === 'production',
          sameSite: 'lax',
          maxAge: 60 * 60 * 24 * 365, // 1 year
          path: '/',
        });

        // Staff phone (readable by client for display)
        cookieStore.set('staff_phone', formattedPhone, {
          httpOnly: false,
          secure: process.env.NODE_ENV === 'production',
          sameSite: 'lax',
          maxAge: 60 * 60 * 24 * 365, // 1 year
          path: '/',
        });

        // Staff name (for display)
        cookieStore.set('staff_name', technician.name, {
          httpOnly: false,
          secure: process.env.NODE_ENV === 'production',
          sameSite: 'lax',
          maxAge: 60 * 60 * 24 * 365, // 1 year
          path: '/',
        });

        // Salon slug (for API calls)
        cookieStore.set('staff_salon', salonSlug, {
          httpOnly: false,
          secure: process.env.NODE_ENV === 'production',
          sameSite: 'lax',
          maxAge: 60 * 60 * 24 * 365, // 1 year
          path: '/',
        });

        return NextResponse.json({
          success: true,
          message: 'Verification successful (dev mode)',
          phone: formattedPhone,
          technicianName: technician.name,
          technicianId: technician.id,
          salonSlug,
          devMode: true,
        });
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
      console.warn(`Staff OTP verification failed for ${formattedPhone}:`, data);

      return NextResponse.json(
        { error: 'Invalid verification code' },
        { status: 401 },
      );
    }

    console.warn(`Staff OTP verified for ${formattedPhone}, SID: ${data.sid}`);

    // Set session cookies
    const sessionToken = generateSessionToken(formattedPhone, salonSlug);
    const cookieStore = await cookies();

    // Staff session token (HttpOnly for security)
    cookieStore.set('staff_session', sessionToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 60 * 60 * 24 * 365, // 1 year
      path: '/',
    });

    // Staff phone (readable by client for display)
    cookieStore.set('staff_phone', formattedPhone, {
      httpOnly: false,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 60 * 60 * 24 * 365, // 1 year
      path: '/',
    });

    // Staff name (for display)
    cookieStore.set('staff_name', technician.name, {
      httpOnly: false,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 60 * 60 * 24 * 365, // 1 year
      path: '/',
    });

    // Salon slug (for API calls)
    cookieStore.set('staff_salon', salonSlug, {
      httpOnly: false,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 60 * 60 * 24 * 365, // 1 year
      path: '/',
    });

    return NextResponse.json({
      success: true,
      message: 'Verification successful',
      phone: formattedPhone,
      technicianName: technician.name,
      technicianId: technician.id,
      salonSlug,
    });
  } catch (error) {
    console.error('Staff verify OTP error:', error);

    return NextResponse.json(
      { error: 'An unexpected error occurred' },
      { status: 500 },
    );
  }
}
