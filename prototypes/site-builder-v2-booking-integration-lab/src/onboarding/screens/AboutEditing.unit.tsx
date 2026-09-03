import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { createDanielaFixtureState } from '../fixtures';
import type { OnboardingLabState } from '../model/types';
import {
  AboutDesignScreen,
  LegacyAboutScreen as AboutScreen,
  type OnboardingStateUpdater,
} from './DesignScreens';

vi.mock('../../custom-design/integration/CustomDesignAssetProvider', () => ({
  useCustomDesignAssetMap: () => new Map(),
}));

const createAboutState = (): OnboardingLabState => {
  const state = createDanielaFixtureState();
  state.progress.currentScreen = 'about';
  state.progress.lastActiveScreen = 'about';
  state.progress.screenHistory = ['welcome', 'about'];
  state.progress.visitedScreens = ['welcome', 'about'];
  return state;
};

function AboutHarness({
  initial,
  onContinue = vi.fn(),
  onState,
}: {
  initial: OnboardingLabState;
  onContinue?: () => void;
  onState: (state: OnboardingLabState) => void;
}) {
  const [state, setState] = useState(initial);
  const update: OnboardingStateUpdater = (transform) => setState((current) => {
    const next = transform(current);
    onState(next);
    return next;
  });
  return (
    <AboutScreen
      onBack={vi.fn()}
      onContinue={onContinue}
      onFullPreview={vi.fn()}
      onUpdate={update}
      state={state}
    />
  );
}

