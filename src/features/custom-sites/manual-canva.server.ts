import 'server-only';

import { createHash } from 'node:crypto';

import { resolveCustomDesignAction } from '../../../prototypes/site-builder-v2-booking-integration-lab/src/custom-design/model/actions';
import { validateCustomDesignSettings } from '../../../prototypes/site-builder-v2-booking-integration-lab/src/custom-design/model/settings';
import type { CustomDesignAction, CustomDesignSettings } from '../../../prototypes/site-builder-v2-booking-integration-lab/src/custom-design/model/types';
import { SetupError } from '../business-setup/contracts';
import type { CanvaAction, CanvaDesign } from './canva';
import { canvaDesignSchema, compileCanvaDesign } from './canva';
import { canvaDataFingerprint, canvaPriceLabelsFingerprint } from './canva-data.server';
import type { CustomSiteData } from './contracts';
import { manualLinkHref } from './manual-link';
import { containsPrivateAddress } from './private-address';

const stableId = (kind: string, value: string) => `manual-${kind}-${createHash('sha256').update(value).digest('hex').slice(0, 28)}`;
export type ManualCanvaImage = { assetId: string; width: number; height: number };
export type ManualCanvaSection = { id: string; settings: CustomDesignSettings; pageId?: string };

/** Pure adapter: it cannot write a draft, approve, publish, invoke AI or book. */
export function manualCanvaSource(input: {
  sections: ManualCanvaSection[];
  images: ReadonlyMap<string, ManualCanvaImage>;
  data: CustomSiteData;
  origin: NonNullable<CanvaDesign['manualOrigin']>;
  siteBackground: string;
  visibility?: CanvaDesign['manualVisibility'];
  privateAddress?: string;
  internalAnchors?: ReadonlyMap<string, string>;
}) {
  const pages: CanvaDesign['pages'] = [];
  const areas: CanvaDesign['areas'] = [];
  const controls: NonNullable<CanvaDesign['controls']> = [];
  const visible: string[] = [];
  const claimedAnchors = new Set<string>();
  function action(value: CustomDesignAction): CanvaAction {
    if (value.type === 'start_booking') {
      return { type: 'book' };
    }
    if (value.type === 'directions' && input.privateAddress && containsPrivateAddress(value.destination.address, input.privateAddress)) {
      throw new SetupError('INVALID', 'A directions link contains your private address. Use your general area, or review address visibility first.');
    }
    const resolved = resolveCustomDesignAction(value, {
      resolveInternalHref: (pageId, sectionId) => input.internalAnchors?.get(sectionId ?? pageId) ?? null,
    });
    const href = resolved.status === 'resolved' ? manualLinkHref(resolved.href) : null;
    if (!href) {
      throw new SetupError('INVALID', 'One of your design links needs checking. Open your design and choose a valid destination before continuing.');
    }
    if (input.privateAddress && containsPrivateAddress(href, input.privateAddress)) {
      throw new SetupError('INVALID', 'A design link contains your private address. Use your general area, or review address visibility first.');
    }
    return { type: 'manual_link', href };
  }
  for (const section of input.sections) {
    const parsed = validateCustomDesignSettings(section.settings);
    if (!parsed.success) {
      throw new SetupError('INVALID', 'Your saved design needs checking. Return to the design editor before continuing.');
    }
    const settings = parsed.value;
    const start = pages.length;
    for (const [index, image] of settings.images.entries()) {
      const stored = input.images.get(image.id);
      if (!stored || !stored.width || !stored.height) {
        throw new SetupError('NOT_READY', 'Your design images have not finished saving. Retry the images before continuing.');
      }
      if (Math.abs((stored.width / stored.height) / (image.width / image.height) - 1) > 0.01) {
        throw new SetupError('INVALID', 'An image changed proportions. Check its clickable areas in the design editor before continuing.');
      }
      const page = pages.length;
      const anchors = index === 0
        ? [section.pageId, section.id].flatMap((id) => {
            const anchor = id && input.internalAnchors?.get(id)?.slice(1);
            if (!anchor || claimedAnchors.has(anchor)) {
              return [];
            }
            claimedAnchors.add(anchor);
            return [anchor];
          })
        : [];
      pages.push({
        id: stableId('page', `${section.id}:${image.id}`),
        ...stored,
        alt: (image.accessibleSummary || image.altText || `${input.data.business.name} — design page ${page + 1}`).slice(0, 3000),
        presentation: { displayMode: settings.displayMode, gapAfter: index === settings.images.length - 1 ? 0 : settings.gap === 'small' ? 8 : settings.gap === 'comfortable' ? 16 : 0, background: settings.background.mode === 'custom' ? settings.background.color : settings.background.mode === 'transparent' ? 'transparent' : input.siteBackground },
        ...(anchors.length ? { anchors } : {}),
      });
      visible.push(image.accessibleSummary ?? '', image.altText);
      for (const area of [...image.interactiveAreas].sort((a, b) => a.semanticOrder - b.semanticOrder)) {
        if (!area.labelConfirmed || area.validationStatus !== 'valid' || area.reviewStatus !== 'approved') {
          throw new SetupError('NOT_READY', 'Check and approve the highlighted links in your design before continuing.');
        }
        areas.push({ id: stableId('area', `${section.id}:${image.id}:${area.id}`), page, label: area.accessibleLabel, geometry: structuredClone(area.geometry), action: action(area.action), ...(area.appearance ? { appearance: area.appearance } : {}) });
      }
    }
    if (settings.cta.type !== 'none') {
      const cta = settings.cta;
      const placement = cta.placement;
      const page = placement.type === 'after_all' ? pages.length - 1 : start + settings.images.findIndex(image => image.id === placement.imageItemId);
      if (page < start || page >= pages.length) {
        throw new SetupError('INVALID', 'Choose where your booking button belongs in the design editor.');
      }
      controls.push({ id: stableId('cta', section.id), afterPage: page, label: cta.label, action: cta.type === 'book_now' ? { type: 'book' } : action(cta.action) });
    }
  }
  const design = canvaDesignSchema.parse({ version: 1, pages, areas, controls, manualOrigin: input.origin, ...(input.visibility ? { manualVisibility: input.visibility } : {}), visibleText: visible.filter(Boolean).join('\n').slice(0, 16000), notes: [], dataFingerprint: canvaDataFingerprint(input.data), priceLabelsFingerprint: canvaPriceLabelsFingerprint(input.data), ownerReviewed: false });
  return compileCanvaDesign(design, input.data.details);
}
