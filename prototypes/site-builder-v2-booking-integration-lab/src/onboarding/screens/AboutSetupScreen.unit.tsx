import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { createDanielaFixtureState } from '../fixtures';
import type { OnboardingLabState } from '../model/types';
import { AboutSetupScreen } from './AboutSetupScreen';

vi.mock('../../custom-design/integration/CustomDesignAssetProvider', () => ({
  useCustomDesignAssetMap: () => new Map(),
}));

function AboutHarness({
  initial,
  onContinue = vi.fn(),
  onState,
}: {
  initial: OnboardingLabState;
  onContinue?: () => void;
  onState?: (state: OnboardingLabState) => void;
}) {
  const [state, setState] = useState(initial);
  return (
    <AboutSetupScreen
      onBack={vi.fn()}
      onContinue={onContinue}
      onEditProfile={vi.fn()}
      onUpdate={(transform) => setState((current) => {
        const next = transform(current);
        onState?.(next);
        return next;
      })}
      state={state}
    />
  );
}

const createState = (): OnboardingLabState => {
  const state = createDanielaFixtureState();
  state.progress.currentScreen = 'about';
  state.profile.about = {
    ...state.profile.about,
    certifications: [],
    clientAppreciation: 'This legacy answer stays stored but is not asked again.',
    fullBio: '',
    languages: [],
    shortBio: '',
    specialties: [],
    yearsOfExperience: '',
  };
  return state;
};

