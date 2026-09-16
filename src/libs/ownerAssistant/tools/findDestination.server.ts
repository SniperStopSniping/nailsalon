import 'server-only';

import type { FindDestinationResult } from '../contracts';
import { searchRegistry } from '../registry';

/**
 * `find_destination` (docs/OWNER_ASSISTANT_CHAT.md §3.4).
 *
 * Returns registry KEYS only. The model never sees or composes an href: code
 * turns a key into a URL later, and any key the model invents is dropped.
 */
export function findDestination(args: { query: string }): FindDestinationResult {
  return {
    matches: searchRegistry(args.query, 5).map(entry => ({
      key: entry.key,
      label: entry.label,
      description: entry.description,
      addressable: entry.addressable,
    })),
  };
}
