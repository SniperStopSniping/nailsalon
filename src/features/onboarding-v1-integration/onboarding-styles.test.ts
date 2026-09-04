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
});
