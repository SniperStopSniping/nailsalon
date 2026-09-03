import {
  CANONICAL_SERVICE_IDS,
  CANONICAL_SERVICES,
} from './data';
import {
  createEmptyBookingSession,
  createMenuFixture,
  normalizeSessionForLayoutChange,
  summarizeSelection,
} from './helpers';
import {
  createDefaultBookingPresentationSettings,
  parseBookingPresentationSettings,
  replaceActiveLayoutSettings,
  switchBookingLayout,
  validateBookingPresentationSettings,
} from './presentation';

describe('Booking presentation contract', () => {
  it('creates and validates the recommended Visual Grid default', () => {
    const settings = createDefaultBookingPresentationSettings();
    expect(settings.layout).toBe('visual_grid');
    expect(settings.layoutSettings).toEqual({
      density: 'comfortable',
      imageMode: 'auto',
      showFeatured: true,
      categoryNavigation: 'pills',
      showDescriptions: false,
    });
    expect(validateBookingPresentationSettings(settings)).toEqual({
      success: true,
      settings,
    });
  });

  it('retains compatible per-layout memory while switching discriminants', () => {
    const initial = createDefaultBookingPresentationSettings();
    if (initial.layout !== 'visual_grid') {
      throw new Error('Expected the default Visual Grid layout.');
    }
    const compact = replaceActiveLayoutSettings(initial, {
      ...initial.layoutSettings,
      density: 'compact',
      showDescriptions: true,
    });
    const list = switchBookingLayout(compact, 'clean_list');
    expect(list.layout).toBe('clean_list');
    expect(list.layoutSettings).toHaveProperty('showThumbnails');

    const restored = switchBookingLayout(list, 'visual_grid');
    expect(restored.layout).toBe('visual_grid');
    expect(restored.layoutSettings).toMatchObject({
      density: 'compact',
      showDescriptions: true,
    });
  });

  it('rejects incompatible, unknown, and theme settings without normalization', () => {
    const valid = createDefaultBookingPresentationSettings();
    const incompatible = {
      ...valid,
      layoutSettings: {
        density: 'comfortable',
        desktopNavigation: 'sidebar',
        mobileNavigation: 'tabs',
        showDescriptions: true,
        showCategoryCounts: true,
      },
    };
    const result = validateBookingPresentationSettings(incompatible);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.issues.join(' ')).toContain('desktopNavigation');
    }

    expect(parseBookingPresentationSettings({ ...valid, tokenPreset: 'neutral' }))
      .toBeNull();
    expect(parseBookingPresentationSettings({ ...valid, layout: 'unknown' }))
      .toBeNull();
  });

  it('rejects a mismatched layout-memory branch', () => {
    const valid = createDefaultBookingPresentationSettings();
    const result = validateBookingPresentationSettings({
      ...valid,
      layoutMemory: {
        clean_list: valid.layoutSettings,
      },
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.issues.join(' ')).toContain('showFeatured');
    }
  });
});

describe('canonical mock booking adapter', () => {
  it('keeps the accepted photos and expands the immutable shared template library', () => {
    expect(CANONICAL_SERVICES.length).toBeGreaterThan(24);
    expect(CANONICAL_SERVICE_IDS).toHaveLength(CANONICAL_SERVICES.length);
    expect(new Set(CANONICAL_SERVICE_IDS).size).toBe(CANONICAL_SERVICES.length);
    expect(Object.isFrozen(CANONICAL_SERVICES)).toBe(true);
    expect(createMenuFixture({ imageFixture: 'image_rich' }).services.filter(service => service.image)).toHaveLength(24);
    expect(createMenuFixture({ imageFixture: 'partial_images' }).services.filter(service => service.image)).toHaveLength(12);
    expect(createMenuFixture({ imageFixture: 'no_images' }).services.filter(service => service.image)).toHaveLength(0);
    expect(createMenuFixture({ menuSize: 'stress_100' }).services).toHaveLength(100);
    expect(createMenuFixture({ menuSize: 'stress_100' }))
      .toBe(createMenuFixture({ menuSize: 'stress_100' }));
  });

  it('calculates the approved Russian Manicure plus French mock result', () => {
    const summary = summarizeSelection({
      serviceId: 'svc-manicure-russian',
      addOnIds: ['addon-french'],
    });
    expect(summary?.durationLabel).toBe('1 hr 45 min');
    expect(summary?.price.label).toBe('From $80');
  });

  it('keeps customer state ephemeral and preserves intent on layout change', () => {
    const session = {
      ...createEmptyBookingSession(),
      selection: {
        serviceId: 'svc-manicure-russian',
        addOnIds: ['addon-french'],
      },
      query: 'russian',
      activeCategory: 'manicure' as const,
      detailServiceId: 'svc-manicure-russian',
      draftAddOnIds: ['addon-french'],
      handoffOpen: true,
    };
    expect(normalizeSessionForLayoutChange(session)).toEqual({
      ...session,
      query: '',
      activeCategory: 'all',
      detailServiceId: null,
      draftAddOnIds: [],
      handoffOpen: false,
    });
  });
});
