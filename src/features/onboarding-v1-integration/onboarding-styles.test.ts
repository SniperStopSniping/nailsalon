import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

describe('onboarding integration styles', () => {
  it('loads the starter chooser foundation before onboarding overrides', () => {
    const layoutSource = readFileSync(
      join(process.cwd(), 'src/app/[locale]/onboarding-v1/layout.tsx'),
      'utf8',
    );
    const foundationImport = 'src/ui/final-hybrid.css';
    const onboardingImport = 'src/onboarding/onboarding.css';

    expect(layoutSource).toContain(foundationImport);
    expect(layoutSource.indexOf(foundationImport)).toBeLessThan(
      layoutSource.indexOf(onboardingImport),
    );
  });

  it('includes the same scoped owner polish in the production route and local review', () => {
    const layoutSource = readFileSync(join(process.cwd(), 'src/app/[locale]/onboarding-v1/layout.tsx'), 'utf8');
    const labSource = readFileSync(join(process.cwd(), 'prototypes/site-builder-v2-booking-integration-lab/src/main.tsx'), 'utf8');

    expect(layoutSource).toContain('onboarding/owner-chrome-polish.css');
    expect(labSource).toContain('onboarding/owner-chrome-polish.css');
  });

  it('keeps standalone font declarations out of production routes', () => {
    for (const path of [
      'src/app/[locale]/onboarding-v1/layout.tsx',
      'src/app/[locale]/admin/website/preview/[siteId]/layout.tsx',
      'src/app/[locale]/admin/site-builder/section-gallery/layout.tsx',
    ]) {
      expect(readFileSync(join(process.cwd(), path), 'utf8')).not.toContain('standalone-fonts.css');
    }
  });
});
