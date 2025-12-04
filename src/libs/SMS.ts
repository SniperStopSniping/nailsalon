/**
 * SMS Notification Module (Stub)
 *
 * This module provides placeholder functions for SMS notifications.
 * In production, these will integrate with Twilio or another SMS provider.
 *
 * For now, they log to console and return resolved promises.
 */

// =============================================================================
// TYPES
// =============================================================================

export interface BookingConfirmationParams {
  phone: string;
  clientName?: string;
  appointmentId: string;
  salonName: string;
  services: string[];
  technicianName: string;
  startTime: string;
  totalPrice: number;
}

export interface TechNotificationParams {
  technicianId: string;
  technicianName: string;
  appointmentId: string;
  clientName: string;
  clientPhone: string;
  services: string[];
  startTime: string;
  totalDurationMinutes: number;
}

export interface ReminderParams {
  phone: string;
  clientName?: string;
  appointmentId: string;
  salonName: string;
  startTime: string;
  hoursUntil: number;
}

// =============================================================================
// STUB FUNCTIONS
// =============================================================================

/**
 * Send booking confirmation SMS to the client
 *
 * In production, this will:
 * 1. Format a friendly message with appointment details
 * 2. Send via Twilio to the client's phone
 * 3. Log the message in the database for tracking
 *
 * @param params - Booking details for the confirmation message
 */
export async function sendBookingConfirmationToClient(
  params: BookingConfirmationParams,
): Promise<void> {
  const { phone, clientName, appointmentId, salonName, services, technicianName, startTime, totalPrice } = params;

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

  const message = `
[SMS STUB] Booking Confirmation to Client
----------------------------------------
To: +1${phone}
From: ${salonName}

Hi ${clientName || 'there'}! 💅

Your appointment is confirmed:

📅 ${formattedDate}
⏰ ${formattedTime}
💇 ${services.join(' + ')}
👩‍🎨 ${technicianName}
💰 $${(totalPrice / 100).toFixed(0)}

Appointment ID: ${appointmentId}

We can't wait to see you! ✨
Reply HELP for assistance or STOP to unsubscribe.
----------------------------------------
  `.trim();

  console.log(message);
}

/**
 * Send notification SMS to the technician about a new booking
 *
 * In production, this will:
 * 1. Look up the technician's phone number
 * 2. Send via Twilio to the tech's phone
 * 3. Log the notification in the database
 *
 * @param params - Booking details for the tech notification
 */
export async function sendBookingNotificationToTech(
  params: TechNotificationParams,
): Promise<void> {
  const { technicianId, technicianName, appointmentId, clientName, clientPhone, services, startTime, totalDurationMinutes } = params;

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

  const message = `
[SMS STUB] New Booking Notification to Tech
-------------------------------------------
To: ${technicianName} (${technicianId})

📱 New Booking Alert!

Client: ${clientName}
Phone: +1${clientPhone}
Date: ${formattedDate} at ${formattedTime}
Services: ${services.join(', ')}
Duration: ${totalDurationMinutes} min

Appointment ID: ${appointmentId}
-------------------------------------------
  `.trim();

  console.log(message);
}

/**
 * Send appointment reminder SMS to the client
 *
 * In production, this will be called by a cron job:
 * - 24 hours before appointment
 * - 3 hours before appointment
 *
 * @param params - Reminder details
 */
export async function sendAppointmentReminder(
  params: ReminderParams,
): Promise<void> {
  const { phone, clientName, appointmentId, salonName, startTime, hoursUntil } = params;

  const date = new Date(startTime);
  const formattedTime = date.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });

  const timeUntilText = hoursUntil >= 24
    ? 'tomorrow'
    : `in ${hoursUntil} hours`;

  const message = `
[SMS STUB] Appointment Reminder
-------------------------------
To: +1${phone}

Hi ${clientName || 'there'}! 👋

Reminder: Your appointment at ${salonName} is ${timeUntilText} at ${formattedTime}.

Appointment ID: ${appointmentId}

Need to reschedule? Reply CHANGE or call us.
-------------------------------
  `.trim();

  console.log(message);
}

/**
 * Send cancellation confirmation to client
 *
 * @param params - Cancellation details
 */
export async function sendCancellationConfirmation(params: {
  phone: string;
  clientName?: string;
  appointmentId: string;
  salonName: string;
}): Promise<void> {
  const { phone, clientName, appointmentId, salonName } = params;

  const message = `
[SMS STUB] Cancellation Confirmation
------------------------------------
To: +1${phone}

Hi ${clientName || 'there'},

Your appointment at ${salonName} has been cancelled.

Appointment ID: ${appointmentId}

We hope to see you again soon! 💅
Book anytime at our website.
------------------------------------
  `.trim();

  console.log(message);
}

