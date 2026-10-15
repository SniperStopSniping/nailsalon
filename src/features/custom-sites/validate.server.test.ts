import { describe, expect, it, vi } from 'vitest';

import { validateCustomSource } from './validate.server';

vi.mock('server-only', () => ({}));
const source = { title: 'Original', html: '<main><h1 data-luster-field="business.name"></h1><div data-luster-services></div><template data-luster-service><article><span data-luster-field="service.name"></span><button data-luster-book>Book</button></article></template></main>', css: 'main{display:grid;grid-template-columns:2fr 1fr}@media(max-width:600px){main{display:block}}', javascript: '', analysis: '', limitations: [] };

describe('custom frontend source validation', () => {
  it('preserves original markup and responsive CSS without mapping to presets', () => {
    const result = validateCustomSource(source, new Set());

    expect(result.css).toBe(source.css);
    expect(result.html).toContain('<article>');
  });

  it.each(['<script>parent.location="/admin"</script>', '<img src="https://attacker.invalid/x">', '<img onerror="alert(1)">', '<iframe src="/admin"></iframe>', '<form action="/api/appointments"></form>', '<meta http-equiv="refresh" content="0;url=https://attacker.invalid">', '<svg><foreignObject><script>alert(1)</script></foreignObject></svg>'])('rejects active markup or external content: %s', (html) => {
    expect(() => validateCustomSource({ ...source, html: source.html + html }, new Set())).toThrow();
  });

  it.each(['@import "https://evil.invalid";', 'a{background:u/**/rl(https://evil.invalid)}', 'a{background:\\75rl(https://evil.invalid)}', 'a{background:image-set("https://evil.invalid")}'])('rejects CSS network resources: %s', (css) => {
    expect(() => validateCustomSource({ ...source, css }, new Set())).toThrow();
  });

  it('permits approved image identities and rejects reference or cross-tenant images', () => {
    expect(validateCustomSource({ ...source, html: `${source.html}<img src="asset:photo" alt="Work">` }, new Set(['photo'])).html).toContain('asset:photo');
    expect(() => validateCustomSource({ ...source, html: `${source.html}<img src="asset:other" alt="Work">` }, new Set(['photo']))).toThrow();
  });

  it('permits bounded image loading hints without allowing new resource URLs', () => {
    const image = '<img src="asset:photo" alt="Work" loading="lazy" decoding="async" fetchpriority="high">';

    expect(validateCustomSource({ ...source, html: source.html + image }, new Set(['photo'])).html).toContain('loading="lazy"');
    expect(() => validateCustomSource({ ...source, html: source.html + image.replace('lazy', 'https://evil.invalid') }, new Set(['photo']))).toThrow();
    expect(() => validateCustomSource({ ...source, html: `${source.html}<div loading="lazy"></div>` }, new Set())).toThrow();
    expect(() => validateCustomSource({ ...source, html: source.html + image.replace('asset:photo', 'https://evil.invalid/image') }, new Set(['photo']))).toThrow();
  });

  it('rejects missing booking integrations and syntactically invalid interactions', () => {
    expect(() => validateCustomSource({ ...source, html: '<h1>Disconnected site</h1>' }, new Set())).toThrow();
    expect(() => validateCustomSource({ ...source, html: '<div data-luster-services></div><button data-luster-book>Book</button>' }, new Set())).toThrow();
    expect(() => validateCustomSource({ ...source, javascript: 'function (' }, new Set())).toThrow();
  });

  it('requires generated sites to bind live names, prices, times and service booking', () => {
    expect(() => validateCustomSource(source, new Set(), true)).toThrow('live name, price, duration');

    const connected = { ...source, html: source.html.replace('<button', '<span data-luster-field="service.priceLabel"></span><span data-luster-field="service.durationMinutes"></span><button') };

    expect(validateCustomSource(connected, new Set(), true).html).toContain('service.priceLabel');
    expect(() => validateCustomSource({ ...connected, html: `${connected.html}<p>BIAB $65</p>` }, new Set(), true)).toThrow('copied price text');
  });
});
