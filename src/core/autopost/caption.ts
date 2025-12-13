// =============================================================================
// CAPTION GENERATOR FOR AUTOPOST
// =============================================================================
// Generates captions for Instagram and Facebook posts.
// Supports AI-generated captions with fail-safe fallback to deterministic.
// =============================================================================

import type { PostPayload } from './poster';

/**
 * Default hashtags for nail salon posts
 */
const DEFAULT_HASHTAGS = '#nails #nailart #manicure #buildergel #gelnails #nailsofinstagram';

/**
 * Generate a caption for a social media post.
 *
 * If aiCaptionEnabled is true, attempts AI generation with fallback.
 * Otherwise, uses deterministic template.
 *
 * FAIL-SAFE: Never throws. Always returns a valid caption.
 *
 * @param payload - The post payload from autopost queue
 * @param salonName - Optional salon name for personalization
 * @returns Caption string
 */
export async function generateCaption(
  payload: PostPayload,
  salonName?: string,
): Promise<string> {
  const { aiCaptionEnabled, includePrice: _includePrice, includeColor: _includeColor, includeBrand: _includeBrand } = payload;

  // If AI is enabled, try AI generation first
  if (aiCaptionEnabled) {
    try {
      const aiCaption = await generateAiCaption(payload, salonName);
      if (aiCaption) {
        return aiCaption;
      }
    } catch (error) {
      // AI failed, fall through to deterministic
      console.warn('[Caption] AI caption generation failed, using fallback:', error);
    }
  }

  // Deterministic fallback caption
  return generateDeterministicCaption(payload, salonName);
}

/**
 * Generate a deterministic caption without AI.
 *
 * Template: "Fresh set 💅✨ [optional details] Book your next appointment at {salon}. #hashtags"
 */
function generateDeterministicCaption(
  _payload: PostPayload,
  salonName?: string,
): string {
  const parts: string[] = [];

  // Opening line
  parts.push('Fresh set 💅✨');

  // Optional details (only if flags are true AND we have data)
  // Note: We don't have actual price/color/brand data in the payload,
  // so we only include these if we had them. For now, we skip them
  // since the payload only has boolean flags, not actual values.
  // This prevents us from inventing data.

  // Call to action with salon name
  const salon = salonName || 'Nail Salon No. 5';
  parts.push(`Book your next appointment at ${salon}.`);

  // Hashtags
  parts.push(DEFAULT_HASHTAGS);

  return parts.join('\n\n');
}

/**
 * Attempt to generate an AI-powered caption.
 *
 * TODO: Implement real AI caption generation.
 * This could use:
 * - OpenAI GPT-4
 * - Anthropic Claude
 * - Custom fine-tuned model
 *
 * For now, returns null to trigger fallback.
 */
async function generateAiCaption(
  _payload: PostPayload,
  _salonName?: string,
): Promise<string | null> {
  // TODO: Implement AI caption generation
  //
  // Example implementation with OpenAI:
  // const response = await openai.chat.completions.create({
  //   model: 'gpt-4',
  //   messages: [
  //     { role: 'system', content: 'You are a social media manager for a nail salon...' },
  //     { role: 'user', content: `Generate a caption for a nail photo...` }
  //   ],
  //   max_tokens: 150,
  // });
  // return response.choices[0]?.message?.content ?? null;

  // For now, return null to use deterministic fallback
  return null;
}
