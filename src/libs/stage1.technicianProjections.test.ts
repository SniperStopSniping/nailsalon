/**
 * S5 (Stage 1) — every public technician projection is pinned.
 *
 * `getTechniciansBySalonId` (`queries.ts`) runs an unrestricted `select()` over
 * `technicianSchema`, so the object handed to each projection carries `email`,
 * `phone`, `payType`, `commissionRate`, `hourlyRate`, `salaryAmount` and
 * internal `notes`. Nothing but an explicit allowlist keeps those out of a
 * public response.
 *
 * Stage 1 reduced SIX hand-maintained projections to FIVE by collapsing the
 * `book/service` inline copy onto the shared `mapPublicTechnician` (identical
 * input type, byte-identical output keys). The five that remain are pinned two
 * ways.
 *
 * Count correction: an earlier revision of this file said five-reduced-to-four.
 * Adversarial review found a further projection in `appointmentManage.ts` over
 * the same unrestricted row; it is guarded below.
 *
 *   1. RUNTIME exact-shape, where the projector is importable and pure. A
 *      superset fails — that is the point, and it is what catches a field being
 *      added by accident.
 *   2. SOURCE-LEVEL guards for the two projections that live inside a page /
 *      route handler and cannot be invoked without a full request. These assert
 *      the projection literal never spreads the raw row and never names a
 *      sensitive column.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

/* eslint-disable import/first */
import { BOOKING_EXPERIENCE_DEFAULTS } from './bookingExperience';
import { mapPublicTechnician } from './publicBookingTechnicians';
import { resolveSalonContent } from './salonContent';
/* eslint-enable import/first */

/** Every sensitive column that a raw technician row actually carries. */
const SENSITIVE_TECHNICIAN_FIELDS = [
  'email',
  'phone',
  'payType',
  'commissionRate',
  'hourlyRate',
  'salaryAmount',
  'notes',
] as const;

/** A raw row shaped like `getTechniciansBySalonId` returns: full row + joins. */
const RAW_TECHNICIAN_ROW = {
  id: 'tech_1',
  salonId: 'salon_1',
  name: 'Maya',
  avatarUrl: 'https://cdn.example.com/maya.jpg',
  bio: 'Ten years of Gel-X.',
  specialties: ['gel-x'],
  languages: ['en'],
  rating: '4.8',
  reviewCount: 12,
  skillLevel: 'senior',
  acceptingNewClients: true,
  isActive: true,
  primaryLocationId: 'loc_1',
  serviceIds: ['svc_1'],
  enabledServiceIds: ['svc_1'],
  weeklySchedule: {},
  // --- the fields that must NEVER reach a public response ---
  email: 'maya@example.com',
  phone: '+14165551234',
  payType: 'commission',
  commissionRate: '45.00',
  hourlyRate: '30.00',
  salaryAmount: '60000.00',
  notes: 'Internal: prefers morning shifts.',
} as const;

function readSource(relativePath: string): string {
  return readFileSync(path.join(process.cwd(), relativePath), 'utf8');
}

describe('S5 — mapPublicTechnician (the shared projector)', () => {
  it('emits exactly the nine public keys', () => {
    const projected = mapPublicTechnician(RAW_TECHNICIAN_ROW as never);

    expect(Object.keys(projected).sort()).toEqual([
      'enabledServiceIds',
      'id',
      'imageUrl',
      'name',
      'primaryLocationId',
      'rating',
      'reviewCount',
      'serviceIds',
      'specialties',
    ]);
  });

  it('drops every sensitive field', () => {
    const projected = mapPublicTechnician(RAW_TECHNICIAN_ROW as never) as Record<string, unknown>;

    for (const field of SENSITIVE_TECHNICIAN_FIELDS) {
      expect(projected).not.toHaveProperty(field);
    }
    const serialized = JSON.stringify(projected);

    expect(serialized).not.toContain('maya@example.com');
    expect(serialized).not.toContain('4165551234');
    expect(serialized).not.toContain('60000');
    expect(serialized).not.toContain('prefers morning shifts');
  });
});

describe('S5 — resolveSalonContent technician projection', () => {
  const buildContent = () => resolveSalonContent({
    salon: {
      name: 'Isla Nail Studio',
      logoUrl: null,
      address: null,
      city: 'Toronto',
      state: 'ON',
      zipCode: null,
      businessHours: null,
    },
    technicians: [RAW_TECHNICIAN_ROW as never],
    services: [],
    bookingExperience: BOOKING_EXPERIENCE_DEFAULTS,
  });

  it('emits exactly the ten public keys', () => {
    const content = buildContent();

    expect(Object.keys(content.people.technicians[0]!).sort()).toEqual([
      'acceptingNewClients',
      'avatarUrl',
      'bio',
      'id',
      'languages',
      'name',
      'rating',
      'reviewCount',
      'skillLevel',
      'specialties',
    ]);
  });

  it('drops every sensitive field', () => {
    const content = buildContent();
    const projected = content.people.technicians[0] as unknown as Record<string, unknown>;

    for (const field of SENSITIVE_TECHNICIAN_FIELDS) {
      expect(projected).not.toHaveProperty(field);
    }

    expect(JSON.stringify(content.people)).not.toContain('maya@example.com');
    expect(JSON.stringify(content.people)).not.toContain('Internal:');
  });
});

describe('S5 — source-level guards for in-route projections', () => {
  const IN_ROUTE_PROJECTIONS = [
    {
      label: 'book/tech page technician list',
      file: 'src/app/(unauth)/book/tech/page.tsx',
      start: 'const technicians = resolvedTechnicianContext.activeTechnicians',
      end: '.filter(technician =>',
    },
    {
      label: 'api/appointments success-response technician',
      file: 'src/app/api/appointments/route.ts',
      start: '        technician: technician',
      end: '        salon: {',
    },
    {
      label: 'appointmentManage technicianOptions',
      file: 'src/libs/appointmentManage.ts',
      start: '    technicianOptions: loaded.technicians',
      end: '    financial:',
    },
  ] as const;

  it.each(IN_ROUTE_PROJECTIONS)(
    '$label never spreads the raw row and never names a sensitive field',
    ({ file, start, end }) => {
      const source = readSource(file);
      const from = source.indexOf(start);

      expect(from).toBeGreaterThan(-1);

      const to = source.indexOf(end, from);

      expect(to).toBeGreaterThan(from);

      const projection = source.slice(from, to);

      // A spread of the source row is the exact mistake this guards against:
      // it would silently republish every column added to the table later.
      expect(projection).not.toMatch(/\.\.\.technician\b/);

      for (const field of SENSITIVE_TECHNICIAN_FIELDS) {
        expect(projection).not.toMatch(new RegExp(`\\btechnician\\.${field}\\b`));
      }
    },
  );

  it('book/service reuses the shared projector rather than keeping a fourth copy', () => {
    const routeSource = readSource('src/app/(unauth)/book/service/page.tsx');
    const source = readSource('src/app/(unauth)/book/service/BookServicePageServer.tsx');

    expect(routeSource).toContain('from \'./BookServicePageServer\'');
    expect(routeSource).toContain('return renderBookServicePage({');
    expect(routeSource).toContain('searchParams: await props.searchParams');
    expect(routeSource).toContain('params: await props.params');

    expect(source).toContain('dbTechnicians.map(mapPublicTechnician)');
    expect(source).not.toMatch(/dbTechnicians\.map\(technician => \(\{/);
  });
});
