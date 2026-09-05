import { describe, expect, it } from 'vitest';

import { buttonVariants } from './buttonVariants';

describe('buttonVariants', () => {
  it('adds owner workspace variants painted from the --owner-* layer', () => {
    const primary = buttonVariants({ variant: 'ownerPrimary' });

    expect(primary).toContain('rounded-full');
    expect(primary).toContain('bg-[var(--owner-accent)]');
    expect(primary).toContain('hover:bg-[var(--owner-accent-strong)]');
    expect(primary).toContain('focus-visible:ring-[var(--owner-focus)]');

    const secondary = buttonVariants({ variant: 'ownerSecondary' });

    expect(secondary).toContain('rounded-full');
    expect(secondary).toContain('border-[var(--owner-line-strong)]');
    expect(secondary).toContain('bg-[var(--owner-surface)]');
    expect(secondary).toContain('text-[var(--owner-ink)]');
  });

  it('uses no iOS system blue anywhere in the vocabulary', () => {
    for (const variant of ['default', 'brand', 'brandSoft', 'destructive', 'outline', 'secondary', 'ghost', 'link', 'ownerPrimary', 'ownerSecondary'] as const) {
      expect(buttonVariants({ variant })).not.toMatch(/#007AFF/i);
    }
  });

  it('leaves the existing variants byte-identical', () => {
    expect(buttonVariants({ variant: 'brand' })).toBe(
      'inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-semibold ring-offset-background transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 bg-[var(--theme-primary)] text-neutral-900 shadow-sm hover:brightness-95 active:scale-[0.98] h-10 px-4 py-2',
    );
    expect(buttonVariants({ variant: 'brandSoft', size: 'pill' })).toBe(
      'inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-semibold ring-offset-background transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 border border-[var(--theme-card-border)] bg-white text-neutral-700 shadow-sm hover:bg-neutral-50 active:scale-[0.99] h-12 rounded-full px-5 text-base',
    );
    expect(buttonVariants({})).toBe(
      'inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-semibold ring-offset-background transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 bg-primary text-primary-foreground hover:bg-primary/90 h-10 px-4 py-2',
    );
  });
});
