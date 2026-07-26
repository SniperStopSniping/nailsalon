import path from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { sql } from 'drizzle-orm';
import { drizzle as drizzlePg } from 'drizzle-orm/node-postgres';
import { migrate as migratePg } from 'drizzle-orm/node-postgres/migrator';
import { drizzle as drizzlePglite } from 'drizzle-orm/pglite';
import { migrate as migratePglite } from 'drizzle-orm/pglite/migrator';
import pg from 'pg';
import {
  afterAll,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

import {
  archiveSalonClient,
  canonicalizeClientVersionToken,
  ClientDeletionError,
} from './clientDeletion';
import type { LifecycleSqlHandle } from './clientLifecycleStabilization';

vi.mock('server-only', () => ({}));

const holder = vi.hoisted(() => ({ db: null as unknown }));
vi.mock('@/libs/DB', () => ({
  get db() {
    return holder.db;
  },
}));

const { Client, Pool } = pg;
const MIGRATIONS_FOLDER = path.join(process.cwd(), 'migrations');
const ACTOR_ID = 'admin_client_archive_test';
const PORTABLE_SALON_ID = 'client-archive-portable-salon';

type Queryable = LifecycleSqlHandle;

function rows(result: unknown): Record<string, unknown>[] {
  const resultWithRows = result as { rows?: Record<string, unknown>[] };
  if (Array.isArray(resultWithRows?.rows)) {
    return resultWithRows.rows;
  }
  return Array.isArray(result) ? result as Record<string, unknown>[] : [];
}

async function seedSalon(
  handle: Queryable,
  salonId: string,
): Promise<void> {
  await handle.execute(sql`
    insert into salon (id, name, slug, theme_key)
    values (
      ${salonId},
      'Client archive test salon',
      ${`slug-${salonId}`},
      'minimal'
    )
  `);
}

async function seedClient(
  handle: Queryable,
  input: {
    salonId: string;
    clientId: string;
    phone: string;
    email?: string | null;
    archived?: boolean;
  },
): Promise<string> {
  await handle.execute(sql`
    insert into salon_client (
      id,
      salon_id,
      phone,
      full_name,
      email,
      archived_at,
      archived_by,
      created_at,
      updated_at
    )
    values (
      ${input.clientId},
      ${input.salonId},
      ${input.phone},
      'Archive fixture',
      ${input.email ?? null},
      ${input.archived ? new Date('2026-07-20T10:00:00.000Z') : null},
      ${input.archived ? ACTOR_ID : null},
      ${new Date('2026-07-20T09:00:00.000Z')},
      ${new Date('2026-07-20T09:00:00.000Z')}
    )
  `);
  return loadVersion(handle, input.clientId);
}

async function loadVersion(
  handle: Queryable,
  clientId: string,
): Promise<string> {
  const result = await handle.execute(sql`
    select to_char(
      updated_at,
      'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
    ) as version
    from salon_client
    where id = ${clientId}
  `);
  const version = rows(result)[0]?.version;
  if (typeof version !== 'string') {
    throw new TypeError(`Missing client version for ${clientId}`);
  }
  return version;
}

async function expectArchiveError(
  promise: Promise<unknown>,
  code: ClientDeletionError['code'],
): Promise<ClientDeletionError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(ClientDeletionError);
    expect((error as ClientDeletionError).code).toBe(code);

    return error as ClientDeletionError;
  }
  throw new Error(`Expected client archive error ${code}`);
}

async function seedAppointment(
  handle: Queryable,
  input: {
    id: string;
    salonId: string;
    clientId: string;
    phone: string;
    status: string;
    startTime: Date;
  },
): Promise<void> {
  await handle.execute(sql`
    insert into appointment (
      id,
      salon_id,
      client_phone,
      client_name,
      salon_client_id,
      start_time,
      end_time,
      status,
      total_price,
      total_duration_minutes,
      created_at,
      updated_at
    )
    values (
      ${input.id},
      ${input.salonId},
      ${input.phone},
      'Appointment snapshot',
      ${input.clientId},
      ${input.startTime},
      ${new Date(input.startTime.getTime() + 60 * 60 * 1000)},
      ${input.status},
      6500,
      60,
      now(),
      now()
    )
  `);
}

