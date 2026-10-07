/** Shared by the public renderer and owner controls; does not load public CSS. */
export function isIslaBookingPage(salonSlug: string | null | undefined) {
  return salonSlug === 'isla-nail-studio';
}
