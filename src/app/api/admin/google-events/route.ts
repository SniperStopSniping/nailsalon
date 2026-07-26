import { and, asc, eq, gte, isNotNull, isNull, or } from 'drizzle-orm';
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

const CLIENT_SUGGESTION_LIMIT = 500;

function includesAllTokens(haystack: string, needle: string) {
  const tokens = needle.split(' ').filter(token => token.length >= 2);
  return tokens.length > 0 && tokens.every(token => haystack.includes(token));
}

function includesClientNameTokens(haystack: string, needle: string) {
  const tokens = needle.split(' ').filter(Boolean);
  if (tokens.length === 0) {
    return false;
  }
  if (tokens.length === 1) {
    return haystack === needle;
  }
  const haystackTokens = new Set(haystack.split(' ').filter(Boolean));
  return tokens.every(token => haystackTokens.has(token));
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
  const [events, clients, suppressedClientRows, services] = await Promise.all([
    db.select().from(googleCalendarEventSchema).where(and(...clauses)).orderBy(asc(googleCalendarEventSchema.startTime)).limit(parsed.data.limit),
    db.select({
      id: salonClientSchema.id,
      fullName: salonClientSchema.fullName,
      phone: salonClientSchema.phone,
      email: salonClientSchema.email,
    }).from(salonClientSchema).where(and(
      eq(salonClientSchema.salonId, salon.id),
      isNull(salonClientSchema.archivedAt),
      isNull(salonClientSchema.mergedIntoClientId),
    )).limit(CLIENT_SUGGESTION_LIMIT),
    db.select({
      id: salonClientSchema.id,
      fullName: salonClientSchema.fullName,
      phone: salonClientSchema.phone,
      email: salonClientSchema.email,
    }).from(salonClientSchema).where(and(
      eq(salonClientSchema.salonId, salon.id),
      or(
        isNotNull(salonClientSchema.archivedAt),
        isNotNull(salonClientSchema.mergedIntoClientId),
      ),
    )).limit(CLIENT_SUGGESTION_LIMIT + 1),
    db.select({ id: serviceSchema.id, name: serviceSchema.name, category: serviceSchema.category, price: serviceSchema.price, durationMinutes: serviceSchema.durationMinutes }).from(serviceSchema).where(and(eq(serviceSchema.salonId, salon.id), eq(serviceSchema.isActive, true))),
  ]);
  const suppressionCoverageComplete
    = suppressedClientRows.length <= CLIENT_SUGGESTION_LIMIT;
  const suppressedClients = suppressedClientRows.slice(
    0,
    CLIENT_SUGGESTION_LIMIT,
  );
  const data = await Promise.all(events.map(async (event) => {
    const normalizedTitle = normalizeGoogleEventTitle(event.title);
    const parsedTitle = parseGoogleEventTitle(event.title);
    const attendeePhone = normalizePhone(event.attendeePhone);
    const attendeeEmail = event.attendeeEmail?.trim().toLowerCase() || null;
    const explicitNames = new Set([
      normalizeGoogleEventTitle(event.attendeeName),
      normalizeGoogleEventTitle(parsedTitle.clientName),
    ].filter(Boolean));
    const matchesContact = (client: typeof clients[number]) =>
      (attendeePhone && normalizePhone(client.phone) === attendeePhone)
      || (attendeeEmail && client.email?.trim().toLowerCase() === attendeeEmail);
    const matchesTitleIdentity = (client: typeof clients[number]) => {
      const normalizedName = normalizeGoogleEventTitle(client.fullName);
      return normalizedName
        && (explicitNames.has(normalizedName)
          || includesClientNameTokens(normalizedTitle, normalizedName));
    };
    const directClientMatches = clients.filter(client =>
      matchesContact(client));
    const titleClientMatches = clients.filter(matchesTitleIdentity);
    const matchedClients = directClientMatches.length === 1 ? directClientMatches : titleClientMatches;
    const matchedClient = matchedClients.length === 1 ? matchedClients[0]! : null;
    const hasSuppressedClientIdentity = !suppressionCoverageComplete
      || suppressedClients.some(client =>
        matchesContact(client) || matchesTitleIdentity(client));
    const suggestedClient = !hasSuppressedClientIdentity
      && (event.attendeePhone || event.attendeeEmail || event.attendeeName || parsedTitle.clientName || matchedClient)
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