async function mergeSalonClientSource(
  handle: Queryable,
  input: {
    sourceClientId: string;
    terminalClientId: string;
  },
): Promise<void> {
  await handle.execute(sql.raw(
    'alter table salon_client disable trigger salon_client_enforce_merge_transition',
  ));
  try {
    await handle.execute(sql`
      update salon_client
      set
        archived_at = ${new Date('2026-07-20T11:00:00.000Z')},
        archived_by = ${ACTOR_ID},
        merged_into_client_id = ${input.terminalClientId},
        merged_at = ${new Date('2026-07-20T11:00:00.000Z')},
        merged_by = ${ACTOR_ID}
      where id = ${input.sourceClientId}
    `);
  } finally {
    await handle.execute(sql.raw(
      'alter table salon_client enable trigger salon_client_enforce_merge_transition',
    ));
  }
}

async function historySnapshots(
  handle: Queryable,
  input: {
    appointmentId: string;
    paymentId: string;
    communicationId: string;
    rewardId: string;
    referralId: string;
  },
): Promise<Record<string, unknown>> {
  return rows(await handle.execute(sql`
    select
      (select to_jsonb(value) from appointment as value
       where id = ${input.appointmentId}) as appointment,
      (select to_jsonb(value) from appointment_payment as value
       where id = ${input.paymentId}) as payment,
      (select to_jsonb(value) from client_communication as value
       where id = ${input.communicationId}) as communication,
      (select to_jsonb(value) from reward as value
       where id = ${input.rewardId}) as reward,
      (select to_jsonb(value) from referral as value
       where id = ${input.referralId}) as referral
  `))[0]!;
}

