import type { SectionType } from '../../model/types';

/**
 * Returns the canonical fragment id for a rendered customer section.
 *
 * Booking keeps its public `#booking` contract. Every other navigable section
 * derives its fragment from the stable section id so moving or relabelling a
 * section cannot break Section Navigation.
 */
export const sectionAnchorId = (
  sectionId: string,
  sectionType: SectionType,
): string => sectionType === 'booking' ? 'booking' : `section-${sectionId}`;
