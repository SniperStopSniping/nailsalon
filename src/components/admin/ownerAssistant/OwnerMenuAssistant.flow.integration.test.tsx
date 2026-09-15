import path from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';

import * as schema from '@/models/Schema';

import { OwnerMenuAssistant, type OwnerMenuAssistantTransport } from './OwnerMenuAssistant';

// Only identity admission and database transport are fixtures. Requests run
// through the actual route, validation, domain transactions and SQL migration.
const holder = vi.hoisted(() => ({ db: null as unknown }));
vi.mock('server-only', () => ({}));
vi.mock('@/libs/DB', () => ({ get db() {
  return holder.db;
} }));
vi.mock('@/libs/Env', () => ({ Env: { OWNER_ASSISTANT_ENABLED: 'true' } }));
vi.mock('@/libs/adminAuth', () => ({
  requireAdminSalonForSlug: vi.fn(async () => ({ error: null, salon: { id: 'flow-salon', slug: 'flow-salon' } })),
  requireRealSalonOwner: vi.fn(async () => ({ ok: true, admin: { id: 'flow-owner' } })),
}));

let client: PGlite;
let database: ReturnType<typeof drizzle<typeof schema>>;
let route: typeof import('@/app/api/admin/owner-assistant/menu-order/route');
const endpoint = 'http://localhost/api/admin/owner-assistant/menu-order';

beforeAll(async () => {
  client = new PGlite();
  database = drizzle(client, { schema });
  holder.db = database;
  await migrate(database, { migrationsFolder: path.join(process.cwd(), 'migrations') });
  await database.insert(schema.salonSchema).values({ id: 'flow-salon', slug: 'flow-salon', name: 'Flow salon', themeKey: 'minimal' });
  await database.insert(schema.adminUserSchema).values({ id: 'flow-owner' });
  await database.insert(schema.adminSalonMembershipSchema).values({ salonId: 'flow-salon', adminId: 'flow-owner', role: 'owner' });
  await database.insert(schema.serviceSchema).values([
    { id: 'flow-gel', salonId: 'flow-salon', name: 'Gel manicure', sortOrder: 5, price: 4500, durationMinutes: 45, category: 'hands' },
    { id: 'flow-art', salonId: 'flow-salon', name: 'Nail art', sortOrder: 10, price: 2000, durationMinutes: 20, category: 'hands' },
  ]);
  route = await import('@/app/api/admin/owner-assistant/menu-order/route');
}, 120_000);

afterAll(async () => {
  await client?.close();
});

it('runs request → exact preview → commit receipt → guarded undo against real SQL', async () => {
  const before = await database.select().from(schema.serviceSchema).where(eq(schema.serviceSchema.salonId, 'flow-salon')).orderBy(schema.serviceSchema.id);
  const transport: OwnerMenuAssistantTransport = {
    getContext: async slug => route.GET(new Request(`${endpoint}?salonSlug=${slug}`)),
    getStatus: async (slug, proposalId) => route.GET(new Request(`${endpoint}?salonSlug=${slug}&proposalId=${proposalId}`)),
    post: async body => route.POST(new Request(endpoint, { method: 'POST', body: JSON.stringify(body) })),
  };
  render(<OwnerMenuAssistant salonSlug="flow-salon" transport={transport} />);
  fireEvent.click(await screen.findByTestId('owner-menu-assistant-launcher'));
  fireEvent.change(screen.getByLabelText('What should move?'), { target: { value: 'Move Nail art before Gel manicure' } });
  fireEvent.click(screen.getByLabelText('Prepare menu preview'));
  const preview = await screen.findByTestId('owner-menu-assistant-proposal');
  const lists = within(preview).getAllByRole('list');

  expect(lists[0]).toHaveTextContent(/Gel manicure.*Nail art/);
  expect(lists[1]).toHaveTextContent(/Nail art.*Gel manicure/);
  expect(await database.select().from(schema.serviceSchema).where(eq(schema.serviceSchema.salonId, 'flow-salon')).orderBy(schema.serviceSchema.id)).toEqual(before);

  fireEvent.click(screen.getByTestId('owner-menu-assistant-apply'));

  expect(await screen.findByTestId('owner-menu-assistant-receipt')).toHaveTextContent('Menu order updated');

  const operations = await database.select().from(schema.ownerAssistantMenuOperationSchema);

  expect(operations).toHaveLength(1);
  expect(operations[0]?.status).toBe('applied');

  const applied = await database.select().from(schema.serviceSchema).where(eq(schema.serviceSchema.salonId, 'flow-salon')).orderBy(schema.serviceSchema.sortOrder);

  expect(applied.map(item => item.id)).toEqual(['flow-art', 'flow-gel']);

  const duplicate = await transport.post({ action: 'apply', salonSlug: 'flow-salon', proposalId: operations[0]!.id });

  expect((await duplicate.json()).data.receipt.status).toBe('already_applied');

  fireEvent.click(screen.getByTestId('owner-menu-assistant-undo'));
  await waitFor(() => expect(screen.getByTestId('owner-menu-assistant-receipt')).toHaveTextContent('Menu order restored'));
  const restored = await database.select().from(schema.serviceSchema).where(eq(schema.serviceSchema.salonId, 'flow-salon')).orderBy(schema.serviceSchema.id);
  const withoutTimestamp = ({ updatedAt: _updatedAt, ...service }: typeof before[number]) => service;

  expect(restored.map(withoutTimestamp)).toEqual(before.map(withoutTimestamp));
  expect((await database.select().from(schema.ownerAssistantMenuOperationSchema))[0]?.status).toBe('undone');
}, 30_000);