describe('archive client portable transactional authority', () => {
  let client: PGlite;
  let testDb: ReturnType<typeof drizzlePglite>;

  beforeAll(async () => {
    client = new PGlite();
    await client.waitReady;
    testDb = drizzlePglite(client);
    await migratePglite(testDb, {
      migrationsFolder: MIGRATIONS_FOLDER,
    });
    holder.db = testDb;
    await seedSalon(testDb, PORTABLE_SALON_ID);
  }, 60_000);

  afterAll(async () => {
    await client.close();
  });

  it('canonicalizes exact client versions to six UTC fractional digits', () => {
    expect(canonicalizeClientVersionToken(
      '2026-07-20T05:00:00.1234-04:00',
    )).toBe('2026-07-20T09:00:00.123400Z');
    expect(() => canonicalizeClientVersionToken('not-a-version'))
      .toThrow(TypeError);
  });

  it('archives a terminal once, preserves every history snapshot, and binds an identical retry', async () => {
    const clientId = 'portable-archive-client';
    const phone = '4165550101';
    const email = 'archive-history@example.invalid';
    const expectedUpdatedAt = await seedClient(testDb, {
      salonId: PORTABLE_SALON_ID,
      clientId,
      phone,
      email,
    });
    const snapshotIds = {
      appointmentId: 'portable-past-appointment',
      paymentId: 'portable-past-payment',
      communicationId: 'portable-past-communication',
      rewardId: 'portable-past-reward',
      referralId: 'portable-past-referral',
    };
    await seedAppointment(testDb, {
      id: snapshotIds.appointmentId,
      salonId: PORTABLE_SALON_ID,
      clientId,
      phone,
      status: 'completed',
      startTime: new Date('2026-07-01T14:00:00.000Z'),
    });
    await testDb.execute(sql`
      insert into appointment_payment (
        id,
        appointment_id,
        salon_id,
        amount_cents,
        method,
        reference,
        recorded_by_type
      )
      values (
        ${snapshotIds.paymentId},
        ${snapshotIds.appointmentId},
        ${PORTABLE_SALON_ID},
        6500,
        'cash',
        'historical-reference',
        'admin'
      )
    `);
    await testDb.execute(sql`
      insert into client_communication (
        id,
        salon_id,
        salon_client_id,
        appointment_id,
        kind,
        status,
        message_snapshot
      )
      values (
        ${snapshotIds.communicationId},
        ${PORTABLE_SALON_ID},
        ${clientId},
        ${snapshotIds.appointmentId},
        'generic_text',
        'dismissed',
        'Historical message snapshot'
      )
    `);
    await testDb.execute(sql`
      insert into reward (
        id,
        salon_id,
        client_phone,
        type,
        points,
        status
      )
      values (
        ${snapshotIds.rewardId},
        ${PORTABLE_SALON_ID},
        ${phone},
        'referral_referrer',
        0,
        'expired'
      )
    `);
    await testDb.execute(sql`
      insert into referral (
        id,
        salon_id,
        referrer_phone,
        status
      )
      values (
        ${snapshotIds.referralId},
        ${PORTABLE_SALON_ID},
        ${phone},
        'sent'
      )
    `);
    const before = await historySnapshots(testDb, snapshotIds);

    const first = await archiveSalonClient({
      salonId: PORTABLE_SALON_ID,
      requestedClientId: clientId,
      expectedUpdatedAt,
      actorAdminId: ACTOR_ID,
    });
    const retry = await archiveSalonClient({
      salonId: PORTABLE_SALON_ID,
      requestedClientId: clientId,
      expectedUpdatedAt,
      actorAdminId: ACTOR_ID,
    });

    expect(first).toMatchObject({
      code: 'CLIENT_ARCHIVED',
      terminalClientId: clientId,
      idempotent: false,
      redirectedFromStaleSource: false,
    });
    expect(retry).toEqual({
      code: 'CLIENT_ALREADY_ARCHIVED',
      terminalClientId: clientId,
      updatedAt: first.updatedAt,
      idempotent: true,
      redirectedFromStaleSource: false,
    });
    expect(await historySnapshots(testDb, snapshotIds)).toEqual(before);

    const state = rows(await testDb.execute(sql`
      select
        (select count(*)::int
         from salon_client
         where id = ${clientId}
           and archived_at is not null
           and archived_by = ${ACTOR_ID}) as archived_count,
        (select count(*)::int
         from salon_client
         where id = ${clientId}
           and archived_at is null
           and merged_into_client_id is null) as active_count,
        (select count(*)::int
         from audit_log
         where entity_id = ${clientId}
           and action = 'client_archived') as audit_count
    `))[0];

    expect(state).toEqual({
      archived_count: 1,
      active_count: 0,
      audit_count: 1,
    });

    const audit = rows(await testDb.execute(sql`
      select actor_phone, metadata
      from audit_log
      where entity_id = ${clientId}
        and action = 'client_archived'
    `));

    expect(audit[0]?.actor_phone).toBeNull();

    const serializedAudit = JSON.stringify(audit);

    expect(serializedAudit).not.toContain(phone);
    expect(serializedAudit).not.toContain(email);
    expect(serializedAudit).not.toContain('Archive fixture');
  });

  it('rejects pending, confirmed, and in-progress appointments without mutating them', async () => {
    for (const [index, status] of [
      'pending',
      'confirmed',
      'in_progress',
    ].entries()) {
      const clientId = `portable-active-${status}`;
      const phone = `416555011${index}`;
      const appointmentId = `portable-active-appointment-${status}`;
      const expectedUpdatedAt = await seedClient(testDb, {
        salonId: PORTABLE_SALON_ID,
        clientId,
        phone,
      });
      await seedAppointment(testDb, {
        id: appointmentId,
        salonId: PORTABLE_SALON_ID,
        clientId,
        phone,
        status,
        startTime: status === 'in_progress'
          ? new Date('2026-01-01T14:00:00.000Z')
          : new Date('2026-08-01T14:00:00.000Z'),
      });
      const before = rows(await testDb.execute(sql`
        select to_jsonb(value) as snapshot
        from appointment as value
        where id = ${appointmentId}
      `))[0]?.snapshot;

      await expectArchiveError(archiveSalonClient({
        salonId: PORTABLE_SALON_ID,
        requestedClientId: clientId,
        expectedUpdatedAt,
        actorAdminId: ACTOR_ID,
      }), 'CLIENT_HAS_ACTIVE_APPOINTMENT');

      const state = rows(await testDb.execute(sql`
        select
          (select archived_at from salon_client
           where id = ${clientId}) as archived_at,
          (select count(*)::int from audit_log
           where entity_id = ${clientId}) as audit_count,
          (select to_jsonb(value) from appointment as value
           where id = ${appointmentId}) as snapshot
      `))[0];

      expect(state).toMatchObject({
        archived_at: null,
        audit_count: 0,
        snapshot: before,
      });
    }
  });

  it('archives through a stale source while preserving supported global identity, session, aliases, and snapshots', async () => {
    const terminalClientId = 'portable-stale-terminal';
    const sourceClientId = 'portable-stale-source';
    const terminalPhone = '4165550120';
    const expectedUpdatedAt = await seedClient(testDb, {
      salonId: PORTABLE_SALON_ID,
      clientId: terminalClientId,
      phone: terminalPhone,
      email: 'terminal.snapshot@example.invalid',
    });
    await seedClient(testDb, {
      salonId: PORTABLE_SALON_ID,
      clientId: sourceClientId,
      phone: '4165550121',
    });
    await testDb.execute(sql`
      insert into client (id, phone, first_name, created_at, updated_at)
      values (
        'portable-stale-global',
        ${`+1${terminalPhone}`},
        'Global snapshot',
        now(),
        now()
      )
    `);
    await testDb.execute(sql`
      update salon_client
      set client_id = 'portable-stale-global'
      where id = ${terminalClientId}
    `);
    await testDb.execute(sql`
      insert into client_session (
        id,
        client_phone,
        expires_at,
        created_at
      )
      values (
        'portable-stale-session',
        ${`+1${terminalPhone}`},
        now() + interval '1 day',
        now()
      )
    `);
    await mergeSalonClientSource(testDb, {
      sourceClientId,
      terminalClientId,
    });
    await testDb.execute(sql`
      insert into salon_client_contact_alias (
        salon_id,
        salon_client_id,
        kind,
        normalized_value
      )
      values (
        ${PORTABLE_SALON_ID},
        ${sourceClientId},
        'email',
        'source.alias@example.invalid'
      )
    `);
    await seedAppointment(testDb, {
      id: 'portable-stale-past-appointment',
      salonId: PORTABLE_SALON_ID,
      clientId: sourceClientId,
      phone: '4165550121',
      status: 'completed',
      startTime: new Date('2026-06-01T14:00:00.000Z'),
    });
    const before = rows(await testDb.execute(sql`
      select
        (select to_jsonb(value) from salon_client as value
         where id = ${sourceClientId}) as source_snapshot,
        (select to_jsonb(value) from client as value
         where id = 'portable-stale-global') as global_snapshot,
        (select to_jsonb(value) from client_session as value
         where id = 'portable-stale-session') as session_snapshot,
        (select to_jsonb(value) from salon_client_contact_alias as value
         where salon_client_id = ${sourceClientId}) as alias_snapshot,
        (select to_jsonb(value) from appointment as value
         where id = 'portable-stale-past-appointment')
           as appointment_snapshot
    `))[0]!;

    const result = await archiveSalonClient({
      salonId: PORTABLE_SALON_ID,
      requestedClientId: sourceClientId,
      expectedUpdatedAt,
      actorAdminId: ACTOR_ID,
    });

    expect(result).toMatchObject({
      code: 'CLIENT_ARCHIVED',
      terminalClientId,
      redirectedFromStaleSource: true,
      idempotent: false,
    });

    const after = rows(await testDb.execute(sql`
      select
        (select to_jsonb(value) from salon_client as value
         where id = ${sourceClientId}) as source_snapshot,
        (select to_jsonb(value) from client as value
         where id = 'portable-stale-global') as global_snapshot,
        (select to_jsonb(value) from client_session as value
         where id = 'portable-stale-session') as session_snapshot,
        (select to_jsonb(value) from salon_client_contact_alias as value
         where salon_client_id = ${sourceClientId}) as alias_snapshot,
        (select to_jsonb(value) from appointment as value
         where id = 'portable-stale-past-appointment')
           as appointment_snapshot
    `))[0]!;

    expect(after).toEqual(before);
  });

  it('rejects a stale CAS and a changed archived state without hiding the conflict', async () => {
    const staleClientId = 'portable-stale-cas-client';
    const staleVersion = await seedClient(testDb, {
      salonId: PORTABLE_SALON_ID,
      clientId: staleClientId,
      phone: '4165550122',
    });
    await testDb.execute(sql`
      update salon_client
      set updated_at = updated_at + interval '1 microsecond'
      where id = ${staleClientId}
    `);
    await expectArchiveError(archiveSalonClient({
      salonId: PORTABLE_SALON_ID,
      requestedClientId: staleClientId,
      expectedUpdatedAt: staleVersion,
      actorAdminId: ACTOR_ID,
    }), 'CLIENT_ARCHIVE_CONFLICT');

    const changedClientId = 'portable-changed-archive-client';
    const changedVersion = await seedClient(testDb, {
      salonId: PORTABLE_SALON_ID,
      clientId: changedClientId,
      phone: '4165550123',
    });
    await archiveSalonClient({
      salonId: PORTABLE_SALON_ID,
      requestedClientId: changedClientId,
      expectedUpdatedAt: changedVersion,
      actorAdminId: ACTOR_ID,
    });
    await testDb.execute(sql`
      update salon_client
      set
        notes = 'intervening archived edit',
        updated_at = updated_at + interval '1 microsecond'
      where id = ${changedClientId}
    `);
    await expectArchiveError(archiveSalonClient({
      salonId: PORTABLE_SALON_ID,
      requestedClientId: changedClientId,
      expectedUpdatedAt: changedVersion,
      actorAdminId: ACTOR_ID,
    }), 'CLIENT_ARCHIVE_CONFLICT');
  });

  it('fails closed for current-contact and alias collisions with another terminal lineage', async () => {
    const aliasClientId = 'portable-alias-conflict';
    const aliasVersion = await seedClient(testDb, {
      salonId: PORTABLE_SALON_ID,
      clientId: aliasClientId,
      phone: '4165550124',
    });
    await seedClient(testDb, {
      salonId: PORTABLE_SALON_ID,
      clientId: 'portable-alias-conflict-other',
      phone: '4165550125',
      archived: true,
    });
    await testDb.execute(sql`
      insert into salon_client_contact_alias (
        salon_id,
        salon_client_id,
        kind,
        normalized_value
      )
      values (
        ${PORTABLE_SALON_ID},
        ${aliasClientId},
        'phone',
        '4165550125'
      )
    `);
    await expectArchiveError(archiveSalonClient({
      salonId: PORTABLE_SALON_ID,
      requestedClientId: aliasClientId,
      expectedUpdatedAt: aliasVersion,
      actorAdminId: ACTOR_ID,
    }), 'UNSUPPORTED_CLIENT_IDENTITY');

    const otherAliasClientId = 'portable-other-alias-conflict';
    const otherAliasPhone = '4165550126';
    const otherAliasVersion = await seedClient(testDb, {
      salonId: PORTABLE_SALON_ID,
      clientId: otherAliasClientId,
      phone: otherAliasPhone,
    });
    await seedClient(testDb, {
      salonId: PORTABLE_SALON_ID,
      clientId: 'portable-other-alias-owner',
      phone: '4165550127',
      archived: true,
    });
    await testDb.execute(sql`
      insert into salon_client_contact_alias (
        salon_id,
        salon_client_id,
        kind,
        normalized_value
      )
      values (
        ${PORTABLE_SALON_ID},
        'portable-other-alias-owner',
        'phone',
        ${otherAliasPhone}
      )
    `);
    await expectArchiveError(archiveSalonClient({
      salonId: PORTABLE_SALON_ID,
      requestedClientId: otherAliasClientId,
      expectedUpdatedAt: otherAliasVersion,
      actorAdminId: ACTOR_ID,
    }), 'UNSUPPORTED_CLIENT_IDENTITY');
  });

  it('fails closed for missing, cyclic, excessive-depth, and cross-salon lifecycle state', async () => {
    await expectArchiveError(archiveSalonClient({
      salonId: PORTABLE_SALON_ID,
      requestedClientId: 'portable-missing-client',
      expectedUpdatedAt: '2026-07-20T09:00:00.000000Z',
      actorAdminId: ACTOR_ID,
    }), 'CLIENT_NOT_FOUND');

    const cycleA = 'portable-cycle-a';
    const cycleB = 'portable-cycle-b';
    const cycleVersion = await seedClient(testDb, {
      salonId: PORTABLE_SALON_ID,
      clientId: cycleA,
      phone: '4165550130',
    });
    await seedClient(testDb, {
      salonId: PORTABLE_SALON_ID,
      clientId: cycleB,
      phone: '4165550131',
    });
    await testDb.execute(sql.raw(
      'alter table salon_client disable trigger salon_client_enforce_merge_transition',
    ));
    try {
      await testDb.execute(sql`
        update salon_client
        set
          archived_at = now(),
          archived_by = ${ACTOR_ID},
          merged_into_client_id = case
            when id = ${cycleA} then ${cycleB}
            else ${cycleA}
          end,
          merged_at = now(),
          merged_by = ${ACTOR_ID}
        where id in (${cycleA}, ${cycleB})
      `);
    } finally {
      await testDb.execute(sql.raw(
        'alter table salon_client enable trigger salon_client_enforce_merge_transition',
      ));
    }
    await expectArchiveError(archiveSalonClient({
      salonId: PORTABLE_SALON_ID,
      requestedClientId: cycleA,
      expectedUpdatedAt: cycleVersion,
      actorAdminId: ACTOR_ID,
    }), 'UNSUPPORTED_CLIENT_IDENTITY');

    const depthIds = Array.from(
      { length: 18 },
      (_, index) => `portable-depth-${index}`,
    );
    let depthTerminalVersion = '';
    for (const [index, clientId] of depthIds.entries()) {
      const version = await seedClient(testDb, {
        salonId: PORTABLE_SALON_ID,
        clientId,
        phone: `647555${String(2000 + index).slice(-4)}`,
      });
      if (index === depthIds.length - 1) {
        depthTerminalVersion = version;
      }
    }
    await testDb.execute(sql.raw(
      'alter table salon_client disable trigger salon_client_enforce_merge_transition',
    ));
    try {
      for (let index = 0; index < depthIds.length - 1; index += 1) {
        await testDb.execute(sql`
          update salon_client
          set
            archived_at = now(),
            archived_by = ${ACTOR_ID},
            merged_into_client_id = ${depthIds[index + 1]!},
            merged_at = now(),
            merged_by = ${ACTOR_ID}
          where id = ${depthIds[index]!}
        `);
      }
    } finally {
      await testDb.execute(sql.raw(
        'alter table salon_client enable trigger salon_client_enforce_merge_transition',
      ));
    }
    await expectArchiveError(archiveSalonClient({
      salonId: PORTABLE_SALON_ID,
      requestedClientId: depthIds[0]!,
      expectedUpdatedAt: depthTerminalVersion,
      actorAdminId: ACTOR_ID,
    }), 'UNSUPPORTED_CLIENT_IDENTITY');

    const otherSalonId = 'client-archive-other-salon';
    await seedSalon(testDb, otherSalonId);
    const crossClientId = 'portable-cross-salon-alias';
    const crossVersion = await seedClient(testDb, {
      salonId: PORTABLE_SALON_ID,
      clientId: crossClientId,
      phone: '4165550132',
    });
    await testDb.execute(sql.raw(
      'alter table salon_client_contact_alias disable trigger salon_client_alias_resolve_merged_client',
    ));
    try {
      await testDb.execute(sql`
        insert into salon_client_contact_alias (
          salon_id,
          salon_client_id,
          kind,
          normalized_value
        )
        values (
          ${otherSalonId},
          ${crossClientId},
          'email',
          'cross-salon@example.invalid'
        )
      `);
    } finally {
      await testDb.execute(sql.raw(
        'alter table salon_client_contact_alias enable trigger salon_client_alias_resolve_merged_client',
      ));
    }
    await expectArchiveError(archiveSalonClient({
      salonId: PORTABLE_SALON_ID,
      requestedClientId: crossClientId,
      expectedUpdatedAt: crossVersion,
      actorAdminId: ACTOR_ID,
    }), 'UNSUPPORTED_CLIENT_IDENTITY');

    const foreignClientId = 'portable-foreign-client';
    const foreignVersion = await seedClient(testDb, {
      salonId: otherSalonId,
      clientId: foreignClientId,
      phone: '4165550133',
    });
    await expectArchiveError(archiveSalonClient({
      salonId: PORTABLE_SALON_ID,
      requestedClientId: foreignClientId,
      expectedUpdatedAt: foreignVersion,
      actorAdminId: ACTOR_ID,
    }), 'CLIENT_NOT_FOUND');
  });

  it('fails closed when one selected lineage carries multiple global client identities', async () => {
    const terminalClientId = 'portable-external-terminal';
    const sourceClientId = 'portable-external-source';
    const expectedUpdatedAt = await seedClient(testDb, {
      salonId: PORTABLE_SALON_ID,
      clientId: terminalClientId,
      phone: '4165550134',
    });
    await seedClient(testDb, {
      salonId: PORTABLE_SALON_ID,
      clientId: sourceClientId,
      phone: '4165550135',
    });
    await testDb.execute(sql`
      insert into client (id, phone, created_at, updated_at)
      values
        ('portable-external-global-a', '+14165550134', now(), now()),
        ('portable-external-global-b', '+14165550135', now(), now())
    `);
    await testDb.execute(sql`
      update salon_client
      set client_id = case
        when id = ${terminalClientId} then 'portable-external-global-a'
        else 'portable-external-global-b'
      end
      where id in (${terminalClientId}, ${sourceClientId})
    `);
    await mergeSalonClientSource(testDb, {
      sourceClientId,
      terminalClientId,
    });

    await expectArchiveError(archiveSalonClient({
      salonId: PORTABLE_SALON_ID,
      requestedClientId: sourceClientId,
      expectedUpdatedAt,
      actorAdminId: ACTOR_ID,
    }), 'UNSUPPORTED_CLIENT_IDENTITY');
  });
});

