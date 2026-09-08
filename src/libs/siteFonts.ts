import { Archivo, Inter, Newsreader, Nunito, Outfit, Playfair_Display } from 'next/font/google';

/**
 * Every self-hosted face the product uses, declared exactly once.
 *
 * The customer site's six style presets are meant to read as six different
 * typographic personalities, and until now they could not: four of the six
 * named the same serif, all six named the same body face, and the public
 * booking route loaded no webfont at all — so `Newsreader` silently rendered
 * as Georgia and `Inter` as system-ui. These declarations are what make the
 * preset families real on the published page.
 *
 * All six are variable fonts. A variable face covers the whole weight range in
 * one file, which is both smaller than shipping several static weights and the
 * only way to avoid synthetic bolding: the renderer already asks for 600 and
 * 700 on different headings.
 *
 * Only the body face is preloaded. Exactly one display face is used by any
 * given salon page, so preloading all five would fetch four files no visitor
 * needs; `display: 'swap'` keeps text visible while the chosen one arrives.
 */
export const siteSans = Inter({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-luster-sans',
});

export const siteModernDisplay = Outfit({
  subsets: ['latin'],
  display: 'swap',
  preload: false,
  variable: '--font-luster-modern',
});

export const siteEditorialDisplay = Newsreader({
  subsets: ['latin'],
  display: 'swap',
  preload: false,
  variable: '--font-luster-editorial',
});

export const siteSoftDisplay = Nunito({
  subsets: ['latin'],
  display: 'swap',
  preload: false,
  variable: '--font-luster-soft',
});

export const siteBoldDisplay = Archivo({
  subsets: ['latin'],
  display: 'swap',
  preload: false,
  variable: '--font-luster-bold',
});

export const siteLuxuryDisplay = Playfair_Display({
  subsets: ['latin'],
  display: 'swap',
  preload: false,
  variable: '--font-luster-luxury',
});

/**
 * Published on `:root` rather than through the generated `.variable` classes.
 * The booking page renders parts of itself through portals (modals, the
 * gallery dialog) that sit outside the layout's subtree, so a wrapper class
 * alone would leave those on the fallback stack — the same reason the owner
 * workspace publishes its two faces this way.
 */
export const SITE_FONT_VARIABLES_CSS = `:root{`
  + `--font-luster-sans:${siteSans.style.fontFamily};`
  + `--font-luster-modern:${siteModernDisplay.style.fontFamily};`
  + `--font-luster-editorial:${siteEditorialDisplay.style.fontFamily};`
  + `--font-luster-soft:${siteSoftDisplay.style.fontFamily};`
  + `--font-luster-bold:${siteBoldDisplay.style.fontFamily};`
  + `--font-luster-luxury:${siteLuxuryDisplay.style.fontFamily};`
  + `}`;
