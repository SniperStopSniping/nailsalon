import { describe, expect, it } from 'vitest';

import { CUSTOM_DESIGN_BACKUP_WARNING } from '../custom-design/model/constants';
import { createDefaultCustomDesignSettings } from '../custom-design/model/settings';
import type {
  CustomDesignImageItem,
  CustomDesignSettings,
} from '../custom-design/model/types';
import {
  applyHistoryCommand,
  collectCustomDesignAssetIds,
  collectReachableCustomDesignAssetIds,
  createHistoryState,
  undoHistory,
} from './history';
import { createDeterministicIdFactory } from './ids';
import {
  addPage,
  addSection,
  moveSectionToPage,
  removePage,
  removeSection,
  restorePage,
  restoreSection,
  setSectionVisible,
  updateCustomDesignSectionSettings,
  updateSectionSettings,
} from './operations';
import { initializeStarter } from './starters';
import type {
  CustomDesignSectionInstance,
  SiteBuilderDocument,
} from './types';
import {
  exportSiteBuilderBackup,
  exportSiteBuilderDocument,
  parseSiteBuilderDocument,
  validateSiteBuilderDocument,
} from './validation';

const image = (
  id: string,
  overrides: Partial<CustomDesignImageItem> = {},
): CustomDesignImageItem => ({
  id,
  assetId: `asset_${id}`,
  fileName: `${id}.png`,
  mimeType: 'image/png',
  fileSize: 2_048,
  width: 1_000,
  height: 2_000,
  aspectRatio: 0.5,
  altText: 'A branded nail studio policy poster',
  decorative: false,
  interactiveAreas: [],
  ...overrides,
});

const settingsWith = (
  images: CustomDesignImageItem[],
): CustomDesignSettings => ({
  ...createDefaultCustomDesignSettings(),
  images,
});

const addCustomDesign = (
  document: SiteBuilderDocument,
  seed: string,
): { document: SiteBuilderDocument; section: CustomDesignSectionInstance } => {
  const home = document.pages.find((page) => page.isHome);
  if (!home) throw new Error('Missing Home.');
  const next = addSection(
    document,
    { pageId: home.id, sectionType: 'custom_design' },
    createDeterministicIdFactory(seed),
  );
  const section = next.pages
    .flatMap((page) => page.sections)
    .find(
      (candidate): candidate is CustomDesignSectionInstance =>
        candidate.sectionType === 'custom_design',
    );
  if (!section) throw new Error('Missing Custom Design.');
  return { document: next, section };
};

