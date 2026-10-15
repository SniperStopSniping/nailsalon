import 'server-only';

import { parseFragment } from 'parse5';

import { SetupError } from '@/features/business-setup/contracts';

import { CONTACT_KINDS, recoverSavedContacts } from './contacts.server';
import type { WebsiteDetails } from './website-details';

/** Require real bindings, not assertions in model prose or text in comments. */
export function assertWebsiteDetailsCoverage(html: string, details?: WebsiteDetails) {
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
  const visible = recoverSavedContacts(html);
  for (const kind of CONTACT_KINDS) {
    if ((links.has(kind) || fields.has(`details.${kind}`) || visible[kind]) && !details?.[kind]) {
      throw new SetupError('INVALID', `Save the ${kind === 'instagram' ? 'Instagram handle' : kind === 'email' ? 'email address' : 'phone number'} before showing its contact link.`);
    }
    if (visible[kind] && details?.[kind] && visible[kind]!.toLowerCase().replace(/^@/u, '') !== details[kind]!.toLowerCase().replace(/^@/u, '')) {
      throw new SetupError('INVALID', `Use the saved ${kind} details and contact bindings instead of copied contact text.`);
    }
  }
  if (!details) {
    return;
  }
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
