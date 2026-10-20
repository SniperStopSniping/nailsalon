import { describe, expect, it } from 'vitest';

import type { CanvaArea } from './canva';
import { comfortableCanvaAreas } from './canva';
import { applyCanvaAreaChanges, canvaGenerationOutputSchema, retainedCanvaText } from './canva-generation';

const area = (id: string, page = 0): CanvaArea => ({ id, page, label: 'Book now', action: { type: 'book' }, geometry: { x: 10, y: 20, width: 50, height: 5 } });

describe('incremental Canva generation', () => {
  it('retains omitted manual destinations and button appearance when another link changes', () => {
    const original = [{ ...area('manual'), action: { type: 'manual_link' as const, href: '#details' } }, { ...area('booking', 1), appearance: 'button' as const }];
    const updated = { ...area('booking', 1), label: 'Choose your appointment' };
    const result = applyCanvaAreaChanges(original, [updated], []);

    expect(result).toEqual([original[0], { ...updated, appearance: 'button' }]);
    expect(original[1]!.label).toBe('Book now');
  });

  it('removes only explicitly named existing areas and leaves controls outside the model contract', () => {
    expect(applyCanvaAreaChanges([area('first'), area('second', 1)], [], ['first'])).toEqual([area('second', 1)]);

    for (const removed of [['unknown'], ['first', 'first']]) {
      expect(() => applyCanvaAreaChanges([area('first')], [], removed)).toThrow();
    }

    expect(() => applyCanvaAreaChanges([area('first')], [area('first')], ['first'])).toThrow();
  });

  it('rejects collisions, duplicated updates and exceeding the complete saved 80-area bound', () => {
    expect(() => applyCanvaAreaChanges([area('original')], [area('overlap')], [])).toThrow();
    expect(() => applyCanvaAreaChanges([], [area('duplicate'), area('duplicate')], [])).toThrow();

    const original = Array.from({ length: 80 }, (_, index) => ({ ...area(`link_${index}`, Math.floor(index / 8)), geometry: { x: 5, y: 2 + (index % 8) * 10, width: 80, height: 5 } }));

    expect(applyCanvaAreaChanges(original, [], [])).toEqual(original);
    expect(() => applyCanvaAreaChanges(original, [{ ...area('too_many', 0), geometry: { x: 5, y: 85, width: 80, height: 5 } }], [])).toThrow();
  });

  it('supports ten pages and 80 fractional updates while rejecting executable or publication fields', () => {
    const areas = Array.from({ length: 80 }, (_, index) => ({ ...area(`link_${index}`, Math.floor(index / 8)), geometry: { x: 0.05, y: 0.02 + (index % 8) * 0.1, width: 0.8, height: 0.05 } }));
    const output = { areas, visibleText: '', notes: [], altText: Array.from({ length: 10 }, (_, index) => `Design page ${index + 1}`) };

    expect(canvaGenerationOutputSchema.parse(output).areas).toHaveLength(80);
    expect(canvaGenerationOutputSchema.parse(output).removeAreaIds).toEqual([]);
    expect(canvaGenerationOutputSchema.safeParse({ ...output, altText: [...output.altText, 'Too many'] }).success).toBe(false);
    expect(canvaGenerationOutputSchema.safeParse({ ...output, publish: true }).success).toBe(false);
    expect(canvaGenerationOutputSchema.safeParse({ ...output, controls: [] }).success).toBe(false);
  });

  it('pads only changed targets without moving a saved neighboring link', () => {
    const previous = { ...area('unchanged'), geometry: { x: 80, y: 20, width: 3, height: 2 } };
    const changed = { ...area('changed'), geometry: { x: 5, y: 20, width: 3, height: 2 } };
    const result = comfortableCanvaAreas([previous, changed], [{ width: 300, height: 900 }], new Set(['changed']));

    expect(result[0]).toEqual(previous);
    expect(result[1]!.geometry.width).toBeGreaterThan(changed.geometry.width);
  });

  it('retains known image facts during a partial rescan without silently truncating privacy checks', () => {
    expect(retainedCanvaText('Known contact and policies', 'Known contact')).toBe('Known contact and policies');
    expect(retainedCanvaText('Known contact', 'Known contact and policies')).toBe('Known contact and policies');
    expect(retainedCanvaText('Known contact', 'New policy')).toBe('Known contact\nNew policy');
    expect(() => retainedCanvaText('A'.repeat(16000), 'New private address')).toThrow();
  });
});
