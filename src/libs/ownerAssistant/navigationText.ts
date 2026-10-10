import type { ChatLink } from './contracts';

/**
 * Use the server's approved destination labels in prose, including saved replies.
 * Only exact multiword registry keys from this answer's links are substituted;
 * prices, ordinary words, unknown keys and navigation targets are untouched.
 */
export function humanizeNavigationText(text: string, links: readonly Pick<ChatLink, 'key' | 'label'>[]): string {
  let result = text;
  for (const { key, label } of links) {
    if (!/^[a-z]+(?:_[a-z]+)+$/.test(key)) {
      continue;
    }
    // Already-labelled references should read once, without an empty gap.
    result = result.split(`${label} (${key})`).join(label);
    const pattern = new RegExp(`(?<![\\w/])(?:\\(${key}\\)|\`${key}\`|${key})(?![\\w/])`, 'g');
    result = result.replace(pattern, () => label);
  }
  return result;
}
