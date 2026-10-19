import { z } from 'zod';

import { parseSafeHttpsUrl } from '../../../prototypes/site-builder-v2-booking-integration-lab/src/custom-design/model/actions';
import { clampNormalizedRect, rectanglesHaveInteriorOverlap, validateNormalizedRect } from '../../../prototypes/site-builder-v2-booking-integration-lab/src/custom-design/model/geometry';
import { CANVA_NATIVE_CSS, canvaNativeContentSchema, canvaNativeImages, compileCanvaNativeContent } from './canva-native-content';
import { canvaPageWidth } from './canva-quality';
import type { CustomSiteSource } from './contracts';
import { manualLinkHref, manualLinkTargetsBooking } from './manual-link';
import type { WebsiteDetails } from './website-details';

const safeWebsite = (value: string) => {
  const parsed = parseSafeHttpsUrl(value);
  if (!parsed) {
    return false;
  }
  const url = new URL(parsed);
  return (!url.port || url.port === '443') && url.hostname.includes('.') && !/^[\d.]+$|:|(?:^|\.)(?:localhost|local|internal|test)$/iu.test(url.hostname);
};
export const canvaActionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('book') }).strict(),
  z.object({ type: z.literal('service'), serviceKey: z.string().regex(/^[a-f0-9]{64}$/u) }).strict(),
  z.object({ type: z.literal('manage') }).strict(),
  z.object({ type: z.enum(['instagram', 'email', 'phone']) }).strict(),
  z.object({ type: z.literal('manual_link'), href: z.string().refine(value => manualLinkHref(value) === value, 'Use a safe website, phone, email or page link.') }).strict(),
  z.object({ type: z.literal('website'), url: z.string().max(2048).refine(safeWebsite, 'Use a public HTTPS website address without a password or custom port.') }).strict(),
]);
export const canvaAreaSchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9_-]{0,59}$/u),
  page: z.number().int().min(0).max(9),
  label: z.string().trim().min(1).max(200),
  geometry: z.object({ x: z.number(), y: z.number(), width: z.number(), height: z.number() }).strict().refine(value => validateNormalizedRect(value).length === 0, 'Keep the clickable area inside its page.'),
  action: canvaActionSchema,
  appearance: z.literal('button').optional(),
}).strict();
export const canvaAreasSchema = z.array(canvaAreaSchema).max(80).superRefine((areas, context) => {
  const ids = new Set<string>();
  for (const [index, area] of areas.entries()) {
    const destination = area.action.type === 'website' ? parseSafeHttpsUrl(area.action.url) : area.action.type === 'manual_link' && area.action.href.startsWith('https:') ? area.action.href : null;
    const disconnected = area.action.type === 'manual_link'
      ? manualLinkTargetsBooking(area.label, area.action.href)
      : destination && /\b(?:book|appointment|reserv|schedul)|acuityscheduling|calendly|booksy|fresha|vagaro/iu.test(`${area.id.replaceAll('_', ' ')} ${area.label} ${new URL(destination).hostname} ${new URL(destination).pathname.replace(/[-_/]/gu, ' ')}`);
    if (disconnected) {
      context.addIssue({ code: 'custom', message: 'Connect appointment buttons to the Luster booking menu or a service, not another website.' });
    }
    if (ids.has(area.id)) {
      context.addIssue({ code: 'custom', path: [index, 'id'], message: 'Use separate, nonoverlapping clickable areas with unique names.' });
    }
    if (area.geometry.width * area.geometry.height > 7000) {
      context.addIssue({ code: 'custom', path: [index, 'geometry'], message: 'A clickable area must not cover most of the artwork.' });
    }
    for (const other of areas.slice(0, index)) {
      if (other.page === area.page && rectanglesHaveInteriorOverlap(other.geometry, area.geometry)) {
        context.addIssue({ code: 'custom', path: [index, 'geometry'], message: `Use nonoverlapping clickable areas: ${area.id} overlaps ${other.id} on page ${area.page}.` });
      }
    }
    ids.add(area.id);
  }
});
/** The model wire contract uses fractions; saved/manual geometry stays in percent. */
const modelGeometry = z.object({
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
  width: z.number().positive().max(1),
  height: z.number().positive().max(1),
}).strict().refine(value => value.x + value.width <= 1.00000001 && value.y + value.height <= 1.00000001, 'Keep each fraction-based rectangle inside its page (x+width and y+height must be at most 1).');
const scaledGeometry = (geometry: CanvaArea['geometry'], scale: number) => ({
  x: Number((geometry.x * scale).toFixed(6)),
  y: Number((geometry.y * scale).toFixed(6)),
  width: Number((geometry.width * scale).toFixed(6)),
  height: Number((geometry.height * scale).toFixed(6)),
});
export const canvaModelAreasSchema = z.array(canvaAreaSchema.extend({ geometry: modelGeometry }).refine(area => area.action.type !== 'manual_link', 'Use saved business contact actions.')).max(80)
  .transform(areas => areas.map(area => ({ ...area, geometry: scaledGeometry(area.geometry, 100) })))
  .pipe(canvaAreasSchema);
