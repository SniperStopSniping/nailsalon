/**
 * SMS Notification Module
 *
 * Sends SMS notifications via Twilio for:
 * - Booking confirmations to clients
 * - New booking notifications to technicians
 * - Appointment reminders
 * - Cancellation confirmations
 *
 * Falls back to console logging in dev mode if Twilio is not configured.
 * All SMS functions check the salon's smsRemindersEnabled toggle before sending.
 */

import twilio from 'twilio';

import { Env } from '@/libs/Env';
import { isSmsEnabled } from '@/libs/salonStatus';

// =============================================================================
// TYPES
// =============================================================================

export type BookingConfirmationParams = {
  phone: string;
  clientName?: string;
  appointmentId: string;
  salonName: string;
  services: string[];
  technicianName: string;
  startTime: string;
  totalPrice: number;
};

export type TechNotificationParams = {
  technicianId: string;
  technicianName: string;
  appointmentId: string;
  clientName: string;
  clientPhone: string;
  services: string[];
  startTime: string;
  totalDurationMinutes: number;
};

export type ReminderParams = {
  phone: string;
  clientName?: string;
  appointmentId: string;
  salonName: string;
  startTime: string;
  hoursUntil: number;
};

export type ReferralInviteParams = {
  refereePhone: string;
  referrerName: string;
  salonName: string;
  referralId: string;
};

// =============================================================================
// TWILIO CLIENT
// =============================================================================

function getTwilioClient() {
  if (!Env.TWILIO_ACCOUNT_SID || !Env.TWILIO_AUTH_TOKEN || !Env.TWILIO_PHONE_NUMBER) {
    return null;
  }
  return twilio(Env.TWILIO_ACCOUNT_SID, Env.TWILIO_AUTH_TOKEN);
}

/**
 * Send an SMS message via Twilio
 * Falls back to console logging if Twilio is not configured
 */
async function sendSMS(to: string, body: string): Promise<boolean> {
  const client = getTwilioClient();

  if (!client) {
    console.log('[SMS DEV MODE] Would send to:', to);
    console.log('[SMS DEV MODE] Message:', body);
    console.log('---');
    return false;
  }

  try {
    const message = await client.messages.create({
      body,
      from: Env.TWILIO_PHONE_NUMBER,
      to: `+1${to}`,
    });
    console.log('SMS sent successfully:', message.sid);
    return true;
  } catch (error) {
    console.error('Failed to send SMS:', error);
    // Don't throw - we don't want SMS failures to break bookings
    return false;
  }
}

// =============================================================================
// SMS FUNCTIONS
// =============================================================================

/**
 * Send booking confirmation SMS to the client
 */
export async function sendBookingConfirmationToClient(
  salonId: string,
  params: BookingConfirmationParams,
): Promise<void> {
  // Check if SMS is enabled for this salon
  if (!await isSmsEnabled(salonId)) {
    console.log('[SMS DISABLED] SMS reminders not enabled for salon:', salonId);
    return;
  }

  const { phone, clientName, salonName, services, technicianName, startTime, totalPrice } = params;

  // Format date for display
  const date = new Date(startTime);
  const formattedDate = date.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });
  const formattedTime = date.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });

  const message = `💅 ${salonName}

Hi ${clientName || 'there'}! Your appointment is confirmed:

📅 ${formattedDate}
⏰ ${formattedTime}
💇 ${services.join(' + ')}
👩‍🎨 ${technicianName}
💰 $${(totalPrice / 100).toFixed(0)}

We can't wait to see you! ✨`;

  await sendSMS(phone, message);
}

/**
 * Send notification SMS to the technician about a new booking
 */
export async function sendBookingNotificationToTech(
  salonId: string,
  params: TechNotificationParams,
): Promise<void> {
  // Check if SMS is enabled for this salon
  if (!await isSmsEnabled(salonId)) {
    console.log('[SMS DISABLED] SMS reminders not enabled for salon:', salonId);
    return;
  }

  const { technicianName, clientName, clientPhone, services, startTime, totalDurationMinutes } = params;

  // Format date for display
  const date = new Date(startTime);
  const formattedDate = date.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
  const formattedTime = date.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });

  // Note: In production, you'd look up the tech's phone number from the database
  // For now, we just log - tech notification would need their phone stored
  const message = `📱 New Booking!

${technicianName}, you have a new appointment:

👤 ${clientName}
📞 ${clientPhone}
📅 ${formattedDate} at ${formattedTime}
💇 ${services.join(', ')}
⏱️ ${totalDurationMinutes} min`;

  // TODO: Look up technician's phone number from database
  // await sendSMS(techPhone, message);
  console.log('[TECH NOTIFICATION]', message);
}

/**
 * Send appointment reminder SMS to the client
 */
