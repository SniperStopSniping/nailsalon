/**
 * Route an explicit amount edit to the real service draft, never source text.
 * Ambiguous pricing requests still belong in the business conversation.
 */
export function isExplicitServicePriceEdit(message: string) {
  return /\b(?:change|set|update|make)\b/iu.test(message)
    && /[$€£]\s*\d|\b(?:CAD|USD)\s*\d|\d\s*(?:CAD|USD|dollars)\b/iu.test(message);
}
