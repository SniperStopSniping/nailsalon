import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';

import { SECTION_LIBRARY_REGISTRY } from '../../model/section-library/registry';
import type {
  AboutSectionSettings,
  HeroSettings,
  VisitUsSettings,
} from '../../model/section-library/settings';
import { initializeStarter } from '../../model/starters';
import { resolveAboutBio } from '../../onboarding/model/about';
import { createDemoOnboardingState } from '../../onboarding/model/demo-content';
import { deriveSiteLibraryContext } from '../../onboarding/model/site-library-context';
import type { OnboardingLabState } from '../../onboarding/model/types';
import { AboutEditor } from './about';
import { ContactEditor } from './contact';
import { HeroEditor } from './hero';
import { VisitUsEditor } from './visit-us';

/** Shared props every editor body takes, built from the demo authorities. */
const createSharedProps = (state: OnboardingLabState = createDemoOnboardingState()) => {
  const builderDocument = initializeStarter('quick_book');
  return {
    context: deriveSiteLibraryContext(state, builderDocument),
    document: builderDocument,
    onSiteContent: vi.fn(() => true),
    profile: state.profile,
    sectionId: 'section-under-test',
  };
};

/** The `.form-field` wrapper a labelled control group renders into. */
const fieldFor = (label: string): HTMLElement => {
  const field = screen.getByText(label).closest('.form-field');
  if (!(field instanceof HTMLElement)) throw new Error(`No field found for “${label}”.`);
  return field;
};

const withEmptyLocation = (): OnboardingLabState => {
  const state = createDemoOnboardingState();
  return {
    ...state,
    profile: {
      ...state.profile,
      location: {
        ...state.profile.location,
        entranceInstructions: '',
        parking: '',
        transitInformation: '',
      },
    },
  };
};

describe('Hero editor', () => {
  it('renders the live shared values behind the current settings', () => {
    const shared = createSharedProps();
    const settings = SECTION_LIBRARY_REGISTRY.hero.defaultSettings();

    render(<HeroEditor {...shared} onChange={vi.fn()} settings={settings} />);

    expect(screen.getByText('Currently: “Isla Nail Studio”')).toBeVisible();
    expect(screen.getByText(
      'Currently: “Thoughtful nail care from a team, shaped around you.”',
    )).toBeVisible();
    expect(screen.getByRole('button', { name: 'Use my business name' }))
      .toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'My photo' }))
      .toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('Shows “Leslieville, Toronto” above your headline.')).toBeVisible();
    expect(screen.getByRole('checkbox', { name: /Show the location line/u })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: /Show the status line/u })).toBeChecked();
    const cta = screen.getByDisplayValue('Book an appointment');
    expect(cta).toHaveAttribute('maxlength', '40');
  });

  it('changes the media choice to the exact settings the registry keeps', async () => {
    const user = userEvent.setup();
    const shared = createSharedProps();
    const settings = SECTION_LIBRARY_REGISTRY.hero.defaultSettings();
    const onChange = vi.fn();

    render(<HeroEditor {...shared} onChange={onChange} settings={settings} />);
    await user.click(screen.getByRole('button', { name: 'Logo emblem' }));

    const next = { ...settings, media: 'logo_emblem' } satisfies HeroSettings;
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(next);
    // Rule 7: an edited draft must survive its own normalize unchanged.
    expect(SECTION_LIBRARY_REGISTRY.hero.normalize(next)).toEqual(next);
  });

  it('seeds a headline override from the shared business name without touching the profile', async () => {
    const user = userEvent.setup();
    const shared = createSharedProps();
    const settings = SECTION_LIBRARY_REGISTRY.hero.defaultSettings();
    const onChange = vi.fn();

    render(<HeroEditor {...shared} onChange={onChange} settings={settings} />);
    await user.click(
      within(fieldFor('Headline')).getByRole('button', { name: 'Write my own' }),
    );

    expect(onChange).toHaveBeenCalledWith({
      ...settings,
      headline: { source: 'override', value: 'Isla Nail Studio' },
    } satisfies HeroSettings);
    expect(shared.profile.businessName).toBe('Isla Nail Studio');
  });

  it('edits the booking button label within the registry clamp', async () => {
    const user = userEvent.setup();
    const shared = createSharedProps();
    const settings = SECTION_LIBRARY_REGISTRY.hero.defaultSettings();
    const onChange = vi.fn();

    render(<HeroEditor {...shared} onChange={onChange} settings={settings} />);
    await user.type(screen.getByDisplayValue('Book an appointment'), '!');

    const next = {
      ...settings,
      primaryCtaLabel: 'Book an appointment!',
    } satisfies HeroSettings;
    expect(onChange).toHaveBeenLastCalledWith(next);
    expect(SECTION_LIBRARY_REGISTRY.hero.normalize(next)).toEqual(next);
  });
});

