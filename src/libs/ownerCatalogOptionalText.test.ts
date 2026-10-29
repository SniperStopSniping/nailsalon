import { capabilityWriteSchema } from './ownerCapabilities.server';
import { parseAddOnGroupWrite } from './ownerCatalogGroups.server';

vi.mock('server-only', () => ({}));
vi.mock('@/libs/DB', () => ({ db: {} }));

// Omission has historically normalized to null, even though the output field
// is required. This must not make a minimal valid owner request fail before
// its authorization guard or change the persisted description contract.
describe('owner catalog optional text input compatibility', () => {
  const parsers = [
    ['capability', (fields: Record<string, unknown>) => capabilityWriteSchema.parse({ salonSlug: 'studio', name: 'Capability', ...fields })],
    ['add-on group', (fields: Record<string, unknown>) => parseAddOnGroupWrite({ salonSlug: 'studio', name: 'Group', minSelections: 0, maxSelections: null, ...fields })],
  ] as const;

  describe.each(parsers)('%s description', (_name, parse) => {
    it.each([
      [{}, null],
      [{ description: undefined }, null],
      [{ description: null }, null],
      [{ description: '' }, null],
      [{ description: '   ' }, null],
      [{ description: '  Owner description  ' }, 'Owner description'],
    ])('preserves normalized output for %j', (fields, expected) => {
      const parsed = parse(fields);

      expect(parsed).toHaveProperty('description', expected);
      expect(parsed.isActive).toBe(true);
    });

    it.each([false, 0, [], {}])('rejects a non-text description %j', (description) => {
      expect(() => parse({ description })).toThrow();
    });
  });
});
