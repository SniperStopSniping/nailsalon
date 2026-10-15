import 'server-only';

import { parseFragment } from 'parse5';

import { SetupError } from '@/features/business-setup/contracts';

import type { WebsiteDetails } from './website-details';

/** Require real bindings, not assertions in model prose or text in comments. */
export function assertWebsiteDetailsCoverage(html: string, details?: WebsiteDetails) {
  if (!details) {
    return;
  }
  const fields = new Set<string>();
  const links = new Set<string>();
  function visit(node: any) {
    if (node.tagName === 'template' || node.attrs?.some((a: any) => a.name === 'hidden' || (a.name === 'aria-hidden' && a.value === 'true'))) {
      return;
    }
    for (const attr of node.attrs ?? []) {
      if (attr.name === 'data-luster-field') {
        fields.add(attr.value);
      }
      if (attr.name === 'data-luster-link' && node.tagName === 'a') {
        links.add(attr.value);
      }
    }
    for (const child of node.childNodes ?? []) {
      visit(child);
    }
  }
  visit(parseFragment(html));
  const missing = ['locationDirections', 'instagram', 'email', 'phone'].filter(key => details[key as keyof WebsiteDetails] && !fields.has(`details.${key}`));
  for (const key of ['instagram', 'email', 'phone'] as const) {
    if (details[key] && !links.has(key)) {
      missing.push(`${key} clickable contact link`);
    }
  }
  for (const section of details.sections) {
    if (!fields.has(`details.title_${section.id}`) || !fields.has(`details.section_${section.id}`)) {
      missing.push(`${section.title} heading and full text`);
    }
  }
  if (missing.length) {
    throw new SetupError('INVALID', `Include these missing saved details using their bindings: ${missing.join(', ')}.`);
  }
}
