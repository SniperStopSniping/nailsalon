import 'server-only';

import { parse as parseJavascript } from 'acorn';
import { parseFragment, serialize } from 'parse5';

import { SetupError } from '@/features/business-setup/contracts';

import { customSiteSourceSchema } from './contracts';

const TAGS = new Set('main section article aside header footer nav div span p h1 h2 h3 h4 h5 h6 strong em b i small br hr ul ol li dl dt dd figure figcaption blockquote button a img picture details summary template label time mark svg path circle ellipse rect line polyline polygon g title desc'.split(' '));
const ATTRS = new Set('id class role title alt width height viewBox viewbox d fill stroke stroke-width stroke-linecap stroke-linejoin cx cy r rx ry x y x1 y1 x2 y2 points transform opacity tabindex hidden open type'.split(' '));
const FIELDS = new Set(['business.name', 'business.city', 'business.address', 'business.bio', 'service.name', 'service.description', 'service.priceLabel', 'service.durationMinutes']);
type SourceNode = { tagName?: string; attrs?: { name: string; value: string }[]; childNodes?: SourceNode[]; content?: SourceNode };

/** Retained revision assets are private unless this exact source uses them. */
export function customSourceImageIds(html: string) {
  const ids = new Set<string>();
  function walk(node: SourceNode) {
    if (node.tagName === 'img') {
      const src = node.attrs?.find(attr => attr.name === 'src')?.value;
      if (src?.startsWith('asset:')) {
        ids.add(src.slice(6));
      }
    }
    node.childNodes?.forEach(walk);
    if (node.content) {
      walk(node.content);
    }
  }
  walk(parseFragment(html) as SourceNode);
  return ids;
}
export function validateCustomSource(raw: unknown, allowedImageIds: Set<string>) {
  const source = customSiteSourceSchema.parse(raw);
  const fail = (message: string): never => {
    throw new SetupError('INVALID', message);
  };
  // CSS remains free-form (grid, media/container queries, animations, custom
  // properties, gradients, shapes). Network-bearing syntax is excluded. This
  // is a publication contract, not the sandbox's security boundary.
  if (/[\\<]|@import|url\s*\(|image-set\s*\(|expression\s*\(|-moz-binding/iu.test(source.css.replace(/\/\*[\s\S]*?\*\//gu, ''))) {
    fail('Use uploaded images and local fonts. External CSS resources are not supported.');
  }
  const root = parseFragment(source.html);
  let count = 0;
  let booking = false;
  let services = false;
  let serviceTemplate = false;
  const ids = new Set<string>();
  function walk(node: SourceNode) {
    if (++count > 2500) {
      fail('This design is too large. Simplify the page before saving.');
    }
    if (node.tagName && !TAGS.has(node.tagName)) {
      fail(`The design uses an unsupported element: ${node.tagName}.`);
    }
    for (const attr of node.attrs ?? []) {
      if (attr.name.startsWith('aria-') || ATTRS.has(attr.name)) {
        if (attr.name === 'id') {
          if (!/^[a-z][\w-]{0,70}$/iu.test(attr.value) || ids.has(attr.value)) {
            fail('Use unique, simple element identifiers.');
          }
          ids.add(attr.value);
        }
        if (['fill', 'stroke'].includes(attr.name) && /url|[\\<]/iu.test(attr.value)) {
          fail('External SVG resources are not supported.');
        }
        continue;
      }
      if (attr.name === 'href' && /^#[\w-]*$/u.test(attr.value)) {
        continue;
      }
      if (attr.name === 'src' && node.tagName === 'img' && allowedImageIds.has(attr.value.replace(/^asset:/u, '')) && attr.value.startsWith('asset:')) {
        continue;
      }
      if (attr.name === 'data-edit' && /^[\w-]{1,80}$/u.test(attr.value)) {
        continue;
      }
      if (attr.name === 'data-luster-field' && FIELDS.has(attr.value)) {
        continue;
      }
      if (attr.name === 'data-luster-book' && node.tagName === 'button' && attr.value === '') {
        booking = true;
        continue;
      }
      if (attr.name === 'data-luster-manage' && node.tagName === 'button' && attr.value === '') {
        continue;
      }
      if (attr.name === 'data-luster-services' && attr.value === '') {
        services = true;
        continue;
      }
      if (attr.name === 'data-luster-service' && node.tagName === 'template' && attr.value === '') {
        serviceTemplate = true;
        continue;
      }
      fail(`The design contains an unsupported attribute: ${attr.name}.`);
    }
    for (const child of node.childNodes ?? []) {
      walk(child);
    }
    if (node.content) {
      walk(node.content);
    }
  }
  walk(root as SourceNode);
  if (!booking || !services || !serviceTemplate) {
    fail('Include the connected service gallery and a Luster booking button.');
  }
  try {
    parseJavascript(source.javascript, { ecmaVersion: 2022, sourceType: 'script' });
  } catch {
    fail('The design interaction script has a syntax error. Ask AI to repair it.');
  }
  return { ...source, html: serialize(root) };
}
