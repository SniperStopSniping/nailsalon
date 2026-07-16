import 'server-only';

import { and, desc, eq, inArray, sql } from 'drizzle-orm';

import { db } from '@/libs/DB';
import {
  integrationOutboxSchema,
  notificationDeliverySchema,
  salonGoogleCalendarConnectionSchema,
  salonTwilioConnectionSchema,
} from '@/models/Schema';

export async function getSalonIntegrationHealth(salonId: string) {
  const [[google], [twilio], [latestSmsFailure], [pending], [failed]] = await Promise.all([
    db
      .select({
        status: salonGoogleCalendarConnectionSchema.status,
        email: salonGoogleCalendarConnectionSchema.googleEmail,
        lastError: salonGoogleCalendarConnectionSchema.lastError,
        inboundSyncEnabled: salonGoogleCalendarConnectionSchema.inboundSyncEnabled,
        inboundSyncedAt: salonGoogleCalendarConnectionSchema.inboundSyncedAt,
        inboundSyncError: salonGoogleCalendarConnectionSchema.inboundSyncError,
      })
      .from(salonGoogleCalendarConnectionSchema)
      .where(eq(salonGoogleCalendarConnectionSchema.salonId, salonId))
      .limit(1),
    db
      .select({
        status: salonTwilioConnectionSchema.status,
        phoneNumber: salonTwilioConnectionSchema.phoneNumber,
        deauthorizedAt: salonTwilioConnectionSchema.deauthorizedAt,
        lastError: salonTwilioConnectionSchema.lastError,
      })
      .from(salonTwilioConnectionSchema)
      .where(eq(salonTwilioConnectionSchema.salonId, salonId))
      .limit(1),
    db
      .select({
        errorCode: notificationDeliverySchema.errorCode,
        errorMessage: notificationDeliverySchema.errorMessage,
        createdAt: notificationDeliverySchema.createdAt,
      })
      .from(notificationDeliverySchema)
      .where(
        and(
          eq(notificationDeliverySchema.salonId, salonId),
          eq(notificationDeliverySchema.channel, 'sms'),
          eq(notificationDeliverySchema.status, 'failed'),
        ),
      )
      .orderBy(desc(notificationDeliverySchema.createdAt))
      .limit(1),
    db
      .select({ count: sql<number>`count(*)` })
      .from(integrationOutboxSchema)
      .where(
        and(
          eq(integrationOutboxSchema.salonId, salonId),
          eq(integrationOutboxSchema.provider, 'google_calendar'),
          inArray(integrationOutboxSchema.status, ['pending', 'retry']),
        ),
      ),
    db
      .select({ count: sql<number>`count(*)` })
      .from(integrationOutboxSchema)
      .where(
        and(
          eq(integrationOutboxSchema.salonId, salonId),
          eq(integrationOutboxSchema.provider, 'google_calendar'),
          eq(integrationOutboxSchema.status, 'failed'),
        ),
      ),
  ]);

  return {
    availability: {
      google: Boolean(
        process.env.GOOGLE_OAUTH_CLIENT_ID
        && process.env.GOOGLE_OAUTH_CLIENT_SECRET
        && process.env.GOOGLE_OAUTH_REDIRECT_URI
        && process.env.INTEGRATION_ENCRYPTION_KEY
        && process.env.OAUTH_STATE_SECRET,
      ),
      twilio: Boolean(
        process.env.TWILIO_CONNECT_APP_SID
        && process.env.TWILIO_CONNECT_REDIRECT_URI
        && process.env.TWILIO_AUTH_TOKEN,
      ),
      email: Boolean(process.env.RESEND_API_KEY && process.env.RESEND_FROM_EMAIL),
      photos: Boolean(
        process.env.CLOUDINARY_CLOUD_NAME
        && process.env.CLOUDINARY_API_KEY
        && process.env.CLOUDINARY_API_SECRET,
      ),
    },
    google: google
      ? {
          status: google.status,
          email: google.email,
          lastError: google.lastError,
          inboundSyncEnabled: google.inboundSyncEnabled,
          inboundSyncedAt: google.inboundSyncedAt,
          inboundSyncError: google.inboundSyncError,
          reconnectRequired: google.status === 'reconnect_required',
        }
      : {
          status: 'disconnected',
          email: null,
          lastError: null,
          inboundSyncEnabled: false,
          inboundSyncedAt: null,
          inboundSyncError: null,
          reconnectRequired: false,
        },
    twilio: twilio
      ? {
          status: twilio.status,
          phoneNumber: twilio.phoneNumber,
          lastError: twilio.lastError,
          deauthorized: Boolean(twilio.deauthorizedAt) || twilio.status === 'deauthorized',
        }
      : {
          status: 'disconnected',
          phoneNumber: null,
          lastError: null,
          deauthorized: false,
        },
    latestSmsDeliveryError: latestSmsFailure ?? null,
    calendarOutbox: {
      pending: Number(pending?.count ?? 0),
      failed: Number(failed?.count ?? 0),
    },
  };
}