describe('About list editing', () => {
  it('keeps raw typing, cursor edits, deletion, and paste intact while synchronizing structured values', async () => {
    const user = userEvent.setup();
    const initial = createAboutState();
    initial.profile.about.certifications = [];
    initial.profile.about.languages = [];
    let latest = initial;
    const onContinue = vi.fn();

    render(
      <AboutHarness
        initial={initial}
        onContinue={onContinue}
        onState={(state) => { latest = state; }}
      />,
    );

    await user.click(screen.getByText('More about you'));
    const certifications = screen.getByRole('textbox', { name: 'Certifications — optional' });
    const languages = screen.getByRole('textbox', { name: 'Languages — optional' });
    const customSpecialties = screen.getByRole('textbox', {
      name: 'Custom specialties separated by commas',
    });
    await user.type(customSpecialties, 'Structured gel, Bridal nails');
    expect(customSpecialties).toHaveValue('Structured gel, Bridal nails');
    expect(latest.profile.about.specialties).not.toContain('Structured gel');
    await user.click(certifications);
    expect(latest.profile.about.specialties).toEqual(expect.arrayContaining([
      'Structured gel',
      'Bridal nails',
    ]));
    const certificationRaw = 'Advanced Russian, BIAB; Gel-X';
    await user.type(certifications, certificationRaw);
    expect(certifications).toHaveValue(certificationRaw);
    expect(latest.profile.about.certifications).toEqual([]);

    (certifications as HTMLTextAreaElement).setSelectionRange(0, 0);
    await user.type(certifications, 'Lead ', { skipClick: true });
    expect(certifications).toHaveValue(`Lead ${certificationRaw}`);
    (certifications as HTMLTextAreaElement).setSelectionRange(0, 5);
    await user.keyboard('{Backspace}');
    expect(certifications).toHaveValue(certificationRaw);

    await user.click(languages);
    expect(latest.profile.about.certifications).toEqual([
      'Advanced Russian',
      'BIAB',
      'Gel-X',
    ]);
    await user.paste('English;\nSpanish, French');
    expect(languages).toHaveValue('English;\nSpanish, French');
    expect(latest.profile.about.languages).toEqual([]);

    await user.keyboard('{Enter}');
    expect(languages).toHaveValue('English;\nSpanish, French\n');
    expect(latest.profile.about.languages).toEqual(['English', 'Spanish', 'French']);
    await user.type(languages, 'German');
    expect(languages).toHaveValue('English;\nSpanish, French\nGerman');
    expect(latest.profile.about.languages).toEqual(['English', 'Spanish', 'French']);

    await user.click(screen.getByRole('button', { name: 'Choose an About design' }));
    expect(onContinue).toHaveBeenCalledOnce();
    expect(latest.profile.about.certifications).toEqual([
      'Advanced Russian',
      'BIAB',
      'Gel-X',
    ]);
    expect(latest.profile.about.languages).toEqual([
      'English',
      'Spanish',
      'French',
      'German',
    ]);
    expect(certifications).toHaveValue(certificationRaw);
    expect(languages).toHaveValue('English;\nSpanish, French\nGerman');
  });

  it('preserves the latest focused raw-list edit across a browser-like Back unmount', async () => {
    const user = userEvent.setup();
    const initial = createAboutState();
    initial.profile.about.certifications = [];
    initial.profile.about.languages = [];
    let latest = initial;
    const view = render(
      <AboutHarness
        initial={initial}
        onState={(state) => { latest = state; }}
      />,
    );

    await user.click(screen.getByText('More about you'));
    const certifications = screen.getByRole('textbox', { name: 'Certifications — optional' });
    await user.type(certifications, 'CND Certified; Gel-X Advanced');
    expect(certifications).toHaveFocus();
    view.unmount();

    expect(latest.profile.about.certifications).toEqual([
      'CND Certified',
      'Gel-X Advanced',
    ]);
    render(
      <AboutHarness
        initial={structuredClone(latest)}
        onState={(state) => { latest = state; }}
      />,
    );
    await user.click(screen.getByText('More about you'));
    expect(screen.getByRole('textbox', { name: 'Certifications — optional' }))
      .toHaveValue('CND Certified, Gel-X Advanced');
  });

  it('commits the latest focused raw-list edit before pagehide autosave', async () => {
    const user = userEvent.setup();
    const initial = createAboutState();
    initial.profile.about.certifications = [];
    let latest = initial;
    render(
      <AboutHarness
        initial={initial}
        onState={(state) => { latest = state; }}
      />,
    );

    await user.click(screen.getByText('More about you'));
    const certifications = screen.getByRole('textbox', {
      name: 'Certifications — optional',
    });
    await user.type(certifications, 'Russian manicure certification; BIAB certification');
    expect(certifications).toHaveFocus();
    expect(latest.profile.about.certifications).toEqual([]);

    fireEvent(window, new Event('pagehide'));
    expect(latest.profile.about.certifications).toEqual([
      'Russian manicure certification',
      'BIAB certification',
    ]);
  });

  it('preserves composing raw text and structured values through Off/On, remount, and presets', async () => {
    const user = userEvent.setup();
    const initial = createAboutState();
    initial.profile.about.languages = ['English'];
    let latest = initial;
    const view = render(
      <AboutHarness
        initial={initial}
        onState={(state) => { latest = state; }}
      />,
    );
    await user.click(screen.getByText('More about you'));
    const languages = screen.getByRole('textbox', { name: 'Languages — optional' });

    fireEvent.compositionStart(languages);
    fireEvent.change(languages, { target: { value: 'English;\n日本語' } });
    fireEvent.keyUp(languages, { isComposing: true, key: 'Enter' });
    expect(languages).toHaveValue('English;\n日本語');
    expect(latest.profile.about.languages).toEqual(['English']);
    fireEvent.compositionEnd(languages);
    fireEvent.keyUp(languages, { isComposing: false, key: 'Enter' });
    expect(latest.profile.about.languages).toEqual(['English', '日本語']);

    await user.click(screen.getByRole('switch', { name: 'Include an About section' }));
    expect(screen.getByRole('status')).toHaveTextContent(
      'About section is not shown on your site. Your information is still saved.',
    );
    expect(screen.getByRole('group', { name: 'About section details' })).toBeDisabled();
    expect(languages).toBeDisabled();
    expect(languages).toHaveValue('English;\n日本語');
    await user.click(screen.getByRole('switch', { name: 'Include an About section' }));
    expect(languages).toBeEnabled();
    expect(languages).toHaveValue('English;\n日本語');
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'Short bio' })).toHaveFocus());
    expect(latest.profile.about.languages).toEqual(['English', '日本語']);

    view.unmount();
    const reloadedState = structuredClone(latest);
    const remount = render(
      <AboutHarness
        initial={reloadedState}
        onState={(state) => { latest = state; }}
      />,
    );
    await user.click(screen.getByText('More about you'));
    expect(screen.getByRole('textbox', { name: 'Languages — optional' }))
      .toHaveValue('English, 日本語');
    remount.unmount();

    reloadedState.progress.currentScreen = 'about_design';
    render(
      <AboutDesignScreen
        document={null}
        onBack={vi.fn()}
        onContinue={vi.fn()}
        onFullPreview={vi.fn()}
        onUpdate={(transform) => {
          latest = transform(latest);
        }}
        state={reloadedState}
      />,
    );
    await user.click(screen.getByRole('button', { name: /Editorial Portrait/ }));
    await user.click(screen.getByRole('button', { name: /Profile \+ Quick Facts/ }));
    expect(latest.profile.about.languages).toEqual(['English', '日本語']);
  });
});