describe('universal Custom Design section model', () => {
  it('adds one visible default section without changing any starter', () => {
    for (const starter of ['quick_book', 'one_page', 'multi_page'] as const) {
      const initial = initializeStarter(starter, {
        idFactory: createDeterministicIdFactory(`starter-${starter}`),
      });
      expect(initial.pages.flatMap((page) => page.sections)).not.toContainEqual(
        expect.objectContaining({ sectionType: 'custom_design' }),
      );
    }

    const initial = initializeStarter('quick_book', {
      idFactory: createDeterministicIdFactory('base'),
    });
    const added = addCustomDesign(initial, 'custom');
    expect(added.section).toEqual({
      id: 'section_custom_1',
      sectionType: 'custom_design',
      label: 'Custom Design',
      order: 3,
      visible: true,
      settings: createDefaultCustomDesignSettings(),
    });
    expect(added.section).not.toHaveProperty('hidden');
    expect(validateSiteBuilderDocument(added.document).success).toBe(true);
  });

  it('uses universal visibility and the existing remove/restore model', () => {
    const initial = initializeStarter('quick_book', {
      idFactory: createDeterministicIdFactory('visibility-base'),
    });
    const added = addCustomDesign(initial, 'visibility');
    const hidden = setSectionVisible(added.document, added.section.id, false);
    expect(hidden.pages[0]?.sections.find(
      (section) => section.id === added.section.id,
    )).toMatchObject({ visible: false });

    const removed = removeSection(hidden, added.section.id);
    expect(removed.unusedSections[0]).toMatchObject({
      id: added.section.id,
      sectionType: 'custom_design',
      visible: false,
    });
    const restored = restoreSection(
      removed,
      added.section.id,
      removed.pages[0]!.id,
      1,
    );
    expect(restored.unusedSections).toHaveLength(0);
    expect(restored.pages[0]?.sections[0]).toMatchObject({
      id: added.section.id,
      visible: false,
    });
  });

  it('preserves Custom Design through cross-page move and page restoration', () => {
    const ids = createDeterministicIdFactory('page');
    const initial = initializeStarter('quick_book', { idFactory: ids });
    const added = addCustomDesign(initial, 'page-custom');
    const withPage = addPage(added.document, { name: 'Policies' }, ids);
    const policies = withPage.pages.find((page) => page.name === 'Policies');
    if (!policies) throw new Error('Missing Policies.');
    const moved = moveSectionToPage(withPage, added.section.id, policies.id);
    const removed = removePage(moved, policies.id);
    expect(removed.unusedSections).toContainEqual(
      expect.objectContaining({ id: added.section.id, sectionType: 'custom_design' }),
    );
    const restored = restorePage(removed, policies.id);
    expect(restored.pages.find((page) => page.id === policies.id)?.sections)
      .toContainEqual(expect.objectContaining({ id: added.section.id }));
  });

  it('updates strict settings as one history entry and rejects placeholder edits', () => {
    const initial = initializeStarter('quick_book', {
      idFactory: createDeterministicIdFactory('history-base'),
    });
    const added = addCustomDesign(initial, 'history-custom');
    const nextSettings = settingsWith([image('poster')]);
    let history = createHistoryState(added.document);
    history = applyHistoryCommand(history, {
      type: 'update_custom_design_settings',
      sectionId: added.section.id,
      settings: nextSettings,
    });
    expect(history.past).toHaveLength(1);
    expect(collectCustomDesignAssetIds(history.present)).toEqual(
      new Set(['asset_poster']),
    );
    const noOp = applyHistoryCommand(history, {
      type: 'update_custom_design_settings',
      sectionId: added.section.id,
      settings: nextSettings,
    });
    expect(noOp).toBe(history);
    expect(() => updateSectionSettings(
      history.present,
      added.section.id,
      { note: 'Not a placeholder.' },
    )).toThrow('Use Custom Design settings');
  });

  it('retains asset references through Undo and drops them after history eviction', () => {
    const initial = initializeStarter('quick_book', {
      idFactory: createDeterministicIdFactory('refs-base'),
    });
    const added = addCustomDesign(initial, 'refs-custom');
    let history = createHistoryState(added.document);
    history = applyHistoryCommand(history, {
      type: 'update_custom_design_settings',
      sectionId: added.section.id,
      settings: settingsWith([image('reachable')]),
    });
    history = applyHistoryCommand(history, {
      type: 'update_custom_design_settings',
      sectionId: added.section.id,
      settings: createDefaultCustomDesignSettings(),
    });
    expect(collectCustomDesignAssetIds(history.present)).toEqual(new Set());
    expect(collectReachableCustomDesignAssetIds(history)).toEqual(
      new Set(['asset_reachable']),
    );
    history = undoHistory(history);
    expect(collectCustomDesignAssetIds(history.present)).toEqual(
      new Set(['asset_reachable']),
    );
    history = applyHistoryCommand(history, {
      type: 'set_section_visible',
      sectionId: added.section.id,
      visible: false,
    }, { limit: 0 });
    expect(collectReachableCustomDesignAssetIds(history)).toEqual(
      new Set(['asset_reachable']),
    );
    history = applyHistoryCommand(history, {
      type: 'update_custom_design_settings',
      sectionId: added.section.id,
      settings: createDefaultCustomDesignSettings(),
    }, { limit: 0 });
    expect(collectReachableCustomDesignAssetIds(history)).toEqual(new Set());
  });
});

