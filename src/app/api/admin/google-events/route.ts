import { and, asc, eq, gte, isNull } from 'drizzle-orm';
import { z } from 'zod';

import { requireAdminSalon } from '@/libs/adminAuth';
import { db } from '@/libs/DB';
import { processGoogleCalendarInboundSync } from '@/libs/googleCalendarInbound';
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
    const clientMatches = clients.filter(client => client.fullName && includesAllTokens(normalizedTitle, normalizeGoogleEventTitle(client.fullName)));
    const serviceMatches = services
      .filter(service => includesAllTokens(normalizedTitle, normalizeGoogleEventTitle(service.name)))
      .sort((a, b) => Math.abs(a.durationMinutes - event.durationMinutes) - Math.abs(b.durationMinutes - event.durationMinutes));
    return {
      ...event,
      isReadOnly: !['owner', 'writer'].includes(event.sourceAccessRole),
      suggestion: {
        client: clientMatches.length === 1 ? clientMatches[0] : null,
        service: serviceMatches.length === 1 ? serviceMatches[0] : null,
        recordedDecision: await getRecordedGoogleEventDecision(salon.id, event.title),
      },
    };
  }));
  return Response.json({ data: { events: data } });
}
