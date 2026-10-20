import 'server-only';

import { parseFragment } from 'parse5';

import { SetupError } from '@/features/business-setup/contracts';

type Node = { nodeName?: string; value?: string; tagName?: string; attrs?: { name: string; value: string }[]; childNodes?: Node[] };
type WebsiteWording = { key: string; kind: 'headline' | 'heading' | 'text'; text: string };
const normalize = (value: string) => value.replace(/\s+/gu, ' ').trim();
const omitted = (node: Node) => ['template', 'script', 'style'].includes(node.tagName ?? '') || Boolean(node.attrs?.some(attr => attr.name === 'hidden' || (attr.name === 'aria-hidden' && attr.value === 'true')));

function containsBinding(node: Node): boolean {
  return Boolean(node.attrs?.some(attr => attr.name === 'data-luster-field') || node.childNodes?.some(containsBinding));
}
function text(node: Node): string {
  if (omitted(node)) {
    return '';
  }
  if (node.tagName === 'br') {
    return ' ';
  }
  return node.nodeName === '#text' ? node.value ?? '' : (node.childNodes ?? []).map(text).join('');
}

/** Read the saved editable source, never reconstruct current copy from chat. */
export function websiteWordingForModel(html: string): WebsiteWording[] {
  const result: WebsiteWording[] = [];
  function visit(node: Node) {
    if (omitted(node)) {
      return;
    }
    const key = node.attrs?.find(attr => attr.name === 'data-edit')?.value;
    if ((key || node.tagName === 'h1') && !containsBinding(node)) {
      const value = normalize(text(node));
      if (value) {
        result.push({ key: key ?? `headline-${result.length}`, kind: node.tagName === 'h1' ? 'headline' : /^h[2-6]$/u.test(node.tagName ?? '') ? 'heading' : 'text', text: value });
      }
    }
    node.childNodes?.forEach(visit);
  }
  visit(parseFragment(html) as Node);
  return result;
}

/** Explicit preservation is enforced before saving; failure uses bounded AI repair. */
export function assertPreservedWebsiteWording(html: string, previousHtml: string, ownerMessage: string) {
  const keep = /\b(?:keep|preserve|retain|leave)\b[^.!?\n]{1,120}\b(headlines?|headings?|wording|copy|text)\b/iu.exec(ownerMessage);
  const rewrite = /\b(?:rewrite|rename|translate)\b|\b(?:change|replace|set|update)\s+(?:(?:the|my|this|current|existing|edited|website|main|hero)\s+)*(?:headline|heading|wording|copy|text)\b/iu.test(ownerMessage);
  if (!keep || rewrite) {
    return;
  }
  const kind = keep[1]!.toLowerCase();
  const headingsOnly = kind.startsWith('head');
  const headlinesOnly = kind.startsWith('headline');
  const saved = websiteWordingForModel(previousHtml).filter(field => !headingsOnly || field.kind === 'headline' || (!headlinesOnly && field.kind === 'heading'));
  const candidate = websiteWordingForModel(html);
  for (const field of saved) {
    if (!candidate.some(value => value.text === field.text && (!headingsOnly || value.kind === field.kind))) {
      throw new SetupError('INVALID', `Preserve the exact saved ${headingsOnly ? 'heading' : 'wording'}: ${JSON.stringify(field.text)}. The owner requested keeping it. Use previousSource, not older chat or an assistant paraphrase.`);
    }
  }
}