export async function sendAppointmentReminder(
  salonId: string,
  params: ReminderParams,
): Promise<void> {
  // Check if SMS is enabled for this salon
  if (!await isSmsEnabled(salonId)) {
    console.log('[SMS DISABLED] SMS reminders not enabled for salon:', salonId);
    return;
  }

  const { phone, clientName, salonName, startTime, hoursUntil } = params;

  const date = new Date(startTime);
  const formattedTime = date.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });

  const timeUntilText = hoursUntil >= 24
    ? 'tomorrow'
    : `in ${hoursUntil} hours`;

  const message = `👋 Hi ${clientName || 'there'}!

Reminder: Your appointment at ${salonName} is ${timeUntilText} at ${formattedTime}.

Need to reschedule? Reply or call us!`;

  await sendSMS(phone, message);
}

/**
 * Send cancellation confirmation to client
 */
export async function sendCancellationConfirmation(
  salonId: string,
  params: {
    phone: string;
    clientName?: string;
    appointmentId: string;
    salonName: string;
  },
): Promise<void> {
  // Check if SMS is enabled for this salon
  if (!await isSmsEnabled(salonId)) {
    console.log('[SMS DISABLED] SMS reminders not enabled for salon:', salonId);
    return;
  }

  const { phone, clientName, salonName } = params;

  const message = `Hi ${clientName || 'there'},

Your appointment at ${salonName} has been cancelled.

We hope to see you again soon! 💅
Book anytime at our website.`;

  await sendSMS(phone, message);
}

/**
 * Send reschedule confirmation SMS to the client
 */
export async function sendRescheduleConfirmation(
  salonId: string,
  params: {
    phone: string;
    clientName?: string;
    salonName: string;
    oldStartTime: string;
    newStartTime: string;
    services: string[];
    technicianName: string;
  },
): Promise<void> {
  // Check if SMS is enabled for this salon
  if (!await isSmsEnabled(salonId)) {
    console.log('[SMS DISABLED] SMS reminders not enabled for salon:', salonId);
    return;
  }

  const { phone, clientName, salonName, oldStartTime, newStartTime, services, technicianName } = params;

  // Format old date/time
  const oldDate = new Date(oldStartTime);
  const oldFormattedDate = oldDate.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
  const oldFormattedTime = oldDate.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });

  // Format new date/time
  const newDate = new Date(newStartTime);
  const newFormattedDate = newDate.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });
  const newFormattedTime = newDate.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });

  const message = `💅 ${salonName}

Hi ${clientName || 'there'}! Your appointment has been rescheduled:

❌ Old: ${oldFormattedDate} at ${oldFormattedTime}
✅ New: ${newFormattedDate} at ${newFormattedTime}

💇 ${services.join(' + ')}
👩‍🎨 ${technicianName}

See you soon! ✨`;

  await sendSMS(phone, message);
}

/**
 * Send cancellation/reschedule notification to the technician
 */
export async function sendCancellationNotificationToTech(
  salonId: string,
  params: {
    technicianName: string;
    technicianPhone?: string;
    clientName: string;
    startTime: string;
    services: string[];
    cancelReason: 'cancelled' | 'rescheduled';
  },
): Promise<void> {
  // Check if SMS is enabled for this salon
  if (!await isSmsEnabled(salonId)) {
    console.log('[SMS DISABLED] SMS reminders not enabled for salon:', salonId);
    return;
  }

  const { technicianName, technicianPhone, clientName, startTime, services, cancelReason } = params;

  // Format date for display
  const date = new Date(startTime);
  const formattedDate = date.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
  const formattedTime = date.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });

  const actionText = cancelReason === 'rescheduled' ? 'rescheduled' : 'cancelled';
  const emoji = cancelReason === 'rescheduled' ? '📅' : '❌';

  const message = `${emoji} Appointment ${actionText}

${technicianName}, an appointment has been ${actionText}:

👤 ${clientName}
📅 ${formattedDate} at ${formattedTime}
💇 ${services.join(', ')}`;

  // Log for now - in production, send if technicianPhone is available
  if (technicianPhone) {
    await sendSMS(technicianPhone, message);
  } else {
    console.log('[TECH NOTIFICATION]', message);
  }
}

/**
 * Send referral invite SMS to a friend
 */
export async function sendReferralInvite(
  salonId: string,
  params: ReferralInviteParams,
): Promise<boolean> {
  // Check if SMS is enabled for this salon
  if (!await isSmsEnabled(salonId)) {
    console.log('[SMS DISABLED] SMS reminders not enabled for salon:', salonId);
    return false;
  }

  const { refereePhone, referrerName, salonName, referralId } = params;

  // Build the claim URL
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL
    || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : null)
    || 'http://localhost:3000';
  const claimUrl = `${baseUrl}/referral/${referralId}`;

  const message = `🎉 ${referrerName} sent you a FREE manicure at ${salonName}!

Claim your gift here:
${claimUrl}

Book within 14 days to get your free manicure! 💅✨`;

  return sendSMS(refereePhone, message);
}
