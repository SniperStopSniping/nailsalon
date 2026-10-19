import { z } from 'zod';

export const canvaNativeImageSchema = z.object({
  mediaId: z.string().uuid(),
  // Missing means the original onboarding-media binding. Never infer storage
  // from an ID supplied by the browser or model.
  storageKind: z.literal('asset').optional(),
  role: z.enum(['profile', 'gallery']),
  width: z.number().int().positive().max(40000),
  height: z.number().int().positive().max(40000),
  alt: z.string().trim().min(1).max(500),
}).strict();
const placement = { id: z.string().regex(/^[a-z][\w-]{0,70}$/iu), beforePage: z.number().int().min(0).max(10) };
export const canvaNativeContentSchema = z.array(z.discriminatedUnion('type', [
  z.object({ ...placement, type: z.literal('about'), title: z.string().trim().min(1).max(160), textSectionIds: z.array(z.string().regex(/^[a-z][a-z0-9_-]{0,59}$/u)).max(20), image: canvaNativeImageSchema.optional(), showBusinessName: z.boolean(), showInstagram: z.boolean(), showBookingButton: z.boolean() }).strict(),
  z.object({ ...placement, type: z.literal('gallery'), title: z.string().trim().min(1).max(160), layout: z.enum(['grid', 'carousel', 'editorial']), images: z.array(canvaNativeImageSchema).max(60) }).strict(),
  z.object({ ...placement, type: z.literal('reviews'), title: z.string().trim().min(1).max(160), showRatings: z.boolean(), reviews: z.array(z.object({ id: z.string().max(160), quote: z.string().min(1).max(4000), authorName: z.string().min(1).max(160), rating: z.number().min(1).max(5).nullable() }).strict()).max(3) }).strict(),
])).max(30).superRefine((blocks, context) => {
  if (new Set(blocks.map(block => block.id)).size !== blocks.length) {
    context.addIssue({ code: 'custom', message: 'Give each website section a separate name.' });
  }
  const images = blocks.flatMap(block => block.type === 'gallery' ? block.images : block.type === 'about' && block.image ? [block.image] : []);
  for (const block of blocks) {
    if ((block.type === 'about' && block.image && block.image.role !== 'profile') || (block.type === 'gallery' && block.images.some(image => image.role !== 'gallery'))) {
      context.addIssue({ code: 'custom', message: 'Use the saved About or Gallery image in its own section.' });
    }
  }
  const seen = new Map<string, string>();
  for (const image of images) {
    // One owned library photo can be placed in About and Gallery. Legacy
    // onboarding images remain tied to their original section role.
    const signature = JSON.stringify({ role: image.storageKind ? undefined : image.role, storageKind: image.storageKind, width: image.width, height: image.height });
    if (seen.has(image.mediaId) && seen.get(image.mediaId) !== signature) {
      context.addIssue({ code: 'custom', message: 'Keep repeated image references consistent.' });
    }
    seen.set(image.mediaId, signature);
  }
  if (new Set(images.map(image => image.mediaId)).size > 61) {
    context.addIssue({ code: 'custom', message: 'Use up to sixty gallery photos and one About photo.' });
  }
});
export type CanvaNativeContent = z.infer<typeof canvaNativeContentSchema>;
export type CanvaNativeImage = z.infer<typeof canvaNativeImageSchema>;
export function canvaNativeImages(blocks: CanvaNativeContent | undefined) {
  const images = (blocks ?? []).flatMap(block => block.type === 'gallery' ? block.images : block.type === 'about' && block.image ? [block.image] : []);
  return [...new Map(images.map(image => [image.mediaId, image])).values()];
}
const escape = (value: string) => value.replace(/[&<>"']/gu, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', '\'': '&#39;' })[c]!);
const photo = (image: CanvaNativeImage) => `<figure><img data-luster-native-image="${image.mediaId}" width="${image.width}" height="${image.height}" alt="${escape(image.alt)}" loading="lazy" decoding="async"><figcaption data-luster-native-status="${image.mediaId}" role="status" hidden>A photo could not be loaded.</figcaption></figure>`;
/** Trusted optional additions. Historical Canva source remains byte-identical. */
export function compileCanvaNativeContent(blocks: CanvaNativeContent, beforePage: number) {
  return blocks.filter(block => block.beforePage === beforePage).map((block) => {
    const title = `<h2>${escape(block.title)}</h2>`;
    if (block.type === 'about') {
      return `<section id="${block.id}" class="canva-native-section canva-native-about" aria-label="About">${block.image ? photo(block.image) : ''}<div>${block.textSectionIds.length ? '' : title}${block.showBusinessName ? '<p data-luster-field="business.name"></p>' : ''}${block.textSectionIds.map((id, index) => `<${index ? 'h3' : 'h2'}${index ? ' class="canva-native-chunk-title"' : ''} data-luster-field="details.title_${id}"></${index ? 'h3' : 'h2'}><p data-luster-field="details.section_${id}"></p>`).join('')}<nav class="canva-manual-controls">${block.showInstagram ? '<a class="canva-manual-cta" data-luster-link="instagram">Instagram</a>' : ''}${block.showBookingButton ? '<button class="canva-manual-cta" type="button" data-luster-book>Book an appointment</button>' : ''}</nav></div></section>`;
    }
    if (block.type === 'gallery') {
      return `<section id="${block.id}" class="canva-native-section" aria-label="Gallery">${title}<div class="canva-native-gallery canva-native-gallery-${block.layout}"${block.layout === 'carousel' ? ' tabindex="0" role="region" aria-label="Photo gallery. Scroll to see more photos."' : ''}>${block.images.map(photo).join('')}</div></section>`;
    }
    return `<section id="${block.id}" class="canva-native-section" aria-label="Reviews">${title}<div class="canva-native-reviews">${block.reviews.map(review => `<blockquote>${block.showRatings && review.rating !== null ? `<span role="img" aria-label="Rated ${review.rating} out of 5">${'★'.repeat(Math.round(review.rating))}</span>` : ''}<p>${escape(review.quote)}</p><footer><cite>${escape(review.authorName)}</cite></footer></blockquote>`).join('')}</div></section>`;
  }).join('');
}
export const CANVA_NATIVE_CSS = `.canva-native-section{max-width:1120px;margin:0 auto;padding:32px 20px;color:#30282b;font:16px/1.6 Arial,sans-serif;overflow-wrap:anywhere}.canva-native-chunk-title{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%)}.canva-native-section .canva-manual-controls{display:flex;gap:8px;flex-wrap:wrap}.canva-native-section .canva-manual-cta{display:inline-flex;align-items:center;justify-content:center;min-height:44px;padding:12px 20px;border:0;border-radius:12px;background:#72364e;color:#fff;font:600 16px/1.3 Arial,sans-serif;text-decoration:none}.canva-native-section .canva-manual-cta:focus-visible{outline:3px solid #3685ff;outline-offset:3px}.canva-native-section p{white-space:pre-line}.canva-native-section h2{font:600 clamp(24px,4vw,36px)/1.2 Georgia,serif}.canva-native-section figure{margin:0;background:#f4eef1}.canva-native-section img{display:block;width:100%;height:auto;object-fit:contain}.canva-native-section figcaption{padding:12px}.canva-native-about{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:28px;align-items:center}.canva-native-gallery,.canva-native-reviews{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,240px),1fr));gap:16px;align-items:start}.canva-native-gallery-editorial>figure:first-child{grid-column:1/-1}.canva-native-gallery-carousel{display:flex;overflow-x:auto;scroll-snap-type:x mandatory;padding-bottom:16px}.canva-native-gallery-carousel>figure{min-width:0;flex:0 0 min(80%,420px);scroll-snap-align:start}.canva-native-reviews blockquote{margin:0;padding:20px;border:1px solid #d5c6cc;border-radius:12px}@media(max-width:600px){.canva-native-about{grid-template-columns:minmax(0,1fr)}.canva-native-section{padding:24px 16px}.canva-native-gallery{gap:12px}}`;
