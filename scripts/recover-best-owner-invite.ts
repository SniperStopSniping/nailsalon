/* eslint-disable no-console */
import { randomUUID } from 'node:crypto';

import { Client } from 'pg';

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is required');
  }

  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    await client.query('begin');
    const salonResult = await client.query<{
      id: string;
      owner_email: string | null;
      owner_clerk_user_id: string | null;
      publication_status: string;
    }>(`
      select id, owner_email, owner_clerk_user_id, publication_status
      from salon
      where slug = 'best'
      for update
    `);
    if (salonResult.rowCount !== 1) {
      throw new Error('RECOVERY_GUARD_SALON');
    }
    const salon = salonResult.rows[0]!;
    if (!salon.owner_email || salon.owner_clerk_user_id) {
      throw new Error('RECOVERY_GUARD_OWNER_STATE');
    }

    const counts = await client.query<{
      membership_count: string;
      appointment_count: string;
    }>(`
      select
        (select count(*) from admin_salon_membership where salon_id = $1)::text as membership_count,
        (select count(*) from appointment where salon_id = $1)::text as appointment_count
    `, [salon.id]);
    if (counts.rows[0]?.membership_count !== '0' || counts.rows[0]?.appointment_count !== '0') {
      throw new Error('RECOVERY_GUARD_ACTIVITY');
    }

    const owners = await client.query<{ id: string }>(`
      select id
      from admin_user
      where lower(email) = lower($1)
      for update
    `, [salon.owner_email]);
    if (owners.rowCount !== 1) {
      throw new Error('RECOVERY_GUARD_ADMIN');
    }

    const inviteResult = await client.query<{ id: string }>(`
      select id
      from salon_signup_invite
      where lower(invited_email) = lower($1)
        and intent = 'create_salon'
        and consumed_at is null
        and revoked_at is null
        and expires_at > now()
      for update
    `, [salon.owner_email]);
    if (inviteResult.rowCount !== 1) {
      throw new Error('RECOVERY_GUARD_INVITE');
    }

    const activeClaim = await client.query(`
      select id
      from salon_signup_invite
      where salon_id = $1
        and consumed_at is null
        and revoked_at is null
      for update
    `, [salon.id]);
    if (activeClaim.rowCount !== 0) {
      throw new Error('RECOVERY_GUARD_EXISTING_CLAIM');
    }

    await client.query(`
      update salon_signup_invite
      set intent = 'claim_existing', salon_id = $1
      where id = $2
    `, [salon.id, inviteResult.rows[0]!.id]);
    await client.query(`
      update salon
      set publication_status = 'draft', published_at = null
      where id = $1
    `, [salon.id]);
    await client.query(`
      insert into audit_log (
        id, salon_id, actor_type, action, entity_type, entity_id, metadata, created_at
      ) values ($1, $2, 'system', 'salon_claim_recovery_prepared', 'salon_signup_invite', $3, $4, now())
    `, [
      randomUUID(),
      salon.id,
      inviteResult.rows[0]!.id,
      JSON.stringify({
        priorPublicationStatus: salon.publication_status,
        membershipCount: 0,
        appointmentCount: 0,
      }),
    ]);

    await client.query('commit');
    console.log('RECOVERY_READY slug=best memberships=0 appointments=0');
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    await client.end();
  }
}

void main();