describe('Screen 8 About', () => {
  it('starts as three manageable tasks using the saved identity and no customer preview', () => {
    render(<AboutHarness initial={createState()} />);

    expect(screen.getByRole('heading', { name: 'Tell clients a little about you' })).toBeVisible();
    expect(screen.getByText('KEEP IT SIMPLE')).toBeVisible();
    expect(screen.getByRole('switch', { name: 'Show an About section' })).toBeChecked();
    expect(screen.getByText('Daniela')).toBeVisible();
    expect(screen.getByText('Isla Nail Studio')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Edit profile' })).toBeVisible();
    expect(screen.getByRole('textbox', { name: 'Short introduction' })).toHaveAttribute('maxlength', '180');
    expect(screen.getByRole('button', { name: /Introduction/ })).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('button', { name: /Specialties & experience/ })).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByRole('button', { name: /Add more details/ })).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('Preview your About section')).not.toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: /Instagram/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/clients appreciate/i)).not.toBeInTheDocument();
  });

  it('preserves About data when hidden and when Skip for now continues', async () => {
    const user = userEvent.setup();
    const initial = createState();
    initial.profile.about.shortBio = 'Keep this introduction safe.';
    let latest = initial;
    const onContinue = vi.fn();
    render(<AboutHarness initial={initial} onContinue={onContinue} onState={(state) => { latest = state; }} />);

    await user.click(screen.getByRole('switch', { name: 'Show an About section' }));
    expect(latest.recipe.aboutEnabled).toBe(false);
    expect(latest.profile.about.shortBio).toBe('Keep this introduction safe.');
    expect(screen.queryByRole('textbox', { name: 'Short introduction' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Skip for now' }));
    expect(onContinue).toHaveBeenCalledOnce();
    expect(latest.profile.about.shortBio).toBe('Keep this introduction safe.');
  });

  it('marks the introduction complete without collapsing while the owner types', async () => {
    const user = userEvent.setup();
    let latest = createState();
    render(<AboutHarness initial={latest} onState={(state) => { latest = state; }} />);

    const introduction = screen.getByRole('textbox', { name: 'Short introduction' });
    await user.type(introduction, 'Two sentences are enough to introduce my calm nail studio.');

    expect(latest.profile.about.shortBio).toBe('Two sentences are enough to introduce my calm nail studio.');
    expect(screen.getByText('About added')).toBeVisible();
    expect(screen.getByRole('button', { name: /Introduction/ })).toHaveAttribute('aria-expanded', 'true');
  });

  it('stores specialties, experience, full bio, certifications and languages in canonical About data', async () => {
    const user = userEvent.setup();
    let latest = createState();
    render(<AboutHarness initial={latest} onState={(state) => { latest = state; }} />);

    await user.click(screen.getByRole('button', { name: /Specialties & experience/ }));
    await user.click(screen.getByRole('checkbox', { name: 'BIAB' }));
    await user.type(screen.getByLabelText('Add your own'), 'Bridal nails');
    await user.click(screen.getByRole('button', { name: 'Add specialty' }));
    await user.type(screen.getByRole('spinbutton', { name: /Years of experience/ }), '12');
    expect(latest.profile.about.specialties).toEqual(['BIAB', 'Bridal nails']);
    expect(latest.profile.about.yearsOfExperience).toBe('12');

    await user.click(screen.getByRole('button', { name: /Add more details/ }));
    await user.click(screen.getByRole('button', { name: /Full bio Not added/ }));
    const bioDialog = screen.getByRole('dialog', { name: 'Full bio · Optional' });
    fireEvent.change(within(bioDialog).getByRole('textbox', { name: 'Full bio' }), {
      target: { value: 'My longer nail-care story.' },
    });
    await user.click(within(screen.getByRole('dialog', { name: 'Full bio · Optional' })).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(latest.profile.about.fullBio).toBe('My longer nail-care story.'));

    await user.click(screen.getByRole('button', { name: /Certifications Not added/ }));
    const certificationDialog = screen.getByRole('dialog', { name: 'Certifications · Optional' });
    fireEvent.change(within(certificationDialog).getByRole('textbox', { name: 'Add certification' }), {
      target: { value: 'Gel-X Certification' },
    });
    await user.click(within(screen.getByRole('dialog', { name: 'Certifications · Optional' })).getByRole('button', { name: 'Add' }));
    await user.click(within(screen.getByRole('dialog', { name: 'Certifications · Optional' })).getByRole('button', { name: 'Save' }));

    await user.click(screen.getByRole('button', { name: /Languages Not added/ }));
    const languageDialog = screen.getByRole('dialog', { name: 'Languages · Optional' });
    fireEvent.change(within(languageDialog).getByRole('textbox', { name: 'Add language' }), {
      target: { value: 'English' },
    });
    await user.click(within(screen.getByRole('dialog', { name: 'Languages · Optional' })).getByRole('button', { name: 'Add' }));
    await user.click(within(screen.getByRole('dialog', { name: 'Languages · Optional' })).getByRole('button', { name: 'Save' }));

    expect(latest.profile.about.certifications).toEqual(['Gel-X Certification']);
    expect(latest.profile.about.languages).toEqual(['English']);
  });

  it('previews a writing suggestion and changes the introduction only after Use suggestion', async () => {
    const user = userEvent.setup();
    let latest = createState();
    render(<AboutHarness initial={latest} onState={(state) => { latest = state; }} />);

    await user.click(screen.getByRole('button', { name: 'Help me write' }));
    const contextDialog = screen.getByRole('dialog', { name: 'Tell us a little about yourself' });
    fireEvent.change(within(contextDialog).getByRole('textbox'), {
      target: { value: 'I specialize in natural nails and relaxed appointments.' },
    });
    await user.click(within(screen.getByRole('dialog', { name: 'Tell us a little about yourself' })).getByRole('button', { name: 'Generate suggestion' }));
    expect(latest.profile.about.shortBio).toBe('');

    const suggestionDialog = await screen.findByRole('dialog', { name: 'Your suggested introduction' });
    await user.click(within(suggestionDialog).getByRole('button', { name: 'Use suggestion' }));
    expect(latest.profile.about.shortBio).toContain('I specialize in natural nails');
    expect(latest.profile.about.shortBio.length).toBeLessThanOrEqual(180);
  });

  it('continues to About layout without requiring optional content', async () => {
    const user = userEvent.setup();
    const onContinue = vi.fn();
    render(<AboutHarness initial={createState()} onContinue={onContinue} />);

    await user.click(screen.getByRole('button', { name: 'Save and continue' }));
    expect(onContinue).toHaveBeenCalledOnce();
  });
});
