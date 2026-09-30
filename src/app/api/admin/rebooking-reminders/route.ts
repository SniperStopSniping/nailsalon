import { getAdminSession, requireAdminSalon } from '@/libs/adminAuth';
import { logAuditEvent } from '@/libs/auditLog';
import { rebookingReminderUpdateSchema } from '@/libs/rebookingReminders';
import { getRebookingReminderSettings, saveRebookingReminderSettings } from '@/libs/rebookingReminders.server';

export const dynamic = 'force-dynamic';

async function context(request: Request) {
  return requireAdminSalon(new URL(request.url).searchParams.get('salonSlug') ?? '');
}

export async function GET(request: Request): Promise<Response> {
  const { salon, error } = await context(request);
  if (error || !salon) {
    return error!;
  }
  return Response.json({ data: { settings: await getRebookingReminderSettings(salon.id) } }, { headers: { 'Cache-Control': 'no-store' } });
}

export async function PATCH(request: Request): Promise<Response> {
  const { salon, error } = await context(request);
  if (error || !salon) {
    return error!;
  }
  const admin = await getAdminSession();
  if (!admin) {
    return Response.json({ error: { code: 'UNAUTHORIZED', message: 'Sign in to update rebooking reminders.' } }, { status: 401 });
  }
  const parsed = rebookingReminderUpdateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: { code: 'VALIDATION_ERROR', message: 'Check the reminder interval and message variables.', details: parsed.error.flatten() } }, { status: 400 });
  }
  const settings = await saveRebookingReminderSettings(salon.id, parsed.data);
  await logAuditEvent({
    salonId: salon.id,
    actorType: 'admin',
    actorId: admin.id,
    action: 'settings_updated',
    entityType: 'rebooking_reminder_settings',
    entityId: salon.id,
    metadata: { enabled: settings.enabled, defaultIntervalWeeks: settings.defaultIntervalWeeks },
  });
  return Response.json({ data: { settings } }, { headers: { 'Cache-Control': 'no-store' } });
}
