/**
 * S3 / S7 (Stage 1) — the route-classification matrix.
 *
 * The nine tenant routes that returned HTTP 200 for
 * `publicationStatus: 'draft'` + `freeSoloEnabled: false` are not equivalent,
 * and Stage 1 deliberately treats them differently. (The matrix below also
 * covers `manage/[token]/calendar.ics`, a Route Handler that inherits no
 * layout and is therefore listed with the token class even though it is not
 * one of the nine page routes.)
 *
 *   A  anonymous salon-by-slug   -> publication-gated (find-booking)
 *   B  capability-token          -> NOT publication-gated; projection minimized
 *   C  generic/content-free      -> publication-gated (booking-disabled,
 *                                   cancelled, suspended, rewards-disabled)
 *   E  Stripe re-entry           -> exempt, with a recorded reason + this proof
 *
 * The guard itself is unit-tested; the per-route wiring is asserted at source
 * level, because a Next server component cannot be invoked without a request
 * and the thing worth pinning is exactly "does this route call the guard".
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND');
  },
  redirect: () => {
    throw new Error('NEXT_REDIRECT');
  },
}));

const queries = vi.hoisted(() => ({ getSalonBySlug: vi.fn() }));
vi.mock('./queries', () => queries);
vi.mock('next/headers', () => ({ cookies: async () => ({ get: () => undefined }) }));

/* eslint-disable import/first */
import { requirePublishedTenantSalon } from './tenant';
/* eslint-enable import/first */

function readSource(relativePath: string): string {
  return readFileSync(path.join(process.cwd(), relativePath), 'utf8');
}

describe('S3 — requirePublishedTenantSalon', () => {
  it('returns the salon when it is published', async () => {
    queries.getSalonBySlug.mockResolvedValueOnce({
      id: 's1',
      slug: 'isla',
      name: 'Isla',
      publicationStatus: 'published',
    });

    await expect(requirePublishedTenantSalon('isla')).resolves.toMatchObject({ id: 's1' });
  });

  it('404s an UNPUBLISHED salon — the D-20 combination', async () => {
    queries.getSalonBySlug.mockResolvedValueOnce({
      id: 's1',
      slug: 'isla',
      name: 'Isla',
      publicationStatus: 'draft',
      // The combination the layout gate provably misses: `isDraftSalon`
      // requires freeSoloEnabled, so the layout returns allowed:true here.
      freeSoloEnabled: false,
    });

    await expect(requirePublishedTenantSalon('isla')).rejects.toThrow('NEXT_NOT_FOUND');
  });

  it('404s an unpublished salon with freeSoloEnabled TRUE as well — no inversion', async () => {
    queries.getSalonBySlug.mockResolvedValueOnce({
      id: 's1',
      slug: 'isla',
      name: 'Isla',
      publicationStatus: 'draft',
      freeSoloEnabled: true,
    });

    await expect(requirePublishedTenantSalon('isla')).rejects.toThrow('NEXT_NOT_FOUND');
  });

  it('NO EXISTENCE ORACLE: a nonexistent slug produces the identical outcome', async () => {
    queries.getSalonBySlug.mockResolvedValueOnce(null);

    await expect(requirePublishedTenantSalon('nope')).rejects.toThrow('NEXT_NOT_FOUND');
  });
});

