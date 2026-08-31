/**
 * Generates the 30-item completion package for every V1 section into
 * markdown. Machine-derived fields (contracts, presets, limits, readiness,
 * defaults) come straight from the registry so the document cannot drift
 * from the code; qualitative fields (renderer/editor location, motion,
 * accessibility, tests, limitations) are curated here beside them.
 *
 *   npx tsx scripts/generate-section-packages.ts > /tmp/.../section-packages.md
 */

import {
  LIBRARY_SECTION_TYPES,
  SECTION_LIBRARY_REGISTRY,
  type SiteLibraryContext,
} from '../src/model/section-library/registry';
import { createDefaultOnboardingState } from '../src/onboarding/model/defaults';
import { deriveSiteLibraryContext } from '../src/onboarding/model/site-library-context';
import type { LibrarySectionType } from '../src/model/types';

/** Types still drawn by the accepted pre-library renderers. */
const PRE_LIBRARY_RENDERED = new Set<LibrarySectionType>([
  'hero',
  'about',
  'gallery',
  'contact',
]);

type Curated = {
  renderer: string;
  editor: string;
  controls: string;
  records: string;
  motion: string;
  accessibility: string;
  limitations: string;
};

const RENDERERS_FILE = 'src/onboarding/preview/section-renderers.tsx';
const PREVIEW_FILE = 'src/onboarding/preview/OnboardingSitePreview.tsx';
const EDITOR_DIR = 'src/ui/section-editors';

