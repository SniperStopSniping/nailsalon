const MINIMUM_TARGET_SIZE = 44;
// DOMRect subtraction can report 43.99998474121094 for a CSS 44px target.
// This is far smaller than a layout subpixel (1/64px), not a smaller target floor.
const DOM_RECT_EPSILON = 0.0001;

export function meetsMinimumTargetSize(target: { width: number; height: number }): boolean {
  return [target.width, target.height].every(dimension => (
    Number.isFinite(dimension) && dimension + DOM_RECT_EPSILON >= MINIMUM_TARGET_SIZE
  ));
}
