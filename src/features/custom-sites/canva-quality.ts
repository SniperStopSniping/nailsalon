export type ImageDimensions = { width: number; height: number };

/** Page geometry is preserved; different export sizes must not set desktop width. */
export function canvaPageWidth({ width, height }: ImageDimensions) {
  const ratio = height / width;
  return ratio >= 1.5 ? 600 : ratio >= 0.8 ? 800 : 1200;
}

/** Resolution advice only. Pixel dimensions cannot prove that printed text is readable. */
export function canvaImageQuality(page: ImageDimensions) {
  const displayWidth = canvaPageWidth(page);
  const recommendedWidth = displayWidth * 2;
  const recommendedHeight = Math.round(recommendedWidth * page.height / page.width);
  const level = page.width < displayWidth ? 'small' : page.width < recommendedWidth ? 'standard' : 'sharp';
  return { level, displayWidth, recommendedWidth, recommendedHeight } as const;
}

/** Only a replacement of the same composition can retain percentage-based links. */
export function sameCanvaProportions(before: ImageDimensions, after: ImageDimensions) {
  return before.width > 0 && before.height > 0 && after.width > 0 && after.height > 0
    && Math.abs((after.width / after.height) / (before.width / before.height) - 1) <= 0.01;
}