describe('S3 — route classification matrix', () => {
  const GATED = [
    ['A anonymous salon-by-slug', 'src/app/[locale]/[slug]/find-booking/page.tsx'],
    ['C generic status', 'src/app/[locale]/[slug]/booking-disabled/page.tsx'],
    ['C generic status', 'src/app/[locale]/[slug]/cancelled/page.tsx'],
    ['C generic status', 'src/app/[locale]/[slug]/suspended/page.tsx'],
    ['C generic status', 'src/app/[locale]/[slug]/rewards-disabled/page.tsx'],
  ] as const;

  it.each(GATED)('%s — %s calls the publication guard', (_label, file) => {
    expect(readSource(file)).toContain('requirePublishedTenantSalon');
  });

  const TOKEN_NOT_GATED = [
    'src/app/[locale]/[slug]/manage/[token]/page.tsx',
    'src/app/[locale]/[slug]/manage/[token]/reschedule/page.tsx',
    'src/app/[locale]/[slug]/manage/[token]/calendar.ics/route.ts',
  ] as const;

  it.each(TOKEN_NOT_GATED)(
    'B capability-token — %s is NOT publication-gated (a paid client must not be stranded)',
    (file) => {
      expect(readSource(file)).not.toContain('requirePublishedTenantSalon');
    },
  );

  const DEPOSIT = [
    'src/app/[locale]/[slug]/deposit/return/page.tsx',
    'src/app/[locale]/[slug]/deposit/cancel/page.tsx',
  ] as const;

  it.each(DEPOSIT)('E Stripe re-entry — %s is exempt AND exposes no salon data', (file) => {
    const source = readSource(file);

    expect(source).not.toContain('requirePublishedTenantSalon');
    // The exemption is recorded in-source rather than left accidental.
    expect(source).toContain('S3 (Stage 1) — DELIBERATELY NOT publication-gated');
    // ...and it is safe because the page reads no salon field at all.
    expect(source).not.toMatch(/\bsalon\./);
    expect(source).not.toContain('getSalonBySlug');
    expect(source).not.toContain('requireResolvedSalon');
  });

  it('the four booking-step pages keep their EXISTING checkSalonStatus gate, untouched', () => {
    for (const step of ['service', 'tech', 'time', 'confirm']) {
      const routeSource = readSource(`src/app/(unauth)/book/${step}/page.tsx`);
      const source = step === 'service'
        ? readSource('src/app/(unauth)/book/service/BookServicePageServer.tsx')
        : routeSource;

      if (step === 'service') {
        // Next route modules may export only the App Router surface. Pin the
        // public wrapper to the one shared server implementation as well as
        // pinning the implementation's original Stage 1 status checks.
        expect(routeSource).toContain('from \'./BookServicePageServer\'');
        expect(routeSource).toContain('return renderBookServicePage(props)');
      }

      expect(source).toContain('checkSalonStatus');
      expect(source).toContain('allowUnpublishedPreview');
      expect(source).not.toContain('requirePublishedTenantSalon');
    }
  });

  it('ownerPreview draft classification was NOT widened', () => {
    expect(readSource('src/libs/ownerPreview.ts')).toContain(
      'const isDraftSalon = salon.freeSoloEnabled && salon.publicationStatus !== \'published\';',
    );
  });

  it('salonStatus publication gate is unchanged', () => {
    expect(readSource('src/libs/salonStatus.ts')).toContain(
      'if (!isPublished && !options?.allowUnpublishedPreview) {',
    );
  });
});

describe('S7 — token surfaces expose the minimum contact surface', () => {
  it('the manage actions component no longer accepts a salon email at all', () => {
    const source = readSource(
      'src/app/[locale]/[slug]/manage/[token]/ManageAppointmentActions.tsx',
    );
    // Assert on CODE, not prose: the doc comment above the component
    // deliberately explains why the field was removed.
    const code = source.replace(/\/\*\*[\s\S]*?\*\//g, '');

    expect(code).not.toContain('salonEmail');
    expect(code).not.toContain('mailto:');
    expect(code).toMatch(/cutoffHours, salonPhone \}/);
  });

  it('the manage view redacts the phone through the SAME landed rule the public surfaces use', () => {
    const source = readSource(
      'src/app/[locale]/[slug]/manage/[token]/ManageAppointmentView.tsx',
    );

    expect(source).toContain('applyPhoneDisplayMode(');
    expect(source).toContain('locationDisplayMode');
    expect(source).not.toMatch(/salonPhone=\{capability\.salonPhone\}/);
    expect(source).not.toContain('salonEmail={capability.salonEmail}');
  });

  it('the token API selects no salon contact PII it does not serialize', () => {
    expect(
      readSource('src/app/api/public/appointments/manage/[token]/route.ts'),
    ).not.toContain('salonEmail: salonSchema.email');
  });

  it('the ICS export carries salon NAME only — no contact PII', () => {
    const source = readSource(
      'src/app/[locale]/[slug]/manage/[token]/calendar.ics/route.ts',
    );

    expect(source).toContain('capability.salonName');
    expect(source).not.toContain('salonPhone');
    expect(source).not.toContain('salonEmail');
    // Still token-authenticated and slug-bound.
    expect(source).toContain('verifyAppointmentAccessToken');
    expect(source).toContain('capability.salonSlug !== context.params.slug');
  });
});
