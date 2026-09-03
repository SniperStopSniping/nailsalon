import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { createDeterministicIdFactory } from '../../model/ids';
import { addSection } from '../../model/operations';
import { isLibrarySection } from '../../model/section-library/registry';
import { initializeStarter } from '../../model/starters';
import { createDemoOnboardingState } from '../../onboarding/model/demo-content';
import { deriveSiteLibraryContext, deriveSitePlanToggles } from '../../onboarding/model/site-library-context';
import { LibrarySectionSettingsDialog } from './LibrarySectionSettingsDialog';

describe('LibrarySectionSettingsDialog content placement feedback', () => {
  it('explains same-page Featured suppression and exposes each resolution action', async () => {
    const user = userEvent.setup();
    const state = createDemoOnboardingState();
    state.recipe.starter = 'one_page';
    const ids = createDeterministicIdFactory('featured-dialog');
    let document = initializeStarter('one_page', { idFactory: ids });
    const home = document.pages[0];
    if (!home) {
      throw new Error('One-page starter is missing Home.');
    }
    document = addSection(document, {
      pageId: home.id,
      sectionType: 'featured_services',
    }, ids);
    const featured = document.pages[0]?.sections.find(
      section => section.sectionType === 'featured_services',
    );
    const booking = document.pages[0]?.sections.find(
      section => section.sectionType === 'booking',
    );
    if (!featured || !isLibrarySection(featured) || !booking) {
      throw new Error('One-page starter is missing Featured or Booking.');
    }
    const onClose = vi.fn();
    const onGoToSection = vi.fn();
    const onHideSection = vi.fn();
    const onMoveSection = vi.fn();

    render(
      <LibrarySectionSettingsDialog
        context={deriveSiteLibraryContext(state, document)}
        document={document}
        onClose={onClose}
        onGoToSection={onGoToSection}
        onHideSection={onHideSection}
        onMoveSection={onMoveSection}
        onSave={vi.fn()}
        onSiteContent={() => true}
        profile={state.profile}
        section={featured}
        toggles={deriveSitePlanToggles(state)}
      />,
    );

    expect(screen.getByText(
      'Featured Services is not shown on this page because Services & Booking already displays your services.',
    )).toBeVisible();

    await user.click(screen.getByRole('button', { name: 'Go to Services & Booking' }));

    expect(onGoToSection).toHaveBeenCalledWith(booking.id);

    await user.click(screen.getByRole('button', {
      name: 'Move Featured Services to another page',
    }));

    expect(onMoveSection).toHaveBeenCalledWith(featured.id);

    await user.click(screen.getByRole('button', {
      name: 'Hide Services & Booking and show Featured Services',
    }));

    expect(onHideSection).toHaveBeenCalledWith(booking.id);

    expect(onClose).not.toHaveBeenCalled();
  });
});
