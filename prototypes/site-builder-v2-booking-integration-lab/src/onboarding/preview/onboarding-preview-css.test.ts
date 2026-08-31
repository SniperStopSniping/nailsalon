import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

describe('standalone preview CSS contract', () => {
  it('owns the visually-hidden treatment used by product-route consumers', () => {
    const css = readFileSync(resolve('src/onboarding/onboarding.css'), 'utf8');
    const rule = css.match(
      /\.onboarding-preview-stage \.visually-hidden\s*\{(?<declarations>[^}]+)\}/u,
    );

    expect(rule?.groups?.declarations).toContain('position: absolute !important');
    expect(rule?.groups?.declarations).toContain('clip: rect(0, 0, 0, 0) !important');
    expect(rule?.groups?.declarations).toContain('width: 1px !important');
  });
});
