import 'server-only';

import { parseFragment, serialize } from 'parse5';

import { SetupError } from '@/features/business-setup/contracts';

import type { CustomSiteSource } from './contracts';
import type { WebsiteDetails } from './website-details';
import { EMPTY_WEBSITE_DETAILS, websiteDetailsSchema } from './website-details';

export const CONTACT_KINDS = ['instagram', 'email', 'phone'] as const;
export type ContactKind = typeof CONTACT_KINDS[number];
const ignored = new Set(['script', 'style', 'template']);
const attr = (node: any, name: string) => node.attrs?.find((a: any) => a.name === name)?.value;
const hidden = (node: any) => ignored.has(node.tagName) || node.attrs?.some((a: any) => a.name === 'hidden' || (a.name === 'aria-hidden' && a.value === 'true'));
function setAttr(node: any, name: string, value: string) {
  node.attrs ??= [];
  const existing = node.attrs.find((a: any) => a.name === name);
  if (existing) {
    existing.value = value;
  } else {
    node.attrs.push({ name, value });
  }
}
function values(text: string, kind: ContactKind): string[] {
  const matches = kind === 'instagram'
    ? text.match(/(?<![\w.])@[\w.]{1,30}\b/giu)
    : kind === 'email'
      ? text.match(/[\w.+-]+@[a-z0-9.-]+\.[a-z]{2,}/giu)
      : text.match(/\+?\(?\d[\d ()-]{5,}\d/gu);
  return (matches ?? []).filter(value => websiteDetailsSchema.shape[kind].safeParse(value).success);
}
function walk(node: any, visit: (node: any) => void) {
  if (hidden(node)) {
    return;
  }
  visit(node);
  for (const child of [...node.childNodes ?? []]) {
    walk(child, visit);
  }
}
/**
 * Explicit owner repair may recover unambiguous visible details from a saved design.
 * Never use generated metadata/ARIA labels, hidden text or another tenant's source.
 */
export function recoverSavedContacts(html: string, current?: WebsiteDetails, includeBoundText = false): WebsiteDetails {
  const root = parseFragment(html);
  const found = Object.fromEntries(CONTACT_KINDS.map(kind => [kind, new Map<string, string>()])) as Record<ContactKind, Map<string, string>>;
  walk(root, (node) => {
    if (node.nodeName !== '#text') {
      return;
    }
    let parentKind: string | undefined;
    for (let parent = node.parentNode; parent; parent = parent.parentNode) {
      parentKind ??= attr(parent, 'data-luster-link');
      if (!includeBoundText && attr(parent, 'data-luster-field')?.startsWith('details.')) {
        return;
      }
    }
    for (const kind of CONTACT_KINDS) {
      // Numbers are contacts only in explicitly labelled phone content.
      if (kind === 'phone' && parentKind !== 'phone' && !/\b(?:phone|call|tel)\b/iu.test(node.value)) {
        continue;
      }
      for (const value of values(node.value, kind)) {
        found[kind].set(value.toLowerCase().replace(kind === 'phone' ? /[^+0-9]/gu : /^@/u, ''), value);
      }
    }
  });
  const details = structuredClone(current ?? EMPTY_WEBSITE_DETAILS);
  for (const kind of CONTACT_KINDS) {
    if (details[kind]) {
      continue;
    }
    if (found[kind].size > 1) {
      throw new SetupError('INVALID', `I found more than one ${kind === 'instagram' ? 'Instagram handle' : kind === 'email' ? 'email address' : 'phone number'}. Which one should customers use?`);
    }
    details[kind] = [...found[kind].values()][0] ?? null;
  }
  return websiteDetailsSchema.parse(details);
}
/** Deterministic contact wiring. Layout/CSS/scripts and unrelated content stay intact. */
export function bindWebsiteContacts(source: CustomSiteSource, details?: WebsiteDetails): CustomSiteSource {
  if (!details) {
    return source;
  }
  const contacts = details;
  const root = parseFragment(source.html);
  function boundText(value: string, kind: ContactKind) {
    const node: any = (parseFragment('<span></span>').childNodes[0]);
    setAttr(node, 'data-luster-field', `details.${kind}`);
    node.childNodes = [{ nodeName: '#text', value, parentNode: node }];
    return node;
  }
  function wire(node: any, insideAnchor = false) {
    if (hidden(node)) {
      return;
    }
    const fieldKind = attr(node, 'data-luster-field')?.replace(/^details\./u, '') as ContactKind;
    if (!insideAnchor && node.tagName !== 'a' && CONTACT_KINDS.includes(fieldKind) && contacts[fieldKind] && node.parentNode) {
      const anchor: any = parseFragment('<a></a>').childNodes[0];
      setAttr(anchor, 'data-luster-link', fieldKind);
      anchor.parentNode = node.parentNode;
      anchor.childNodes = [node];
      anchor.parentNode.childNodes.splice(anchor.parentNode.childNodes.indexOf(node), 1, anchor);
      node.parentNode = anchor;
      return;
    }
    if (node.tagName === 'a' && !attr(node, 'data-luster-link') && !attr(node, 'data-luster-book') && !attr(node, 'data-luster-manage')) {
      const kinds = new Set<ContactKind>();
      walk(node, (child) => {
        if (child.nodeName === '#text') {
          for (const kind of CONTACT_KINDS) {
            if (contacts[kind] && values(child.value, kind).some(value => value.toLowerCase().replace(/^@/u, '') === contacts[kind]!.toLowerCase().replace(/^@/u, ''))) {
              kinds.add(kind);
            }
          }
        }
      });
      if (kinds.size === 1) {
        setAttr(node, 'data-luster-link', [...kinds][0]!);
        node.attrs = node.attrs.filter((a: any) => a.name !== 'href');
      }
    }
    const linkedKind = attr(node, 'data-luster-link') as ContactKind;
    if (node.tagName === 'a' && CONTACT_KINDS.includes(linkedKind) && contacts[linkedKind]) {
      let bound = false;
      walk(node, (child) => {
        bound ||= attr(child, 'data-luster-field') === `details.${linkedKind}`;
      });
      if (!bound) {
        let replaced = false;
        walk(node, (child) => {
          if (replaced || child.nodeName !== '#text') {
            return;
          }
          const candidate = values(child.value, linkedKind)[0];
          if (candidate) {
            const offset = child.value.indexOf(candidate);
            const prefix = { nodeName: '#text', value: child.value.slice(0, offset), parentNode: child.parentNode };
            const suffix = { nodeName: '#text', value: child.value.slice(offset + candidate.length), parentNode: child.parentNode };
            const span = boundText(contacts[linkedKind]!, linkedKind);
            span.parentNode = child.parentNode;
            const index = child.parentNode.childNodes.indexOf(child);
            child.parentNode.childNodes.splice(index, 1, prefix, span, suffix);
            replaced = true;
          }
        });
        if (!replaced) {
          const span = boundText(contacts[linkedKind]!, linkedKind);
          span.parentNode = node;
          node.childNodes.push(span);
        }
      }
      return;
    }
    for (const child of [...node.childNodes ?? []]) {
      if (!insideAnchor && node.tagName !== 'a' && !attr(node, 'data-luster-field') && child.nodeName === '#text') {
        let text = child.value;
        const replacements: any[] = [];
        // Split text once, preserving labels and surrounding content.
        while (text) {
          const match = CONTACT_KINDS.flatMap((kind) => {
            const normalize = (value: string) => kind === 'phone' ? value.replace(/[^+0-9]/gu, '') : value.toLowerCase().replace(/^@/u, '');
            const candidate = contacts[kind] && values(text, kind).find(value => normalize(value) === normalize(contacts[kind]!));
            return candidate ? [{ kind, value: contacts[kind]!, candidate, index: text.indexOf(candidate) }] : [];
          }).sort((a, b) => a.index - b.index)[0];
          if (!match) {
            replacements.push({ nodeName: '#text', value: text, parentNode: node });
            break;
          }
          if (match.index) {
            replacements.push({ nodeName: '#text', value: text.slice(0, match.index), parentNode: node });
          }
          const anchor: any = parseFragment('<a></a>').childNodes[0];
          setAttr(anchor, 'data-luster-link', match.kind);
          const span = boundText(match.value!, match.kind);
          span.parentNode = anchor;
          anchor.childNodes = [span];
          anchor.parentNode = node;
          replacements.push(anchor);
          text = text.slice(match.index + match.candidate.length);
        }
        if (replacements.some(n => n.tagName === 'a')) {
          node.childNodes.splice(node.childNodes.indexOf(child), 1, ...replacements);
          continue;
        }
      }
      wire(child, insideAnchor || node.tagName === 'a');
    }
  }
  wire(root);
  return { ...source, html: serialize(root) };
}
export function requestsContactRepair(message: string) {
  return /^(?:please\s+)?(?:make|connect|link|fix)\s+(?:(?:my|the|all my)\s+)?(?:instagram|email|phone(?: number)?|contact(?: links| details)?)(?:\s+(?:link|button))?(?:\s+(?:clickable|work|working|tap to call))?[.!]?$/iu.test(message.trim());
}