describe('About editor', () => {
  it('shows the shared bio line and names the Business Profile authority', () => {
    const shared = createSharedProps();
    const bio = resolveAboutBio(shared.profile.about.shortBio, shared.profile.about.fullBio);
    if (!bio.lead) throw new Error('The demo profile is expected to have a bio.');

    render(
      <AboutEditor
        {...shared}
        onChange={vi.fn()}
        settings={SECTION_LIBRARY_REGISTRY.about.defaultSettings()}
      />,
    );

    expect(screen.getByText(`Currently: “${bio.lead}”`)).toBeVisible();
    expect(screen.getByText(/comes from\s+your Business Profile/u)).toBeVisible();
    expect(screen.queryByText(/no bio yet/u)).not.toBeInTheDocument();
  });

  it('says plainly when the shared bio is empty instead of inventing one', () => {
    const state = createDemoOnboardingState();
    const shared = createSharedProps({
      ...state,
      profile: {
        ...state.profile,
        about: { ...state.profile.about, fullBio: '', shortBio: '' },
      },
    });

    render(
      <AboutEditor
        {...shared}
        onChange={vi.fn()}
        settings={SECTION_LIBRARY_REGISTRY.about.defaultSettings()}
      />,
    );

    expect(screen.getByText('Currently: “”')).toBeVisible();
    expect(screen.getByText(/no bio yet/u)).toBeVisible();
  });

  it('seeds an intro override from the resolved shared bio lead', async () => {
    const user = userEvent.setup();
    const shared = createSharedProps();
    const settings = SECTION_LIBRARY_REGISTRY.about.defaultSettings();
    const bio = resolveAboutBio(shared.profile.about.shortBio, shared.profile.about.fullBio);
    const onChange = vi.fn();

    render(<AboutEditor {...shared} onChange={onChange} settings={settings} />);
    await user.click(screen.getByRole('button', { name: 'Write my own' }));

    const next = {
      ...settings,
      intro: { source: 'override' as const, value: bio.lead ?? '' },
    } satisfies AboutSectionSettings;
    expect(onChange).toHaveBeenCalledWith(next);
    expect(SECTION_LIBRARY_REGISTRY.about.normalize(next)).toEqual(next);
  });
});

describe('Visit Us editor', () => {
  it('hints each toggle with the live location text', () => {
    const shared = createSharedProps();

    render(
      <VisitUsEditor
        {...shared}
        onChange={vi.fn()}
        settings={SECTION_LIBRARY_REGISTRY.visit_us.defaultSettings()}
      />,
    );

    expect(screen.getByText('Free street parking on Curzon St.')).toBeVisible();
    expect(screen.getByText('Street-level entrance beside the plant shop.')).toBeVisible();
    expect(screen.getByText('Two minutes from the 501 Queen streetcar.')).toBeVisible();
    expect(screen.getByRole('checkbox', { name: /Show parking note/u })).toBeChecked();
    expect(within(fieldFor('Hours summary')).getByRole('button', { name: 'Automatic' }))
      .toHaveAttribute('aria-pressed', 'true');
  });

  it('marks an empty arrival note as not filled in rather than hiding the gap', () => {
    render(
      <VisitUsEditor
        {...createSharedProps(withEmptyLocation())}
        onChange={vi.fn()}
        settings={SECTION_LIBRARY_REGISTRY.visit_us.defaultSettings()}
      />,
    );

    expect(screen.getAllByText('(not filled in yet)')).toHaveLength(3);
  });

  it('changes only the hours summary mode', async () => {
    const user = userEvent.setup();
    const shared = createSharedProps();
    const settings = SECTION_LIBRARY_REGISTRY.visit_us.defaultSettings();
    const onChange = vi.fn();

    render(<VisitUsEditor {...shared} onChange={onChange} settings={settings} />);
    await user.click(
      within(fieldFor('Hours summary')).getByRole('button', { name: 'Always show' }),
    );

    const next = { ...settings, hoursSummary: 'show' } satisfies VisitUsSettings;
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(next);
    expect(SECTION_LIBRARY_REGISTRY.visit_us.normalize(next)).toEqual(next);
  });
});

describe('Contact editor', () => {
  it('lists the real public contact actions and offers no controls of its own', () => {
    const shared = createSharedProps();

    render(
      <ContactEditor
        {...shared}
        onChange={vi.fn()}
        settings={SECTION_LIBRARY_REGISTRY.contact.defaultSettings()}
      />,
    );

    expect(screen.getByText('Book now: Booking is the best way to reach us')).toBeVisible();
    expect(screen.getByText('Instagram: islanailstudio')).toBeVisible();
    expect(screen.queryAllByRole('button')).toHaveLength(0);
    expect(screen.queryAllByRole('textbox')).toHaveLength(0);
    expect(screen.queryAllByRole('checkbox')).toHaveLength(0);
  });

  it('says there is no public contact method instead of listing an empty surface', () => {
    const state = createDemoOnboardingState();
    const shared = createSharedProps({
      ...state,
      profile: {
        ...state.profile,
        bookingOnlyContact: false,
        clientContact: {
          ...state.profile.clientContact,
          callEnabled: false,
          primaryNumber: '',
          textEnabled: false,
        },
        email: '',
        instagram: '',
      },
    });

    render(
      <ContactEditor
        {...shared}
        onChange={vi.fn()}
        settings={SECTION_LIBRARY_REGISTRY.contact.defaultSettings()}
      />,
    );

    expect(screen.getByText(/No public way to reach you is set yet/u)).toBeVisible();
    expect(screen.queryByRole('listitem')).not.toBeInTheDocument();
  });
});
