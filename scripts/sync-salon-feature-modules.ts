/* eslint-disable no-console */
import { writeFile } from 'node:fs/promises';

import { Client } from 'pg';

import { resolveEntitlement } from '../src/libs/featureEntitlements';
import type { ModuleKey, SalonFeatures, SalonSettings } from '../src/types/salonPolicy';

const MODULE_ENTITLEMENTS: Record<ModuleKey, [string, string]> = {
  smsReminders: ['marketing', 'smsReminders'],
  referrals: ['marketing', 'referrals'],
  rewards: ['marketing', 'rewards'],
  scheduleOverrides: ['staff', 'scheduleOverrides'],
  staffEarnings: ['money', 'staffEarnings'],
  clientFlags: ['controls', 'clientFlags'],
  clientBlocking: ['controls', 'clientBlocking'],
  analyticsDashboard: ['analytics', 'dashboard'],
  utilization: ['analytics', 'utilization'],
};

const apply = process.argv.includes('--apply');
const slug = process.argv.find(argument => argument.startsWith('--slug='))?.slice('--slug='.length);

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL is required');
}

async function main() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  try {
    const result = await client.query<{
      id: string;
      slug: string;
      features: SalonFeatures | null;
      settings: SalonSettings | null;
    }>(
      `select id, slug, features, settings
       from salon
      where ($1::text is null or slug = $1)
      order by slug`,
      [slug ?? null],
    );

    if (slug && result.rows.length !== 1) {
      throw new Error(`Expected exactly one salon for slug ${slug}; found ${result.rows.length}`);
    }

    const changes = result.rows.map((salon) => {
      const modules = Object.fromEntries(
        Object.entries(MODULE_ENTITLEMENTS).map(([module, [group, key]]) => [
          module,
          resolveEntitlement(salon.features, group, key),
        ]),
      );
      return {
        id: salon.id,
        slug: salon.slug,
        previousSettings: salon.settings,
        settings: {
          ...(salon.settings ?? {}),
          modules,
        } satisfies SalonSettings,
      };
    });

    console.log(`${apply ? 'Applying' : 'Previewing'} feature-module synchronization for ${changes.length} salon(s).`);
    for (const change of changes) {
      console.log(`- ${change.slug}`);
    }

    if (!apply || changes.length === 0) {
      process.exitCode = 0;
    } else {
      const backupPath = `/tmp/luster-feature-modules-${Date.now()}.json`;
      await writeFile(backupPath, JSON.stringify(
        changes.map(change => ({
          id: change.id,
          slug: change.slug,
          settings: change.previousSettings,
        })),
        null,
        2,
      ), { mode: 0o600 });

      await client.query('begin');
      try {
        for (const change of changes) {
          await client.query(
            'update salon set settings = $1::jsonb, updated_at = now() where id = $2',
            [JSON.stringify(change.settings), change.id],
          );
        }
        await client.query('commit');
        console.log(`Feature modules synchronized. Backup: ${backupPath}`);
      } catch (error) {
        await client.query('rollback');
        throw error;
      }
    }
  } finally {
    await client.end();
  }
}

void main();
