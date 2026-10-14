import type { PostPayload } from './poster';

const DEFAULT_HASHTAGS = '#nails #nailart #manicure #buildergel #gelnails #nailsofinstagram';

/**
 * Basic caption template for retained integration infrastructure.
 * Legacy payload flags are accepted for stored queue compatibility; no AI,
 * price, colour or brand generation is implemented or advertised.
 */
export async function generateCaption(_payload: PostPayload, salonName?: string): Promise<string> {
  return [
    'Fresh set 💅✨',
    `Book your next appointment at ${salonName || 'Luster Nail Studio'}.`,
    DEFAULT_HASHTAGS,
  ].join('\n\n');
}
