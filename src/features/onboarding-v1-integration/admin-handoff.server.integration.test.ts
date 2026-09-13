import path from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';

import type { DatabaseSessionHandle } from '@/libs/DB';
import * as schema from '@/models/Schema';

import { initializeStarter } from '../../../prototypes/site-builder-v2-booking-integration-lab/src/model/starters';
import type {
  OnboardingCompiledSiteDocument,
  OnboardingPersistedSnapshot,
} from './contracts';

vi.mock('server-only', () => ({}));

const mocks = vi.hoisted(() => ({
  database: null as unknown,
  integrationHealth: vi.fn(async () => ({
    google: { readiness: 'not_connected' },
    stripeConnect: { status: 'not_connected' },
  })),
}));

vi.mock('@/libs/DB', () => ({
  get db() {
    return mocks.database;
  },
}));

vi.mock('@/libs/integrationHealth', () => ({
  getSalonIntegrationHealth: mocks.integrationHealth,
}));

/* eslint-disable import/first */
import { getOnboardingSiteHandoff } from './admin-handoff.server';
/* eslint-enable import/first */

const TARGET_SALON_ID = 'salon_handoff_target';
const OTHER_SALON_ID = 'salon_handoff_other';

const document = (): OnboardingCompiledSiteDocument => ({
  builderDocument: initializeStarter('one_page', {
    siteId: 'site_handoff_target',
    siteName: 'Target Studio',
  }),
  compilerVersion: 1,
  navigation: [{ label: 'Home', order: 0, pageId: 'site:page:home' }],
  navigationEnabled: true,
  pages: [{
    id: 'site:page:home',
    isHome: true,
    label: 'Home',
    order: 0,
    sections: [{
      id: 'site:home:booking',
      order: 0,
      presentation: {},
      source: 'service_menu',
      type: 'booking',
      visible: true,
    }],
    slug: '',
    visible: true,
    visibleInNavigation: true,
  }],
  palettePresetId: 'luster_berry',
  recipeMigrationResult: 'fresh_v1',
  recipeVersion: 1,
  revision: 1,
  schemaVersion: 1,
  serviceSelection: { selectedAddOnIds: [], selectedServiceIds: [] },
  siteId: 'site_handoff_target',
  siteName: 'Target Studio',
  sourceSnapshotVersion: 1,
  starter: 'one_page',
  stylePresetId: 'modern',
});

describe.sequential('getOnboardingSiteHandoff service completion', () => {
  let client: PGlite;
  let database: ReturnType<typeof drizzle<typeof schema>>;

  beforeAll(async () => {
    client = new PGlite();
    await client.waitReady;
    database = drizzle(client, { schema });
    await migrate(database, { migrationsFolder: path.join(process.cwd(), 'migrations') });
    mocks.database = database as unknown as DatabaseSessionHandle;

    await database.insert(schema.salonSchema).values([
      {
        id: TARGET_SALON_ID,
        name: 'Target Studio',
        publicationStatus: 'draft',
        slug: 'target-studio',
      },
      {
        id: OTHER_SALON_ID,
        name: 'Other Studio',
        publicationStatus: 'draft',
        slug: 'other-studio',
      },
    ]);
    await database.insert(schema.adminUserSchema).values({
      clerkUserId: 'user_handoff',
      id: 'admin_handoff',
    });
    await database.insert(schema.onboardingSiteSchema).values({
      createdByAdminId: 'admin_handoff',
      currentRevision: 1,
      id: 'site_handoff_target',
      palettePresetId: 'luster_berry',
      salonId: TARGET_SALON_ID,
      stylePresetId: 'modern',
    });
    await database.insert(schema.onboardingSiteRevisionSchema).values({
      createdByAdminId: 'admin_handoff',
      document: document(),
      documentFingerprint: 'document-fingerprint',
      documentVersion: 1,
      id: 'revision_handoff_target',
      revision: 1,
      salonId: TARGET_SALON_ID,
      siteId: 'site_handoff_target',
      snapshot: {} as OnboardingPersistedSnapshot,
      snapshotFingerprint: 'snapshot-fingerprint',
      snapshotVersion: 1,
    });
    await database.insert(schema.serviceSchema).values([
      {
        category: 'manicure',
        durationMinutes: 60,
        id: 'service_target_inactive',
        isActive: false,
        name: 'Inactive target service',
        price: 5000,
        salonId: TARGET_SALON_ID,
      },
      {
        category: 'manicure',
        durationMinutes: 60,
        id: 'service_other_active',
        isActive: true,
        name: 'Other salon service',
        price: 5000,
        salonId: OTHER_SALON_ID,
      },
    ]);
  }, 60_000);

  afterAll(async () => {
    await client.close();
  });

  it('ignores inactive and wrong-tenant services, then recognizes a target-salon active service', async () => {
    const input = {
      canEditSetup: true,
      locale: 'en',
      salon: {
        id: TARGET_SALON_ID,
        publicationStatus: 'draft',
        slug: 'target-studio',
      },
    };

    await expect(getOnboardingSiteHandoff(input)).resolves.toMatchObject({
      setup: { servicesAdded: false },
    });

    await database.insert(schema.serviceSchema).values({
      category: 'manicure',
      durationMinutes: 60,
      id: 'service_target_active',
      isActive: true,
      name: 'Active target service',
      price: 6500,
      salonId: TARGET_SALON_ID,
    });

    await expect(getOnboardingSiteHandoff(input)).resolves.toMatchObject({
      setup: { servicesAdded: true },
    });
    expect(mocks.integrationHealth).toHaveBeenCalledTimes(2);
    expect(mocks.integrationHealth).toHaveBeenCalledWith(TARGET_SALON_ID);
  });
});
