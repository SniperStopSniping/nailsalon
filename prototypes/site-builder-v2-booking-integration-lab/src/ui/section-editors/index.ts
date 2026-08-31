/**
 * Registry of library section editor bodies. Every V1 type has an entry; the
 * dialog's fallback exists only as a safety net for future types and never
 * fakes a control surface.
 */

import type { LibrarySectionType } from '../../model/types';
import { AboutEditor } from './about';
import { AnnouncementBarEditor } from './announcement-bar';
import { ContactEditor } from './contact';
import { DepositsCancellationsEditor } from './deposits-cancellations';
import { FaqEditor } from './faq';
import { FeaturedServicesEditor } from './featured-services';
import { FinalCtaEditor } from './final-cta';
import { FooterEditor } from './footer';
import { GallerySectionEditor } from './gallery';
import { HeroEditor } from './hero';
import { HoursEditor } from './hours';
import { OffersEditor } from './offers';
import { PoliciesEditor } from './policies';
import { QuickInfoEditor } from './quick-info';
import { ReviewsEditor } from './reviews';
import { SectionNavigationEditor } from './section-navigation';
import { TeamEditor } from './team';
import type { LibrarySectionEditorRegistry } from './types';
import { VisitUsEditor } from './visit-us';

export const LIBRARY_SECTION_EDITORS: LibrarySectionEditorRegistry = {
  about: AboutEditor,
  announcement_bar: AnnouncementBarEditor,
  contact: ContactEditor,
  deposits_cancellations: DepositsCancellationsEditor,
  faq: FaqEditor,
  featured_services: FeaturedServicesEditor,
  final_cta: FinalCtaEditor,
  footer: FooterEditor,
  gallery: GallerySectionEditor,
  hero: HeroEditor,
  hours: HoursEditor,
  offers: OffersEditor,
  policies: PoliciesEditor,
  quick_info: QuickInfoEditor,
  reviews: ReviewsEditor,
  section_navigation: SectionNavigationEditor,
  team: TeamEditor,
  visit_us: VisitUsEditor,
};

/** Compile-time completeness guard: every library type must have an editor. */
type MissingEditors = Exclude<LibrarySectionType, keyof typeof LIBRARY_SECTION_EDITORS>;
const _libraryEditorCompleteness: MissingEditors extends never ? true : never = true;
void _libraryEditorCompleteness;