const CURATED: Record<LibrarySectionType, Curated> = {
  about: {
    accessibility: 'Heading-led; portrait image carries alt text or is decorative; the “Read more” disclosure is a native <details>.',
    controls: 'Bound intro line (shared bio lead or a deliberate override).',
    editor: `${EDITOR_DIR}/about.tsx`,
    limitations: 'Bio, specialties, and credentials stay owned by the Business Profile; the editor links there rather than duplicating them. With no portrait to show, the section collapses to a single column instead of reserving an empty one.',
    motion: 'Inherits the shared card/CTA idiom; no bespoke motion.',
    records: 'None — binds the profile About authority.',
    renderer: `${PREVIEW_FILE} · AboutSection (accepted pre-library renderer, extended with the bound intro)`,
  },
  announcement_bar: {
    accessibility: 'Named landmark (“Announcement”); the dismiss control has an explicit label; message clamps to one line without hiding text from assistive tech.',
    controls: 'Message, action (none / booking / link), action label, link address, reassurance line, tone, dismissible.',
    editor: `${EDITOR_DIR}/announcement-bar.tsx`,
    limitations: 'Dismissal is per visit and not remembered across sessions.',
    motion: 'Rises in on load (transform only, so the message is readable from the first frame), press-scales its action, and its 44px dismiss target scales on press; all suppressed under reduced motion.',
    records: 'None — the message is section-owned copy.',
    renderer: `${RENDERERS_FILE} · AnnouncementBar`,
  },
  contact: {
    accessibility: 'Labelled region; each contact action is a real link with its method as the accessible name.',
    controls: 'Design preset only — the actions come from the Business Profile, listed read-only for confirmation.',
    editor: `${EDITOR_DIR}/contact.tsx`,
    limitations: 'Cannot add a contact method here; that is a Business Profile decision so every surface stays consistent.',
    motion: 'Shared CTA press/hover idiom.',
    records: 'None — binds the contact authority.',
    renderer: `${PREVIEW_FILE} · ContactSection (accepted pre-library renderer)`,
  },
  deposits_cancellations: {
    accessibility: 'Labelled region with a heading; policy text is plain prose, not a table.',
    controls: 'Wording mode (summary or full) with the live resulting customer text shown read-only under each option.',
    editor: `${EDITOR_DIR}/deposits-cancellations.tsx`,
    limitations: 'The one-line summary is only offered once the deposit and cancellation rules are complete; before that the section falls back to the owner-authored full wording so no prompt copy can reach a customer.',
    motion: 'None beyond the shared surface transition.',
    records: 'None — binds the policies authority.',
    renderer: `${RENDERERS_FILE} · DepositsCancellations`,
  },
  faq: {
    accessibility: 'Native <details>/<summary> disclosures: keyboard operable and announced without custom ARIA.',
    controls: 'Which questions show (ordered, capped at 12) plus inline add/edit/remove of the shared FAQ records.',
    editor: `${EDITOR_DIR}/faq.tsx`,
    limitations: 'A record needs both a question and an answer before it can be saved; empty drafts are refused rather than silently stored.',
    motion: 'Marker rotates 45° on open (transform only).',
    records: 'siteContent.faq — bound by id, never copied.',
    renderer: `${RENDERERS_FILE} · Faq`,
  },
  featured_services: {
    accessibility: 'Labelled region, one heading per card, price and duration read as text; each card CTA names the service.',
    controls: 'Source (Luster picks vs. owner-chosen), service selection capped at six, design preset via the shell.',
    editor: `${EDITOR_DIR}/featured-services.tsx`,
    limitations: 'Only canonical catalogue services can be featured — the section cannot invent a service the menu does not have.',
    motion: 'Card lift on hover, image saturation warm-up, arrow nudge on the text CTA. At desktop width the grid caps at three columns, and the editorial preset becomes a price-list menu.',
    records: 'None — binds the canonical service catalogue by id.',
    renderer: `${RENDERERS_FILE} · FeaturedServices`,
  },
  final_cta: {
    accessibility: 'Labelled region; the primary action is a link to the canonical booking anchor.',
    controls: 'Bound headline (standard line or a deliberate override) plus the design preset.',
    editor: `${EDITOR_DIR}/final-cta.tsx`,
    limitations: 'Always routes to the canonical Booking section; it cannot point somewhere else.',
    motion: 'Primary CTA lifts on hover and press-scales; contrast band merges with an adjacent contrast section.',
    records: 'None.',
    renderer: `${RENDERERS_FILE} · FinalCta`,
  },
  footer: {
    accessibility: 'Named landmark (“<business> site footer”); links carry their method as the accessible name.',
    controls: 'Attribution toggle plus the design preset.',
    editor: `${EDITOR_DIR}/footer.tsx`,
    limitations: 'Footer content follows the shared profile; it has no independently authored link list in V1.',
    motion: 'Link colour transition only.',
    records: 'None.',
    renderer: `${RENDERERS_FILE} · Footer`,
  },
  gallery: {
    accessibility: 'Labelled region; every tile carries the owner’s alt text or an indexed fallback.',
    controls: 'All photos vs. a picked subset (ordered), plus the design preset.',
    editor: `${EDITOR_DIR}/gallery.tsx`,
    limitations: 'Photos are managed in the Gallery step; this section chooses which of them appear and in what order.',
    motion: 'Shared card idiom; carousel preset scroll-snaps.',
    records: 'None — binds the gallery media authority by image id.',
    renderer: `${PREVIEW_FILE} · GallerySection (accepted pre-library renderer, extended with preset + selection)`,
  },
  hero: {
    accessibility: 'Heading-led; the media is decorative (empty alt) because the headline carries the meaning.',
    controls: 'Bound headline and intro, media choice, location eyebrow and status line toggles, CTA label.',
    editor: `${EDITOR_DIR}/hero.tsx`,
    limitations: 'Media can only use assets the owner already shared (profile photo or logo); there is no per-section upload in V1.',
    motion: 'CTA lift/press; full-bleed media sits behind the copy without parallax.',
    records: 'None — binds the profile identity authority.',
    renderer: `${PREVIEW_FILE} · hero branch (accepted pre-library renderer, extended with settings)`,
  },
  hours: {
    accessibility: 'Definition list of day/time pairs; the open/closed status line is a status element.',
    controls: 'Compact or full layout, with the live published rows shown read-only.',
    editor: `${EDITOR_DIR}/hours.tsx`,
    limitations: 'Renders only when hours are configured AND the owner chose to show them on the site.',
    motion: 'None — a schedule should not move.',
    records: 'None — binds the hours authority.',
    renderer: `${RENDERERS_FILE} · Hours`,
  },
  offers: {
    accessibility: 'Labelled region, one heading per offer, terms and expiry read as text.',
    controls: 'Which offers show (capped at three) plus inline add/edit/remove of the shared offer records.',
    editor: `${EDITOR_DIR}/offers.tsx`,
    limitations: 'Expiry copy renders only for a real future date; a past date simply stops showing the deadline.',
    motion: 'Shared card lift; accent rail on each card.',
    records: 'siteContent.offers — bound by id.',
    renderer: `${RENDERERS_FILE} · Offers`,
  },
  policies: {
    accessibility: 'Definition list with one term per policy topic.',
    controls: 'Which policy topics appear, each showing its live wording (or an honest “no wording yet” note).',
    editor: `${EDITOR_DIR}/policies.tsx`,
    limitations: 'Deposits and cancellations are deliberately excluded here — section 12 owns them so they cannot contradict each other.',
    motion: 'None.',
    records: 'None — binds the policies authority.',
    renderer: `${RENDERERS_FILE} · Policies`,
  },
  quick_info: {
    accessibility: 'Labelled region; facts are a list, each with its own data attribute for testing.',
    controls: 'Ordered pick of up to four facts, each showing its live value or “(nothing to show yet)”.',
    editor: `${EDITOR_DIR}/quick-info.tsx`,
    limitations: 'A fact with no value collapses instead of rendering an empty slot.',
    motion: 'Facts stagger in 60ms apart on load, moving only — never fading from invisible; suppressed under reduced motion.',
    records: 'None — binds profile, location, and hours authorities.',
    renderer: `${RENDERERS_FILE} · QuickInfo`,
  },
  reviews: {
    accessibility: 'Blockquote + cite per review; the star rating carries an explicit “Rated N out of 5” label.',
    controls: 'Ratings toggle, which reviews show, and inline add/edit/remove of the shared review records.',
    editor: `${EDITOR_DIR}/reviews.tsx`,
    limitations: 'Only records marked visible render; ratings render only where a real rating exists.',
    motion: 'Shared card lift; carousel preset scroll-snaps.',
    records: 'siteContent.reviews — bound by id.',
    renderer: `${RENDERERS_FILE} · Reviews`,
  },
  section_navigation: {
    accessibility: 'Real <nav> with an “On this page” label; every entry is an in-page anchor to a rendered section.',
    controls: 'Sticky toggle; the menu builds itself from the page’s own anchorable sections.',
    editor: `${EDITOR_DIR}/section-navigation.tsx`,
    limitations: 'Needs at least two anchorable sections on its page; with fewer it renders nothing rather than a one-item menu.',
    motion: 'Chips lift on hover and press-scale.',
    records: 'None.',
    renderer: `${RENDERERS_FILE} · SectionNavigation`,
  },
  team: {
    accessibility: 'One heading per member; initials avatars are decorative; per-member booking links name the member.',
    controls: 'Which members show plus inline add/edit/remove of the shared staff records.',
    editor: `${EDITOR_DIR}/team.tsx`,
    limitations: 'Member photos are not supported in V1 — initials avatars are used, and the limitation is stated rather than faked.',
    motion: 'Avatar scale/tilt on card hover.',
    records: 'siteContent.staff — bound by id.',
    renderer: `${RENDERERS_FILE} · Team`,
  },
  visit_us: {
    accessibility: 'Labelled region; the directions link carries the resolved destination as its accessible name, and each contact action carries its own method mark, matching the Contact section.',
    controls: 'Parking / entrance / transit toggles (each showing the live profile text), and auto/show/hide summaries for hours and contact.',
    editor: `${EDITOR_DIR}/visit-us.tsx`,
    limitations: 'Honours the address-visibility choice: a private address never renders, and directions resolve through the shared validated action path.',
    motion: 'Contact chips lift on hover.',
    records: 'None — binds location, hours, and contact authorities.',
    renderer: `${RENDERERS_FILE} · VisitUs`,
  },
};

