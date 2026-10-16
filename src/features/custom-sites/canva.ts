import { z } from 'zod';

import { parseSafeHttpsUrl } from '../../../prototypes/site-builder-v2-booking-integration-lab/src/custom-design/model/actions';
import { clampNormalizedRect, rectanglesHaveInteriorOverlap, validateNormalizedRect } from '../../../prototypes/site-builder-v2-booking-integration-lab/src/custom-design/model/geometry';
import { canvaPageWidth } from './canva-quality';
import type { CustomSiteSource } from './contracts';
import type { WebsiteDetails } from './website-details';

const safeWebsite = (value: string) => {
  const parsed = parseSafeHttpsUrl(value);
  if (!parsed) {
    return false;
  }
  const url = new URL(parsed);
  return (!url.port || url.port === '443') && url.hostname.includes('.') && !/^[\d.]+$|:|(?:^|\.)(?:localhost|local|internal|test)$/iu.test(url.hostname);
};
const action = z.discriminatedUnion('type', [
  z.object({ type: z.literal('book') }).strict(),
  z.object({ type: z.literal('service'), serviceKey: z.string().regex(/^[a-f0-9]{64}$/u) }).strict(),
  z.object({ type: z.literal('manage') }).strict(),
  z.object({ type: z.enum(['instagram', 'email', 'phone']) }).strict(),
  z.object({ type: z.literal('website'), url: z.string().max(2048).refine(safeWebsite, 'Use a public HTTPS website address without a password or custom port.') }).strict(),
]);
export const canvaAreaSchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9_-]{0,59}$/u),
  page: z.number().int().min(0).max(5),
  label: z.string().trim().min(1).max(200),
  geometry: z.object({ x: z.number(), y: z.number(), width: z.number(), height: z.number() }).strict().refine(value => validateNormalizedRect(value).length === 0, 'Keep the clickable area inside its page.'),
  action,
}).strict();
export const canvaAreasSchema = z.array(canvaAreaSchema).max(40).superRefine((areas, context) => {
  const ids = new Set<string>();
  for (const [index, area] of areas.entries()) {
    const destination = area.action.type === 'website' ? parseSafeHttpsUrl(area.action.url) : null;
    if (destination && /\b(?:book|appointment|reserv|schedul)|acuityscheduling|calendly|booksy|fresha|vagaro/iu.test(`${area.id.replaceAll('_', ' ')} ${area.label} ${new URL(destination).hostname} ${new URL(destination).pathname.replace(/[-_/]/gu, ' ')}`)) {
      context.addIssue({ code: 'custom', message: 'Connect appointment buttons to the Luster booking menu or a service, not another website.' });
    }
    if (ids.has(area.id) || area.geometry.width * area.geometry.height > 7000 || areas.slice(0, index).some(other => other.page === area.page && rectanglesHaveInteriorOverlap(other.geometry, area.geometry))) {
      context.addIssue({ code: 'custom', message: 'Use separate, nonoverlapping clickable areas with unique names.' });
    }
    ids.add(area.id);
  }
});
export const canvaDesignSchema = z.object({
  version: z.literal(1),
  pages: z.array(z.object({ assetId: z.string().uuid(), width: z.number().int().positive().max(40000), height: z.number().int().positive().max(40000), alt: z.string().trim().min(1).max(3000) }).strict()).min(1).max(6),
  areas: canvaAreasSchema,
  visibleText: z.string().max(16000),
  notes: z.array(z.string().max(500)).max(12),
  dataFingerprint: z.string().regex(/^[a-f0-9]{64}$/u),
  ownerReviewed: z.boolean(),
}).strict().refine(value => value.areas.every(area => area.page < value.pages.length), 'Choose an existing page for each clickable area.');
export type CanvaDesign = z.infer<typeof canvaDesignSchema>;
export type CanvaArea = z.infer<typeof canvaAreaSchema>;
/** Enlarge invisible touch targets, never artwork or overlapping neighbours. */
export function comfortableCanvaAreas(areas: CanvaArea[], pages: { width: number; height: number }[]) {
  const result = structuredClone(areas);
  for (const area of result) {
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
  // A compressed phone screenshot should fill a phone, not become a narrow
  // column capped at its export's pixel width. Bytes and proportions stay intact.
  const css = `.canva-site{margin:0 auto;width:100%;max-width:${Math.max(...design.pages.map(canvaPageWidth))}px}.canva-page{position:relative;margin:0 auto;width:100%}.canva-page img{display:block;width:100%;height:auto}.canva-area{position:absolute;display:block;z-index:1;padding:0;border:0;background:transparent;color:transparent;text-decoration:none;cursor:pointer}.canva-area:focus-visible{outline:3px solid #8a3859;outline-offset:2px}.canva-area:disabled{cursor:default}[data-luster-canva-area][hidden]{display:none!important}.canva-accessible{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%)}.canva-accessible:focus-within{position:static;width:auto;height:auto;overflow:visible;clip-path:none;padding:20px}img{max-width:100%}`;
  const geometry: string[] = [];
  const pages = design.pages.map((page, index) => {
    geometry.push(`#luster-canva-page-${index}{max-width:${canvaPageWidth(page)}px}`);
    return `<section id="luster-canva-page-${index}" class="canva-page"><img src="asset:${page.assetId}" width="${page.width}" height="${page.height}" alt="${escape(page.alt)}">${design.areas.filter(area => area.page === index).map((area) => {
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
  const sections = (details?.sections ?? []).map(section => `<h2 data-luster-field="details.title_${section.id}"></h2><p data-luster-field="details.section_${section.id}"></p>`).join('');
  return { title: 'Your Canva design', html: `<main class="canva-site">${pages}<aside class="canva-accessible" aria-label="Business details and booking"><h1 data-luster-field="business.name"></h1><p data-luster-field="business.hoursLabel"></p><p data-luster-field="details.locationDirections"></p>${contactText}${sections}<div data-luster-services></div><template data-luster-service><article><h2 data-luster-field="service.name"></h2><span data-luster-field="service.priceLabel"></span><span data-luster-field="service.durationMinutes"></span><button data-luster-book>Book this service</button></article></template></aside></main>`, css: `${css}\n${geometry.join('\n')}`, javascript: '', analysis: 'Your uploaded artwork is preserved. Clickable areas scale with each image, and booking uses Luster. Text inside the artwork is changed by uploading an updated Canva export.', limitations: ['The artwork scales as a whole on mobile; its text does not reflow.', ...design.notes].slice(0, 12), canva: design };
}