export function canvaAreasForModel(areas: CanvaArea[]) {
  return canvaAreasSchema.parse(areas).map(area => ({ ...area, geometry: scaledGeometry(area.geometry, 0.01) }));
}
export const canvaPagePresentationSchema = z.object({
  displayMode: z.enum(['poster', 'contained', 'full_width']),
  gapAfter: z.union([z.literal(0), z.literal(8), z.literal(16)]),
  background: z.string().regex(/^#[a-f0-9]{6}$|^transparent$/iu),
}).strict();
export type CanvaPagePresentation = z.infer<typeof canvaPagePresentationSchema>;
export const canvaDesignSchema = z.object({
  version: z.literal(1),
  pages: z.array(z.object({
    id: z.string().regex(/^[a-z][\w-]{0,70}$/iu).optional(),
    assetId: z.string().uuid(),
    width: z.number().int().positive().max(40000),
    height: z.number().int().positive().max(40000),
    alt: z.string().trim().min(1).max(3000),
    // Optional additions preserve historical immutable source byte-for-byte.
    presentation: canvaPagePresentationSchema.optional(),
    anchors: z.array(z.string().regex(/^[a-z][\w-]{0,70}$/iu)).max(3).optional(),
  }).strict()).min(1).max(10),
  controls: z.array(z.object({ id: z.string().regex(/^[a-z][a-z0-9_-]{0,59}$/u), afterPage: z.number().int().min(0).max(9), label: z.string().trim().min(1).max(200), action: canvaActionSchema }).strict()).max(10).optional(),
  manualVisibility: z.object({ hours: z.boolean(), location: z.boolean() }).strict().optional(),
  manualOrigin: z.object({ siteId: z.string().uuid(), revisionId: z.string().uuid(), revision: z.number().int().positive() }).strict().optional(),
  nativeContent: canvaNativeContentSchema.optional(),
  areas: canvaAreasSchema,
  visibleText: z.string().max(16000),
  notes: z.array(z.string().max(500)).max(12),
  dataFingerprint: z.string().regex(/^[a-f0-9]{64}$/u),
  /** Added without invalidating already-published legacy artwork. */
  priceLabelsFingerprint: z.string().regex(/^[a-f0-9]{64}$/u).optional(),
  ownerReviewed: z.boolean(),
}).strict().refine(value => value.areas.every(area => area.page < value.pages.length) && (value.controls ?? []).every(control => control.afterPage < value.pages.length) && (value.nativeContent ?? []).every(block => block.beforePage <= value.pages.length) && (value.manualOrigin || canvaNativeImages(value.nativeContent).every(image => image.storageKind === 'asset')), 'Choose an existing page and authorized saved photos for each section.').superRefine((value, context) => {
  const ids = [...value.areas.map(area => area.id), ...(value.controls ?? []).map(control => control.id)];
  if (new Set(ids).size !== ids.length) {
    context.addIssue({ code: 'custom', message: 'Give each link a separate name.' });
  }
  for (const control of value.controls ?? []) {
    if (control.action.type === 'manual_link' && manualLinkTargetsBooking(control.label, control.action.href)) {
      context.addIssue({ code: 'custom', message: 'Connect appointment buttons to Luster booking.' });
    }
  }
});
export type CanvaDesign = z.infer<typeof canvaDesignSchema>;
export type CanvaAction = z.infer<typeof canvaActionSchema>;
export type CanvaArea = z.infer<typeof canvaAreaSchema>;
/** Catch effectively invisible targets without requiring crowded labels to be 44px. */
export function unusableCanvaAreas(areas: CanvaArea[], pages: { width: number; height: number }[]) {
  return areas.filter((area) => {
    const page = pages[area.page];
    return !page || area.geometry.width * 3.2 < 8 || area.geometry.height * 3.2 * page.height / page.width < 4;
  });
}
/** Enlarge invisible touch targets, never artwork or overlapping neighbours. */
export function comfortableCanvaAreas(areas: CanvaArea[], pages: { width: number; height: number }[], changedIds?: ReadonlySet<string>) {
  const result = structuredClone(areas);
  for (const area of result) {
    if (changedIds && !changedIds.has(area.id)) {
      continue;
    }
    const page = pages[area.page]!;
    const minimumWidth = 44 / Math.min(360, page.width) * 100;
    const minimumHeight = minimumWidth * page.width / page.height;
    const width = Math.max(area.geometry.width, minimumWidth);
    const height = Math.max(area.geometry.height, minimumHeight);
    const extraX = width - area.geometry.width;
    const extraY = height - area.geometry.height;
    // Adjacent contact lines may have no room for symmetric padding. Expand
    // into free space on either side while still covering the original label.
    for (const [horizontal, vertical] of [[0.5, 0.5], [0.5, 1], [0.5, 0], [1, 0.5], [0, 0.5], [1, 1], [0, 1], [1, 0], [0, 0]] as const) {
      const candidate = clampNormalizedRect({ x: area.geometry.x - extraX * horizontal, y: area.geometry.y - extraY * vertical, width, height }).rect;
      if (!result.some(other => other.id !== area.id && other.page === area.page && rectanglesHaveInteriorOverlap(candidate, other.geometry))) {
        area.geometry = candidate;
        break;
      }
    }
  }
  return result;
}
const escape = (value: string) => value.replace(/[&<>"']/gu, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', '\'': '&#39;' })[c]!);

/** Trusted presentation compiler. AI supplies positions/actions, never artwork or code. */
export function compileCanvaDesign(raw: CanvaDesign, details?: WebsiteDetails): CustomSiteSource {
  const design = canvaDesignSchema.parse(raw);
  for (const area of design.areas) {
    // Contact actions always use saved destinations. A generated label must
    // not contradict that destination for keyboard/screen-reader customers.
    if (area.action.type === 'email' && details?.email && area.label.includes('@') && !area.label.toLowerCase().includes(details.email.toLowerCase())) {
      area.label = `Email ${details.email}`.slice(0, 200);
    }
    const handle = area.label.match(/@[\w.]+/u)?.[0];
    if (area.action.type === 'instagram' && details?.instagram && handle && handle.toLowerCase().replace(/^@/u, '') !== details.instagram.toLowerCase().replace(/^@/u, '')) {
      area.label = `Instagram @${details.instagram.replace(/^@/u, '')}`;
    }
    // On a public service-selection page, this label means the full menu,
    // rather than searching for a customer's existing booking.
    if (area.action.type === 'manage' && /^show\s+all\s+(?:appointments|services)$/iu.test(area.label.trim())) {
      area.action = { type: 'book' };
    }
  }
  if (design.pages.some(page => page.presentation) || design.areas.some(area => area.action.type === 'manual_link' || area.appearance) || design.controls?.length || design.manualOrigin) {
    return compileManualCanvaDesign(design, details);
  }
  // A compressed phone screenshot should fill a phone, not become a narrow
  // column capped at its export's pixel width. Bytes and proportions stay intact.
  const css = `.canva-site{margin:0 auto;width:100%;max-width:${Math.max(...design.pages.map(canvaPageWidth))}px}.canva-page{position:relative;margin:0 auto;width:100%}.canva-page img{display:block;width:100%;height:auto}.canva-area{position:absolute;display:block;z-index:1;padding:0;border:0;background:transparent;color:transparent;text-decoration:none;cursor:pointer}.canva-area:focus-visible{outline:3px solid #8a3859;outline-offset:2px}.canva-area:disabled{cursor:default}[data-luster-canva-area][hidden]{display:none!important}.canva-accessible{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%)}.canva-accessible:focus-within{position:static;width:auto;height:auto;overflow:visible;clip-path:none;padding:20px}img{max-width:100%}`;
  const geometry: string[] = [];
  const pages = design.pages.map((page, index) => {
    geometry.push(`#luster-canva-page-${index}{max-width:${canvaPageWidth(page)}px}`);
    return `${compileCanvaNativeContent(design.nativeContent ?? [], index)}<section id="luster-canva-page-${index}" class="canva-page"><img src="asset:${page.assetId}" width="${page.width}" height="${page.height}" alt="${escape(page.alt)}">${design.areas.filter(area => area.page === index).map((area) => {
      geometry.push(`#canva-${area.id}{left:${area.geometry.x}%;top:${area.geometry.y}%;width:${area.geometry.width}%;height:${area.geometry.height}%}`);
      const contact = ['instagram', 'email', 'phone'].includes(area.action.type);
      const tag = contact || area.action.type === 'website' ? 'a' : 'button';
      const binding = contact ? ` data-luster-link="${area.action.type}"` : area.action.type === 'manage' ? ' data-luster-manage' : tag === 'button' ? ' data-luster-book' : '';
      return `<${tag} id="canva-${area.id}" class="canva-area" data-luster-canva-area="${area.id}" aria-label="${escape(area.label)}"${binding}${tag === 'button' ? ' type="button"' : ''}>${escape(area.label)}</${tag}>`;
    }).join('')}</section>`;
  }).join('');
  // An equivalent live menu/contact layer remains keyboard/screen-reader
  // accessible; focusing it reveals it without altering the exported artwork.
  const contactText = ['instagram', 'email', 'phone'].filter(key => details?.[key as keyof WebsiteDetails]).map(key => `<a data-luster-link="${key}"><span data-luster-field="details.${key}"></span></a>`).join('');
  const nativeTextIds = new Set((design.nativeContent ?? []).flatMap(block => block.type === 'about' ? block.textSectionIds : []));
  const sections = (details?.sections ?? []).filter(section => !nativeTextIds.has(section.id)).map(section => `<h2 data-luster-field="details.title_${section.id}"></h2><p data-luster-field="details.section_${section.id}"></p>`).join('');
  return { title: 'Your Canva design', html: `<main class="canva-site">${pages}${compileCanvaNativeContent(design.nativeContent ?? [], design.pages.length)}<aside class="canva-accessible" aria-label="Business details and booking"><h1 data-luster-field="business.name"></h1><p data-luster-field="business.hoursLabel"></p><p data-luster-field="details.locationDirections"></p>${contactText}${sections}<div data-luster-services></div><template data-luster-service><article><h2 data-luster-field="service.name"></h2><span data-luster-field="service.priceLabel"></span><span data-luster-field="service.durationMinutes"></span><button data-luster-book>Book this service</button></article></template></aside></main>`, css: `${css}\n${geometry.join('\n')}${design.nativeContent?.length ? `\n${CANVA_NATIVE_CSS}` : ''}`, javascript: '', analysis: 'Your uploaded artwork is preserved. Clickable areas scale with each image, and booking uses Luster. Text inside the artwork is changed by uploading an updated Canva export.', limitations: ['The artwork scales as a whole on mobile; its text does not reflow.', ...design.notes].slice(0, 12), canva: design };
}

/** Manual artwork shares the renderer, catalog bindings and exact-review guard. */
function compileManualCanvaDesign(design: CanvaDesign, details?: WebsiteDetails): CustomSiteSource {
  const styles: string[] = [];
  function link(item: { id: string; label: string; action: CanvaAction; appearance?: 'button' }, area: boolean) {
    const contact = ['instagram', 'email', 'phone'].includes(item.action.type);
    const anchor = contact || item.action.type === 'website' || item.action.type === 'manual_link';
    const tag = anchor ? 'a' : 'button';
    const binding = contact ? ` data-luster-link="${item.action.type}"` : item.action.type === 'manage' ? ' data-luster-manage' : !anchor ? ' data-luster-book' : '';
    const metadata = area ? 'data-luster-canva-area' : 'data-luster-canva-control';
    const classes = area ? `canva-area${item.appearance ? ' canva-raised-button' : ''}` : 'canva-manual-cta';
    return `<${tag} id="canva-${item.id}" class="${classes}" ${metadata}="${item.id}" aria-label="${escape(item.label)}"${binding}${!anchor ? ' type="button"' : ''}>${escape(item.label)}</${tag}>`;
  }
  const pages = design.pages.map((page, index) => {
    const presentation = page.presentation;
    const maxWidth = presentation?.displayMode === 'full_width' ? 'none' : presentation?.displayMode === 'contained' ? '1120px' : '780px';
    const background = presentation?.background ?? 'transparent';
    styles.push(`#canva-panel-${index}{background:${background};padding-bottom:${presentation?.gapAfter ?? 0}px}#luster-canva-page-${index}{max-width:${maxWidth}}`);
    if (!presentation || presentation.displayMode === 'poster') {
      styles.push(`@container luster-canva-manual (min-width:600px){#luster-canva-page-${index}{max-width:${Math.min(780, page.width)}px}}`);
    }
    const areas = design.areas.filter(area => area.page === index).map((area) => {
      styles.push(`#canva-${area.id}{left:${area.geometry.x}%;top:${area.geometry.y}%;width:${area.geometry.width}%;height:${area.geometry.height}%}`);
      return link(area, true);
    }).join('');
    const controls = (design.controls ?? []).filter(control => control.afterPage === index).map(control => link(control, false)).join('');
    const anchors = (page.anchors ?? []).map(id => `<span id="${escape(id)}"></span>`).join('');
    return `${compileCanvaNativeContent(design.nativeContent ?? [], index)}<section class="canva-manual-panel" id="canva-panel-${index}">${anchors}<div id="luster-canva-page-${index}" class="canva-page"><img src="asset:${page.assetId}" width="${page.width}" height="${page.height}" alt="${escape(page.alt)}">${areas}</div>${controls ? `<nav class="canva-manual-controls" aria-label="Design links">${controls}</nav>` : ''}</section>`;
  }).join('');
  const contacts = ['instagram', 'email', 'phone'].filter(key => details?.[key as keyof WebsiteDetails]).map(key => `<a data-luster-link="${key}"><span data-luster-field="details.${key}"></span></a>`).join('');
  const nativeTextIds = new Set((design.nativeContent ?? []).flatMap(block => block.type === 'about' ? block.textSectionIds : []));
  const sections = (details?.sections ?? []).filter(section => !nativeTextIds.has(section.id)).map(section => `<section><h2 data-luster-field="details.title_${section.id}"></h2><p data-luster-field="details.section_${section.id}"></p></section>`).join('');
  const css = `.canva-manual-site{container:luster-canva-manual/inline-size;width:100%;margin:0;color:#30282b;font-family:Arial,sans-serif}.canva-manual-panel{width:100%}.canva-page{position:relative;width:100%;margin:0 auto}.canva-page img{display:block;width:100%;height:auto}.canva-area{position:absolute;display:block;z-index:1;padding:0;border:0;background:transparent;color:transparent;text-decoration:none;cursor:pointer}.canva-raised-button,.canva-manual-cta{display:flex;align-items:center;justify-content:center;text-align:center;color:#fff;background:#72364e;border-radius:12px;font:600 16px/1.3 Arial,sans-serif;text-decoration:none;overflow-wrap:anywhere}.canva-manual-cta{min-height:44px;padding:12px 20px;border:0}.canva-manual-controls{display:flex;justify-content:center;gap:8px;flex-wrap:wrap;padding:16px}.canva-area:focus-visible,.canva-manual-cta:focus-visible{outline:3px solid #3685ff;outline-offset:3px}[data-luster-canva-area][hidden]{display:none!important}.canva-live-details{max-width:1120px;margin:0 auto;padding:24px 20px;overflow-wrap:anywhere}.canva-live-details p{white-space:pre-line}.canva-live-contacts{display:flex;gap:16px;flex-wrap:wrap}.canva-live-details [data-luster-services]{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,240px),1fr));gap:16px}.canva-live-details article{padding:20px;border:1px solid #d5c6cc;border-radius:12px}.canva-live-details article span{display:block;margin:8px 0}.canva-live-details button{min-height:44px;padding:10px 18px;background:#72364e;color:white;border:0;border-radius:8px;font:inherit}.canva-live-details a{color:#72364e;min-height:44px;display:inline-flex;align-items:center}img{max-width:100%}`;
  return {
    title: 'Your Canva design',
    html: `<main class="canva-manual-site">${pages}${compileCanvaNativeContent(design.nativeContent ?? [], design.pages.length)}<section class="canva-live-details" id="luster-canva-booking" aria-label="Current business details and booking"><h1 data-luster-field="business.name"></h1>${design.manualVisibility?.hours === false ? '' : '<p data-luster-field="business.hoursLabel"></p>'}${design.manualVisibility?.location === false ? '' : '<p data-luster-field="business.city"></p><p data-luster-field="business.address"></p><p data-luster-field="details.locationDirections"></p>'}<nav class="canva-live-contacts" aria-label="Contact">${contacts}</nav>${sections}<section data-luster-booking-policy><h2 data-luster-field="booking.policyTitle"></h2><p data-luster-field="booking.policyText"></p></section><h2>Services &amp; booking</h2><div data-luster-services></div><template data-luster-service><article><h3 data-luster-field="service.name"></h3><p data-luster-field="service.description"></p><span data-luster-field="service.priceLabel"></span><span data-luster-field="service.durationMinutes"></span><span>minutes</span><button data-luster-book>Book this service</button></article></template></section></main>`,
    css: `${css}\n${styles.join('\n')}${design.nativeContent?.length ? `\n${CANVA_NATIVE_CSS}` : ''}`,
    javascript: '',
    analysis: 'Your original artwork and manually placed links are preserved. The service menu below uses your current Luster booking details.',
    limitations: ['Text and photographs inside the artwork are changed in Canva and uploaded again. The artwork scales without reflowing its text.', ...design.notes].slice(0, 12),
    canva: design,
  };
}