/*
 * The empty context is derived, not restated. A hand-written literal drifts
 * silently every time the context gains a field, and what it documents —
 * what each section says before the owner has filled anything in — is only
 * true if it is the real derivation.
 */
const context: SiteLibraryContext = deriveSiteLibraryContext(
  createDefaultOnboardingState(),
  null,
);

const lines: string[] = [
  '# Section completion packages — Site Section Library V1',
  '',
  'Thirty items per section. Machine-derived fields are read straight from',
  '`SECTION_LIBRARY_REGISTRY` at generation time, so they cannot drift from',
  'the shipped contracts; curated fields sit beside them in',
  '`scripts/generate-section-packages.ts`.',
  '',
  `Generated from ${LIBRARY_SECTION_TYPES.length} library sections plus the two engine sections.`,
  '',
];

for (const [index, type] of LIBRARY_SECTION_TYPES.entries()) {
  const entry = SECTION_LIBRARY_REGISTRY[type];
  const curated = CURATED[type];
  const defaults = entry.defaultSettings();
  const readiness = entry.readiness(defaults as never, context);
  const validation = entry.validate(defaults as never, context);

  lines.push(
    `## ${String(index + 1).padStart(2, '0')} · ${entry.label} (\`${type}\`)`,
    '',
    `1. **Type id** — \`${type}\``,
    `2. **Owner label** — ${entry.label}`,
    `3. **Description** — ${entry.description}`,
    `4. **Category** — ${entry.category}`,
    `5. **Data domains** — ${entry.dataDomains.join(', ') || 'none'}`,
    `6. **Settings version** — ${entry.version}`,
    `7. **Settings fields** — ${Object.keys(defaults).filter(key => key !== 'version').join(', ')}`,
    `8. **Presets** — ${entry.presetIds.join(', ')}`,
    `9. **Default preset** — ${entry.defaultPresetId}`,
    `10. **Default settings** — \`${JSON.stringify(defaults)}\``,
    `11. **Normalizer** — every editor write passes \`normalize\`; document validation requires \`settings === normalize(settings)\`, so unknown keys, out-of-range values, and over-long lists cannot persist.`,
    `12. **Validation issues (empty context)** — ${validation.length === 0 ? 'none' : validation.map(issue => `${issue.code}: ${issue.message}`).join('; ')}`,
    `13. **Readiness (empty context)** — ${readiness.level}${readiness.issues.length > 0 ? ` — ${readiness.issues.map(issue => issue.message).join('; ')}` : ''}`,
    `14. **Limit kind** — ${entry.limitKind}`,
    `15. **Max per page** — ${entry.maxPerPage ?? 'unbounded'}`,
    `16. **Max per site** — ${entry.maxPerSite ?? 'unbounded'}`,
    `17. **Allowed page kinds** — ${entry.allowedPageKinds.join(', ')}`,
    `18. **Recommended page kinds** — ${entry.recommendedPageKinds.join(', ')}`,
    `19. **Surface tone** — ${entry.surface}${entry.attachesToNext ? ' (attaches to the next section)' : ''}`,
    `20. **Legacy roles absorbed** — ${entry.legacySemanticRoles.join(', ') || 'none'}`,
    `21. **Overlap rules** — ${entry.overlapWarnings.length === 0 ? 'none registered' : entry.overlapWarnings.map(rule => rule.id).join(', ')}`,
    `22. **Customer renderer** — ${curated.renderer}`,
    `23. **Owner editor** — ${curated.editor}`,
    `24. **Editor controls** — ${curated.controls}`,
    `25. **Shared records** — ${curated.records}`,
    `26. **Markup hooks** — ${PRE_LIBRARY_RENDERED.has(type)
      ? `\`data-section-id\`${type === 'hero' ? ' and \`data-surface\`' : ''} (accepted pre-library markup, no \`data-library-type\`)`
      : `\`data-library-type="${type}"\`, \`data-section-id\`, \`data-surface\`, \`data-attached\``}`,
    `27. **Motion** — ${curated.motion}`,
    `28. **Accessibility** — ${curated.accessibility}`,
    `29. **Test coverage** — registry/plan contracts (\`src/model/*.labtest.ts\`), renderer matrix (\`section-render-matrix.unit.tsx\`), adjacency matrix (\`section-plan-matrix.labtest.ts\`), accessibility gate (\`section-accessibility.unit.tsx\`), editor unit tests (\`${EDITOR_DIR}/editors-*.unit.tsx\`), and the browser matrix (\`tests/e2e/section-library-visual-matrix.spec.ts\`).`,
    `30. **Known limitations** — ${curated.limitations}`,
    '',
  );
}

lines.push(
  '## 19 · Services & Booking (`booking`) — engine section',
  '',
  'Not a library section: Booking is the canonical engine. Exactly one per',
  'site (enforced by document validation and by `addSection`), it owns',
  'service discovery, add-ons, artist and time selection, and confirmation.',
  'The library never re-implements any of it; sections route to it by anchor.',
  '',
  '## 20 · Custom Design (`custom_design`) — engine section',
  '',
  'Also not a library section: it renders the owner’s own uploaded artwork',
  'with validated customer actions. It has no demonstration content by',
  'design — the Section Gallery says so plainly rather than showing sample',
  'artwork that is not theirs.',
  '',
);

console.warn(lines.join('\n'));
