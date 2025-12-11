/**
 * Page Appearance Helper
 *
 * Resolves theme settings for a specific page within a salon.
 * Supports per-page theming where each page can either:
 * - Use custom styling (no theme injection)
 * - Use a specific theme from the registry (espresso, lavender, etc.)
 */

import { eq, and } from 'drizzle-orm';

import { db } from './DB';
import { salonPageAppearanceSchema } from '@/models/Schema';
import type { PageAppearanceMode } from '@/models/Schema';

/**
 * Page appearance result
 */
export interface PageAppearanceResult {
  /** Mode: 'custom' = no theme, 'theme' = use themeKey */
  mode: PageAppearanceMode;
  /** Theme key when mode = 'theme', null otherwise */
  themeKey: string | null;
}

/**
 * Get page appearance settings for a specific page within a salon.
 *
 * Resolution logic:
 * 1. No row exists -> returns { mode: 'custom', themeKey: null }
 * 2. Row with mode: 'custom' -> returns { mode: 'custom', themeKey: null }
 * 3. Row with mode: 'theme' -> returns { mode: 'theme', themeKey: row.themeKey ?? 'espresso' }
 *
 * @param salonId - The salon's database ID
 * @param pageName - The page identifier (e.g., 'rewards', 'profile', 'gallery')
 * @returns Page appearance settings with mode and optional themeKey
 */
export async function getPageAppearance(
  salonId: string,
  pageName: string,
): Promise<PageAppearanceResult> {
  // Default: custom mode with no theme (page renders as-is)
  const defaultResult: PageAppearanceResult = {
    mode: 'custom',
    themeKey: null,
  };

  try {
    const [appearance] = await db
      .select()
      .from(salonPageAppearanceSchema)
      .where(
        and(
          eq(salonPageAppearanceSchema.salonId, salonId),
          eq(salonPageAppearanceSchema.pageName, pageName),
        ),
      )
      .limit(1);

    // No row found - use default (custom mode)
    if (!appearance) {
      return defaultResult;
    }

    // Custom mode - no theme injection
    if (appearance.mode === 'custom') {
      return defaultResult;
    }

    // Theme mode - use the configured theme (or fallback to espresso)
    if (appearance.mode === 'theme') {
      return {
        mode: 'theme',
        themeKey: appearance.themeKey ?? 'espresso',
      };
    }

    // Unknown mode - fall back to custom
    return defaultResult;
  } catch (error) {
    // On any DB error, fall back to custom mode
    // This ensures pages always render, even if appearance lookup fails
    console.error('[getPageAppearance] Error fetching appearance:', error);
    return defaultResult;
  }
}

/**
 * Get all page appearance settings for a salon.
 * Used by admin UI to display current settings.
 *
 * @param salonId - The salon's database ID
 * @returns Array of page appearance settings
 */
export async function getAllPageAppearances(salonId: string) {
  try {
    return await db
      .select()
      .from(salonPageAppearanceSchema)
      .where(eq(salonPageAppearanceSchema.salonId, salonId));
  } catch (error) {
    console.error('[getAllPageAppearances] Error:', error);
    return [];
  }
}


