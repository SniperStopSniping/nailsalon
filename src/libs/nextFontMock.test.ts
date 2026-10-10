import { describe, expect, it } from 'vitest';

describe('Next font test module', () => {
  it('resolves dynamic imports without inventing a thenable module', async () => {
    const fonts = await import('next/font/google');

    expect(Reflect.get(fonts, 'then')).toBeUndefined();
    expect(fonts.Inter({ subsets: ['latin'] }).className).toBe('font-mock');
    expect(fonts.Newsreader({ subsets: ['latin'] }).variable).toBe('font-mock-variable');
  }, 1000);
});