const databaseUrl = process.env.CONCURRENCY_TEST_DATABASE_URL;
if (databaseUrl) {
  const hostname = new URL(databaseUrl).hostname;
  const isLoopback = hostname === 'localhost'
    || hostname === '127.0.0.1'
    || hostname === '::1';
  if (
    !isLoopback
    || process.env.CLIENT_LIFECYCLE_DISPOSABLE_DATABASE_CONFIRMED !== 'true'
  ) {
    throw new Error(
      'Client archive concurrency tests require an explicitly confirmed loopback disposable database.',
    );
  }
}
const describePostgres = databaseUrl ? describe : describe.skip;

async function waitForLockWait(
  observer: pg.Client,
  applicationName: string,
): Promise<void> {
  const deadline = performance.now() + 5_000;
  while (performance.now() < deadline) {
    const result = await observer.query<{ waiting: boolean }>(
      `select exists (
         select 1
         from pg_stat_activity
         where application_name = $1
           and wait_event_type = 'Lock'
       ) as waiting`,
      [applicationName],
    );
    if (result.rows[0]?.waiting) {
      return;
    }
    await new Promise<void>(resolve => setImmediate(resolve));
  }
  throw new Error('Timed out waiting for deterministic PostgreSQL lock state.');
}

describePostgres('archive client real PostgreSQL concurrency', () => {
  let pool: pg.Pool;
  let observer: pg.Client;
  let testDb: ReturnType<typeof drizzlePg>;
  const salonId = 'client-archive-postgres-salon';

  beforeAll(async () => {
    pool = new Pool({
      connectionString: databaseUrl,
      application_name: 'client-archive-library',
      max: 8,
    });
    observer = new Client({
      connectionString: databaseUrl,
      application_name: 'client-archive-observer',
    });
    await observer.connect();
    await pool.query('drop schema if exists drizzle cascade');
    await pool.query('drop schema if exists public cascade');
    await pool.query('create schema public');
    testDb = drizzlePg(pool);
    await migratePg(testDb, {
      migrationsFolder: MIGRATIONS_FOLDER,
    });
    holder.db = testDb;
  }, 60_000);

  afterAll(async () => {
    await observer.end();
    await pool.end();
  });

  async function resetFixture(): Promise<void> {
    await pool.query(
      'truncate table audit_log, client_session, client, salon restart identity cascade',
    );
    await seedSalon(testDb, salonId);
  }

  it('serializes concurrent archive attempts to one mutation and one audit', async () => {
    await resetFixture();
    const clientId = 'postgres-concurrent-archive';
    const expectedUpdatedAt = await seedClient(testDb, {
      salonId,
      clientId,
      phone: '4165550201',
    });
    const request = {
      salonId,
      requestedClientId: clientId,
      expectedUpdatedAt,
      actorAdminId: ACTOR_ID,
    };

    const results = await Promise.all([
      archiveSalonClient(request),
      archiveSalonClient(request),
    ]);

    expect(results.map(result => result.code).sort()).toEqual([
      'CLIENT_ALREADY_ARCHIVED',
      'CLIENT_ARCHIVED',
    ]);
    expect(results.map(result => result.idempotent).sort())
      .toEqual([false, true]);

    const state = await pool.query<{
      audit_count: number;
      archived_count: number;
    }>(
      `select
         (select count(*)::int
          from audit_log
          where entity_id = $1
            and action = 'client_archived') as audit_count,
         (select count(*)::int
          from salon_client
          where id = $1
            and archived_at is not null) as archived_count`,
      [clientId],
    );

    expect(state.rows[0]).toEqual({
      audit_count: 1,
      archived_count: 1,
    });
  });

  it('lets booking win before archive and rejects without cancellation or partial mutation', async () => {
    await resetFixture();
    const clientId = 'postgres-booking-archive';
    const phone = '4165550202';
    const expectedUpdatedAt = await seedClient(testDb, {
      salonId,
      clientId,
      phone,
    });
    const writer = new Client({
      connectionString: databaseUrl,
      application_name: 'client-archive-booking-writer',
    });
    await writer.connect();
    await writer.query('begin');
    await writer.query(
      'select id from salon_client where id = $1 for update',
      [clientId],
    );
    await writer.query(
      `insert into appointment (
         id, salon_id, client_phone, client_name, salon_client_id,
         start_time, end_time, status, total_price,
         total_duration_minutes, created_at, updated_at
       )
       values (
         'postgres-booking-archive-appointment', $1, $2,
         'Concurrent booking', $3,
         now() + interval '1 day', now() + interval '1 day 1 hour',
         'confirmed', 6500, 60, now(), now()
       )`,
      [salonId, phone, clientId],
    );

    const archive = archiveSalonClient({
      salonId,
      requestedClientId: clientId,
      expectedUpdatedAt,
      actorAdminId: ACTOR_ID,
    });
    await waitForLockWait(observer, 'client-archive-library');
    await writer.query('commit');
    await writer.end();

    await expectArchiveError(
      archive,
      'CLIENT_HAS_ACTIVE_APPOINTMENT',
    );
    const state = await pool.query<{
      status: string;
      archived_at: Date | null;
      audit_count: number;
    }>(
      `select
         appointment.status,
         salon_client.archived_at,
         (select count(*)::int
          from audit_log
          where entity_id = $1) as audit_count
       from salon_client
       inner join appointment
         on appointment.salon_client_id = salon_client.id
       where salon_client.id = $1`,
      [clientId],
    );

    expect(state.rows[0]).toMatchObject({
      status: 'confirmed',
      archived_at: null,
      audit_count: 0,
    });
  });
});
