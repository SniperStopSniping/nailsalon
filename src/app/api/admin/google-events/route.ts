import { and, asc, eq, gte, isNull } from 'drizzle-orm';
import { z } from 'zod';

import { requireAdminSalon } from '@/libs/adminAuth';
import { db } from '@/libs/DB';
import { processGoogleCalendarInboundSync } from '@/libs/googleCalendarInbound';
import { parseGoogleEventTitle } from '@/libs/googleEventAutofill';
import { getRecordedGoogleEventDecision, normalizeGoogleEventTitle } from '@/libs/googleEventReview';
import { googleCalendarEventSchema, salonClientSchema, serviceSchema } from '@/models/Schema';

const querySchema = z.object({
  salonSlug: z.string().min(1),
  status: z.enum(['needs_review', 'reviewed', 'appointment', 'all']).default('needs_review'),
  limit: z.coerce.number().int().min(1).max(100).default(10),
});

function includesAllTokens(haystack: string, needle: string) {
  const tokens = needle.split(' ').filter(token => token.length >= 2);
  return tokens.length > 0 && tokens.every(token => haystack.includes(token));
}

function normalizePhone(value: string | null | undefined) {
  const digits = value?.replace(/\D/g, '') || '';
  return digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const parsed = querySchema.safeParse(Object.fromEntries(url.searchParams.entries()));
  if (!parsed.success) {
    return Response.json({ error: 'Invalid Google event query' }, { status: 400 });
  }
  const { error, salon } = await requireAdminSalon(parsed.data.salonSlug);
  if (error || !salon) {
    return error || Response.json({ error: 'Salon not found' }, { status: 404 });
  }
  await processGoogleCalendarInboundSync(1, salon.id).catch(() => undefined);
  const clauses = [
    eq(googleCalendarEventSchema.salonId, salon.id),
    isNull(googleCalendarEventSchema.deletedAt),
    gte(googleCalendarEventSchema.endTime, new Date()),
  ];
  if (parsed.data.status !== 'all') {
    clauses.push(eq(googleCalendarEventSchema.reviewStatus, parsed.data.status));
  }
  const [events, clients, services] = await Promise.all([
    db.select().from(googleCalendarEventSchema).where(and(...clauses)).orderBy(asc(googleCalendarEventSchema.startTime)).limit(parsed.data.limit),
    db.select({ id: salonClientSchema.id, fullName: salonClientSchema.fullName, phone: salonClientSchema.phone, email: salonClientSchema.email }).from(salonClientSchema).where(eq(salonClientSchema.salonId, salon.id)).limit(500),
    db.select({ id: serviceSchema.id, name: serviceSchema.name, category: serviceSchema.category, price: serviceSchema.price, durationMinutes: serviceSchema.durationMinutes }).from(serviceSchema).where(and(eq(serviceSchema.salonId, salon.id), eq(serviceSchema.isActive, true))),
  ]);
  const data = await Promise.all(events.map(async (event) => {
    const normalizedTitle = normalizeGoogleEventTitle(event.title);
    const parsedTitle = parseGoogleEventTitle(event.title);
    const attendeePhone = normalizePhone(event.attendeePhone);
    const attendeeEmail = event.attendeeEmail?.trim().toLowerCase() || null;
    const directClientMatches = clients.filter(client =>
      (attendeePhone && normalizePhone(client.phone) === attendeePhone)
      || (attendeeEmail && client.email?.trim().toLowerCase() === attendeeEmail));
    const titleClientMatches = clients.filter(client => client.fullName && includesAllTokens(normalizedTitle, normalizeGoogleEventTitle(client.fullName)));
    const matchedClients = directClientMatches.length === 1 ? directClientMatches : titleClientMatches;
    const matchedClient = matchedClients.length === 1 ? matchedClients[0]! : null;
    const suggestedClient = event.attendeePhone || event.attendeeEmail || event.attendeeName || parsedTitle.clientName || matchedClient
      ? {
          fullName: event.attendeeName || parsedTitle.clientName || matchedClient?.fullName || null,
          phone: event.attendeePhone || matchedClient?.phone || '',
          email: event.attendeeEmail || matchedClient?.email || null,
        }
      : null;
    const serviceMatches = services
      .filter(service => includesAllTokens(normalizedTitle, normalizeGoogleEventTitle(service.name)))
      .sort((a, b) => Math.abs(a.durationMinutes - event.durationMinutes) - Math.abs(b.durationMinutes - event.durationMinutes));
    return {
      ...event,
      isReadOnly: !['owner', 'writer'].includes(event.sourceAccessRole),
      suggestion: {
        client: suggestedClient,
        service: serviceMatches.length === 1 ? serviceMatches[0] : null,
        recordedDecision: await getRecordedGoogleEventDecision(salon.id, event.title),
      },
    };
  }));
  return Response.json({ data: { events: data } });
}