describe('Custom Design import, export, and document invariants', () => {
  it('accepts legacy hidden only at import and never writes it canonically', () => {
    const initial = initializeStarter('quick_book', {
      idFactory: createDeterministicIdFactory('legacy-base'),
    });
    const added = addCustomDesign(initial, 'legacy-custom');
    const legacy = JSON.parse(exportSiteBuilderDocument(added.document)) as {
      pages: Array<{ sections: Array<Record<string, unknown>> }>;
    };
    const section = legacy.pages[0]?.sections.find(
      (candidate) => candidate.sectionType === 'custom_design',
    );
    if (!section) throw new Error('Missing legacy section.');
    delete section.visible;
    section.hidden = true;

    const imported = parseSiteBuilderDocument(JSON.stringify(legacy));
    expect(imported.success).toBe(true);
    if (!imported.success) return;
    const normalized = imported.document.pages[0]?.sections.find(
      (candidate) => candidate.sectionType === 'custom_design',
    );
    expect(normalized).toMatchObject({ visible: false });
    expect(normalized).not.toHaveProperty('hidden');
    expect(exportSiteBuilderDocument(imported.document)).not.toContain('"hidden"');
  });

  it('rejects contradictory legacy and universal visibility values', () => {
    const initial = initializeStarter('quick_book', {
      idFactory: createDeterministicIdFactory('conflict-base'),
    });
    const added = addCustomDesign(initial, 'conflict-custom');
    const conflicting = JSON.parse(exportSiteBuilderDocument(added.document)) as {
      pages: Array<{ sections: Array<Record<string, unknown>> }>;
    };
    const section = conflicting.pages[0]?.sections.find(
      (candidate) => candidate.sectionType === 'custom_design',
    );
    if (!section) throw new Error('Missing conflicting section.');
    section.hidden = true;
    const result = parseSiteBuilderDocument(JSON.stringify(conflicting));
    expect(result).toMatchObject({
      success: false,
      issues: expect.arrayContaining([
        expect.stringContaining('contradictory visible and legacy hidden'),
      ]),
    });
    expect(validateSiteBuilderDocument(conflicting).success).toBe(false);
  });

  it('round-trips raw documents and truthful versioned backup envelopes', () => {
    const initial = initializeStarter('quick_book', {
      idFactory: createDeterministicIdFactory('backup-base'),
    });
    const added = addCustomDesign(initial, 'backup-custom');
    const document = updateCustomDesignSectionSettings(
      added.document,
      added.section.id,
      settingsWith([image('backup')]),
    );
    expect(parseSiteBuilderDocument(exportSiteBuilderDocument(document))).toEqual({
      success: true,
      document,
    });

    const json = exportSiteBuilderBackup(
      document,
      '2026-08-27T12:00:00.000Z',
    );
    const envelope = JSON.parse(json) as {
      customDesignAssets: {
        assets: Array<{ fileName: string }>;
        assetsIncluded: boolean;
        warning: string;
      };
    };
    expect(envelope.customDesignAssets).toMatchObject({
      assetsIncluded: false,
      warning: CUSTOM_DESIGN_BACKUP_WARNING,
    });
    expect(parseSiteBuilderDocument(json)).toEqual({
      success: true,
      document,
    });

    envelope.customDesignAssets.assets[0]!.fileName = 'mismatch.png';
    expect(parseSiteBuilderDocument(JSON.stringify(envelope))).toMatchObject({
      success: false,
      issues: [
        'Custom Design asset manifest does not match the imported document.',
      ],
    });
  });

  it('rejects duplicate nested IDs and conflicting shared-asset metadata', () => {
    const initial = initializeStarter('quick_book', {
      idFactory: createDeterministicIdFactory('ids-base'),
    });
    const first = addCustomDesign(initial, 'ids-first');
    const home = first.document.pages[0]!;
    const secondDocument = addSection(
      first.document,
      { pageId: home.id, sectionType: 'custom_design' },
      createDeterministicIdFactory('ids-second'),
    );
    const customSections = secondDocument.pages[0]?.sections.filter(
      (section): section is CustomDesignSectionInstance =>
        section.sectionType === 'custom_design',
    ) ?? [];
    const second = customSections.find((section) => section.id !== first.section.id);
    if (!second) throw new Error('Missing second Custom Design.');

    const withFirst = updateCustomDesignSectionSettings(
      secondDocument,
      first.section.id,
      settingsWith([image('duplicate')]),
    );
    expect(() => updateCustomDesignSectionSettings(
      withFirst,
      second.id,
      settingsWith([image('duplicate', { assetId: 'asset_other' })]),
    )).toThrow('image item ID duplicate is duplicated');

    expect(() => updateCustomDesignSectionSettings(
      withFirst,
      second.id,
      settingsWith([image('other', {
        assetId: 'asset_duplicate',
        width: 2_000,
        height: 2_000,
        aspectRatio: 1,
      })]),
    )).toThrow('conflicting image metadata');
  });
});
