import { eq, and } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { NextResponse, type NextRequest } from 'next/server';

import { db } from '@/libs/DB';
import { salonPageAppearanceSchema, THEMEABLE_PAGES } from '@/models/Schema';

// Demo salon ID for now - in production, this would come from auth context
const DEMO_SALON_ID = 'salon_nail-salon-no5';

/**
 * GET /api/salon/page-appearance
 *
 * Returns all page appearance settings for the salon.
 * Used by admin UI to display current settings.
 */
export async function GET() {
  try {
    const appearances = await db
      .select()
      .from(salonPageAppearanceSchema)
      .where(eq(salonPageAppearanceSchema.salonId, DEMO_SALON_ID));

    // Build a complete list with defaults for pages that don't have rows yet
    const result = THEMEABLE_PAGES.map((pageName) => {
      const existing = appearances.find((a) => a.pageName === pageName);
      if (existing) {
        return {
          pageName: existing.pageName,
          mode: existing.mode,
          themeKey: existing.themeKey,
        };
      }
      // Default: custom mode with no theme
      return {
        pageName,
        mode: 'custom' as const,
        themeKey: null,
      };
    });

    return NextResponse.json({ pages: result });
  } catch (error) {
    console.error('[GET /api/salon/page-appearance] Error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch page appearances' },
      { status: 500 },
    );
  }
}

/**
 * PUT /api/salon/page-appearance
 *
 * Updates mode and themeKey for a specific page.
 *
 * Body: { pageName: string, mode: 'custom' | 'theme', themeKey?: string }
 */
export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    const { pageName, mode, themeKey } = body as {
      pageName: string;
      mode: 'custom' | 'theme';
      themeKey?: string | null;
    };

    // Validate pageName
    if (!pageName || !THEMEABLE_PAGES.includes(pageName as typeof THEMEABLE_PAGES[number])) {
      return NextResponse.json(
        { error: `Invalid pageName. Must be one of: ${THEMEABLE_PAGES.join(', ')}` },
        { status: 400 },
      );
    }

    // Validate mode
    if (!mode || !['custom', 'theme'].includes(mode)) {
      return NextResponse.json(
        { error: 'Invalid mode. Must be "custom" or "theme"' },
        { status: 400 },
      );
    }

    // If mode is 'theme', themeKey should be provided
    if (mode === 'theme' && !themeKey) {
      return NextResponse.json(
        { error: 'themeKey is required when mode is "theme"' },
        { status: 400 },
      );
    }

    // Check if row exists
    const [existing] = await db
      .select()
      .from(salonPageAppearanceSchema)
      .where(
        and(
          eq(salonPageAppearanceSchema.salonId, DEMO_SALON_ID),
          eq(salonPageAppearanceSchema.pageName, pageName),
        ),
      )
      .limit(1);

    if (existing) {
      // Update existing row
      await db
        .update(salonPageAppearanceSchema)
        .set({
          mode,
          themeKey: mode === 'theme' ? themeKey : null,
          updatedAt: new Date(),
        })
        .where(eq(salonPageAppearanceSchema.id, existing.id));
    } else {
      // Insert new row
      await db.insert(salonPageAppearanceSchema).values({
        id: `appearance_${nanoid(12)}`,
        salonId: DEMO_SALON_ID,
        pageName,
        mode,
        themeKey: mode === 'theme' ? themeKey : null,
      });
    }

    return NextResponse.json({
      success: true,
      pageName,
      mode,
      themeKey: mode === 'theme' ? themeKey : null,
    });
  } catch (error) {
    console.error('[PUT /api/salon/page-appearance] Error:', error);
    return NextResponse.json(
      { error: 'Failed to update page appearance' },
      { status: 500 },
    );
  }
}



