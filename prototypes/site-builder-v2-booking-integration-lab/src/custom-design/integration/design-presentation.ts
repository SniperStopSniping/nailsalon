/** Owner labels only: retain the existing persisted display modes. */
export const DESIGN_DISPLAY_CHOICES = [
  ['poster', 'Fit to screen', 'Full width on phones, centred on larger screens. A good starting point for a Canva page.'],
  ['contained', 'Wide & centred', 'A wider design on larger screens. Useful for landscape artwork.'],
  ['full_width', 'Full width', 'Use the available width from edge to edge. Your image keeps its proportions.'],
] as const;

export const DESIGN_BACKGROUND_COLOURS = [
  ['White', '#FFFFFF'],
  ['Cream', '#FFF8F0'],
  ['Blush', '#FBE8EF'],
  ['Dark', '#231E22'],
] as const;