describe('About prototype writing helper', () => {
  it('previews deterministically, requires Use or Keep, and undoes to the exact prior bio', async () => {
    const user = userEvent.setup();
    const initial = createAboutState();
    const exactOriginalBio = '  My exact bio,\nwith punctuation.  ';
    initial.profile.about.shortBio = exactOriginalBio;
    let latest = initial;
    render(
      <AboutHarness
        initial={initial}
        onState={(state) => { latest = state; }}
      />,
    );

    const helper = screen.getByRole('button', { name: /Help me with wording/ });
    expect(within(helper).getByText('Preview wording')).toBeVisible();
    expect(screen.queryByText(/prototype helper|prototype suggestion/iu)).not.toBeInTheDocument();
    await user.click(helper);
    const firstReview = screen.getByRole('dialog', { name: 'Use this suggested bio?' });
    expect(within(firstReview).getByText('Writing suggestion')).toBeVisible();
    expect(within(firstReview).getByText('Current bio')).toBeVisible();
    expect(within(firstReview).getByText('Suggested bio')).toBeVisible();
    const firstSuggestion = within(firstReview).getByText(/^I’m Daniela,/).textContent ?? '';
    expect(firstSuggestion).toContain('Isla Nail Studio');
    expect(latest.profile.about.shortBio).toBe(exactOriginalBio);
    expect(screen.getByRole('textbox', { name: 'Short bio' })).toHaveValue(exactOriginalBio);
    expect(latest.eventJournal.at(-1)).toMatchObject({
      action: 'opened',
      type: 'about_wording_helper',
    });

    await user.click(within(firstReview).getByRole('button', { name: 'Keep my bio' }));
    expect(latest.profile.about.shortBio).toBe(exactOriginalBio);
    expect(screen.getByRole('status')).toHaveTextContent('existing bio was kept unchanged');
    expect(latest.eventJournal.at(-1)).toMatchObject({
      action: 'kept',
      type: 'about_wording_helper',
    });

    await user.click(helper);
    const secondReview = screen.getByRole('dialog', { name: 'Use this suggested bio?' });
    const secondSuggestion = within(secondReview).getByText(/^I’m Daniela,/).textContent ?? '';
    expect(secondSuggestion).toBe(firstSuggestion);
    await user.click(within(secondReview).getByRole('button', { name: 'Use suggestion' }));
    expect(latest.profile.about.shortBio).toBe(firstSuggestion);
    expect(screen.getByRole('textbox', { name: 'Short bio' })).toHaveValue(firstSuggestion);
    expect(screen.getByRole('status')).toHaveTextContent('Suggestion added');
    expect(latest.eventJournal.at(-1)).toMatchObject({
      action: 'used',
      type: 'about_wording_helper',
    });
    expect(JSON.stringify(latest.eventJournal)).not.toContain(exactOriginalBio.trim());
    expect(JSON.stringify(latest.eventJournal)).not.toContain(firstSuggestion);

    await user.click(screen.getByRole('button', { name: 'Undo suggestion' }));
    expect(latest.profile.about.shortBio).toBe(exactOriginalBio);
    expect(screen.getByRole('textbox', { name: 'Short bio' })).toHaveValue(exactOriginalBio);
    expect(screen.getByRole('status')).toHaveTextContent('previous bio was restored');
    expect(latest.eventJournal.at(-1)).toMatchObject({
      action: 'undone',
      type: 'about_wording_helper',
    });
  });

  it('shows only the suggested bio block when there is no current bio', async () => {
    const user = userEvent.setup();
    const initial = createAboutState();
    initial.profile.about.shortBio = '';
    render(
      <AboutHarness
        initial={initial}
        onState={vi.fn()}
      />,
    );

    await user.click(screen.getByRole('button', { name: /Help me with wording/ }));
    const review = screen.getByRole('dialog', { name: 'Use this suggested bio?' });
    expect(within(review).queryByText('Current bio')).not.toBeInTheDocument();
    expect(within(review).getByText('Suggested bio')).toBeVisible();
    expect(screen.getByRole('textbox', { name: 'Short bio' })).toHaveValue('');
  });

  it('irreversibly invalidates helper Undo after any later owner edit', async () => {
    const user = userEvent.setup();
    const initial = createAboutState();
    initial.profile.about.shortBio = 'My original bio.';
    let latest = initial;
    render(
      <AboutHarness
        initial={initial}
        onState={(state) => { latest = state; }}
      />,
    );

    await user.click(screen.getByRole('button', { name: /Help me with wording/ }));
    const review = screen.getByRole('dialog', { name: 'Use this suggested bio?' });
    const suggestion = within(review).getByText(/^I’m Daniela,/).textContent ?? '';
    await user.click(within(review).getByRole('button', { name: 'Use suggestion' }));
    expect(screen.getByRole('button', { name: 'Undo suggestion' })).toBeVisible();

    const bio = screen.getByRole('textbox', { name: 'Short bio' });
    fireEvent.change(bio, { target: { value: 'A later owner edit.' } });
    fireEvent.change(bio, { target: { value: suggestion } });

    expect(latest.profile.about.shortBio).toBe(suggestion);
    expect(screen.queryByRole('button', { name: 'Undo suggestion' })).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('can no longer be undone');
  });
});
