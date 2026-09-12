// No DB or live salon content is accessed by this browser fixture.
export function resolveBookingPageContent() {
  const side = { locationDisplayMode: 'city_only' };
  return { draft: side, live: side };
}
