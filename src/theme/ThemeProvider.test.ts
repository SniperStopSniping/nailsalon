import { describe, expect, it } from 'vitest';

import { themeVars } from './ThemeProvider';

describe('themeVars', () => {
  it('keeps usable default colors when portal content cannot inherit theme variables', () => {
    expect(themeVars.primary).toBe('var(--theme-primary, #D6A249)');
    expect(themeVars.background).toBe('var(--theme-background, #FDF7F0)');
    expect(themeVars.titleText).toBe('var(--theme-title-text, #3F2B24)');
    expect(themeVars.cardBorder).toBe('var(--theme-card-border, #F0E6DE)');
  });
});
