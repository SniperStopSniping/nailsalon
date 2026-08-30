import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { createDefaultBusinessProfile } from '../model/defaults';
import { BrandBasicsScreen } from '../screens/BasicsScreens';
import {
  focusFirstInvalidControl,
  ImageUploadField,
  NativeSwitch,
} from './FormFields';

vi.mock('../../custom-design/integration/CustomDesignAssetProvider', () => ({
  useCustomDesignAssetMap: () => new Map(),
}));

describe('focusFirstInvalidControl', () => {
  it('focuses and scrolls the first enabled control nested in the first invalid group', async () => {
    const { container } = render(
      <form>
        <fieldset aria-invalid="true">
          <legend>First invalid group</legend>
          <input aria-label="Disabled choice" disabled type="radio" />
          <input aria-label="First enabled choice" type="radio" />
        </fieldset>
        <input aria-invalid="true" aria-label="Later invalid field" />
      </form>,
    );
    const form = container.querySelector('form');
    if (!form) throw new Error('Expected the focus-helper test form.');
    const target = screen.getByRole('radio', { name: 'First enabled choice' });
    const invalidGroup = screen.getByRole('group', { name: 'First invalid group' });
    const scrollIntoView = vi.fn();
    invalidGroup.scrollIntoView = scrollIntoView;

    focusFirstInvalidControl(form);

    await waitFor(() => expect(target).toHaveFocus());
    expect(scrollIntoView).toHaveBeenCalledWith({
      block: 'center',
      inline: 'nearest',
    });
    expect(screen.getByRole('textbox', { name: 'Later invalid field' }))
      .not.toHaveFocus();
  });

  it('moves a focused invalid control above the sticky actions in a short viewport', async () => {
    const { container } = render(
      <div>
        <header className="onboarding-shell__header" />
        <div className="onboarding-shell__progress" />
        <form>
          <label className="onboarding-field">
            Business name
            <input aria-invalid="true" />
          </label>
        </form>
        <footer className="sticky-onboarding-actions" />
      </div>,
    );
    const form = container.querySelector('form');
    const target = screen.getByRole('textbox', { name: 'Business name' });
    const header = container.querySelector<HTMLElement>('.onboarding-shell__header');
    const progress = container.querySelector<HTMLElement>('.onboarding-shell__progress');
    const footer = container.querySelector<HTMLElement>('.sticky-onboarding-actions');
    if (!form || !header || !progress || !footer) throw new Error('Missing focus geometry fixture.');
    header.getBoundingClientRect = () => ({ bottom: 70 } as DOMRect);
    progress.getBoundingClientRect = () => ({ bottom: 120 } as DOMRect);
    footer.getBoundingClientRect = () => ({ top: 305 } as DOMRect);
    target.getBoundingClientRect = () => ({
      bottom: 340,
      height: 48,
      top: 292,
      width: 240,
    } as DOMRect);
    target.closest<HTMLElement>('.onboarding-field')!.scrollIntoView = vi.fn();
    const scrollBy = vi.spyOn(window, 'scrollBy').mockImplementation(() => undefined);

    focusFirstInvalidControl(form);

    await waitFor(() => expect(target).toHaveFocus());
    expect(scrollBy).toHaveBeenCalledWith({ behavior: 'auto', top: 43 });
    scrollBy.mockRestore();
  });

  it('focuses each first invalid Business field, associates errors, and continues after correction', async () => {
    const user = userEvent.setup();
    const onContinue = vi.fn();
    const onValidationFailure = vi.fn();

    function Harness() {
      const [profile, setProfile] = useState(createDefaultBusinessProfile);
      return (
        <BrandBasicsScreen
          onBack={vi.fn()}
          onContinue={onContinue}
          onLogoSelected={vi.fn()}
          onProfileChange={(patch: Partial<ReturnType<typeof createDefaultBusinessProfile>>) =>
            setProfile((current) => ({
              ...current,
              ...patch,
            }))}
          onProfilePhotoSelected={vi.fn()}
          onValidationFailure={onValidationFailure}
          profile={profile}
          starter="quick_book"
        />
      );
    }

    render(<Harness />);
    const businessName = screen.getByRole('textbox', {
      name: 'Salon or studio name',
    });
    const ownerName = screen.getByRole('textbox', { name: 'Your name' });
    const summaryScroll = vi.fn();

    await user.click(screen.getByRole('button', { name: 'Continue' }));

    await waitFor(() => expect(businessName).toHaveFocus());
    const summary = screen.getByRole('alert');
    summary.scrollIntoView = summaryScroll;
    expect(summary).toHaveTextContent(
      'Check the highlighted information.3 answers need attention.',
    );
    expect(businessName).toHaveAttribute('aria-invalid', 'true');
    expect(businessName).toHaveAccessibleDescription('Add your salon or studio name.');
    expect(ownerName).toHaveAccessibleDescription('Add your name.');
    expect(screen.getByRole('group', {
      name: 'Who are you setting Luster up for?',
    })).toHaveAccessibleDescription('Choose who you’re setting Luster up for.');
    expect(onValidationFailure).toHaveBeenLastCalledWith([
      'businessName',
      'ownerName',
      'businessStructure',
    ]);

    await user.type(businessName, 'Isla Nail Studio');
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    await waitFor(() => expect(ownerName).toHaveFocus());
    expect(summaryScroll).toHaveBeenCalledWith({
      block: 'start',
      inline: 'nearest',
    });

    await user.type(ownerName, 'Daniela');
    await user.click(screen.getByRole('radio', { name: 'Solo nail tech' }));
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    expect(onContinue).toHaveBeenCalledOnce();
  });
});

describe('NativeSwitch', () => {
  it('uses native checkbox semantics, supports keyboard and label activation, and has a 44px hit target', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();

    function Harness({ disabled = false }: { disabled?: boolean }) {
      const [checked, setChecked] = useState(false);
      return (
        <NativeSwitch
          checked={checked}
          description="Controls whether clients can see this section."
          disabled={disabled}
          label="Show section on my website"
          onChange={(next) => {
            onChange(next);
            setChecked(next);
          }}
        />
      );
    }

    const view = render(<Harness />);
    const control = screen.getByRole('switch', { name: 'Show section on my website' });
    expect(control).toHaveAttribute('type', 'checkbox');
    expect(control).not.toBeChecked();
    expect(control).toHaveAccessibleDescription('Controls whether clients can see this section.');

    const hitTarget = control.closest('label');
    expect(hitTarget).toHaveClass('onboarding-switch-control');

    const onboardingCss = readFileSync(
      join(process.cwd(), 'src/onboarding/onboarding.css'),
      'utf8',
    );
    const hitTargetRule = onboardingCss.match(
      /\.onboarding-switch-control\s*\{([^}]*)\}/u,
    )?.[1];
    expect(hitTargetRule).toContain('width: 52px;');
    expect(hitTargetRule).toContain('min-height: 44px;');

    control.focus();
    await user.keyboard(' ');
    expect(control).toBeChecked();
    expect(onChange).toHaveBeenLastCalledWith(true);
    await user.click(hitTarget as HTMLElement);
    expect(control).not.toBeChecked();
    expect(onChange).toHaveBeenLastCalledWith(false);

    view.rerender(<Harness disabled />);
    const disabledControl = screen.getByRole('switch', { name: 'Show section on my website' });
    expect(disabledControl).toBeDisabled();
    const callCount = onChange.mock.calls.length;
    await user.click(disabledControl.closest('label') as HTMLElement);
    expect(onChange).toHaveBeenCalledTimes(callCount);
  });
});

describe('ImageUploadField', () => {
  it('shows processing and then a ready thumbnail before offering Replace or Remove', async () => {
    const user = userEvent.setup();
    let finishUpload: (() => void) | undefined;

    function Harness() {
      const [currentLabel, setCurrentLabel] = useState<string>();
      return (
        <ImageUploadField
          chooseLabel="Choose profile photo"
          currentLabel={currentLabel}
          label="Profile photo"
          onRemove={() => setCurrentLabel(undefined)}
          onSelect={async (file) => {
            await new Promise<void>((resolve) => { finishUpload = resolve; });
            setCurrentLabel(file.name);
          }}
          previewUrl={currentLabel ? 'blob:profile-photo' : undefined}
          readyLabel="Photo ready"
        />
      );
    }

    render(<Harness />);
    const file = new File(['jpeg'], 'IMG_5222.jpeg', { type: 'image/jpeg' });
    await user.upload(screen.getByLabelText('Profile photo'), file);

    expect(screen.getByRole('status')).toHaveTextContent('Processing photo…IMG_5222.jpeg');
    finishUpload?.();
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Photo readyIMG_5222.jpeg'));
    expect(screen.getByRole('button', { name: 'Replace' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Remove' })).toBeEnabled();
  });

  it('does not announce a saved Logo as ready before its own thumbnail resolves', () => {
    const view = render(
      <ImageUploadField
        assetLoading
        chooseLabel="Choose logo"
        currentLabel="isla-wordmark.png"
        label="Logo"
        loadingLabel="Loading saved logo…"
        mediaRole="logo"
        onSelect={vi.fn()}
        previewAlt="Isla Nail Studio logo thumbnail"
        readyLabel="Logo ready"
      />,
    );

    expect(screen.getByRole('status')).toHaveTextContent(
      'Loading saved logo…isla-wordmark.png',
    );
    expect(screen.queryByText('Logo ready')).not.toBeInTheDocument();
    expect(screen.queryByRole('img')).not.toBeInTheDocument();

    view.rerender(
      <ImageUploadField
        chooseLabel="Choose logo"
        currentLabel="isla-wordmark.png"
        label="Logo"
        mediaRole="logo"
        onSelect={vi.fn()}
        previewAlt="Isla Nail Studio logo thumbnail"
        previewUrl="blob:logo-thumbnail"
        readyLabel="Logo ready"
      />,
    );

    expect(screen.getByRole('status')).toHaveTextContent(
      'Logo readyisla-wordmark.png',
    );
    expect(screen.getByRole('img', { name: 'Isla Nail Studio logo thumbnail' }))
      .toHaveAttribute('src', 'blob:logo-thumbnail');
  });

  it.each([
    ['Profile photo', 'Choose profile photo'],
    ['Logo', 'Choose logo'],
  ])('keeps a polished, non-duplicated %s failure recovery state', async (label, chooseLabel) => {
    const user = userEvent.setup();
    const onSelect = vi.fn(async () => {
      throw new Error('This private tab isn’t allowing Luster to save images. Open this page in a regular tab and try again.');
    });
    render(
      <ImageUploadField
        chooseLabel={chooseLabel}
        label={label}
        onSelect={onSelect}
      />,
    );

    await user.upload(
      screen.getByLabelText(label),
      new File(['jpeg'], 'IMG_5222.jpeg', { type: 'image/jpeg' }),
    );

    const error = await screen.findByRole('alert');
    expect(error).toHaveTextContent('IMG_5222.jpeg');
    expect(error).toHaveTextContent('private tab');
    const retry = within(error).getByRole('button', { name: 'Retry' });
    const chooseAnother = within(error).getByRole('button', { name: 'Choose another image' });
    expect(retry).toHaveClass('is-primary');
    expect(chooseAnother).toHaveClass('is-secondary');
    expect(within(error).getAllByRole('button').map((button) => button.textContent)).toEqual([
      'Retry',
      'Choose another image',
    ]);
    expect(screen.queryByRole('button', { name: chooseLabel })).not.toBeInTheDocument();
    await user.click(retry);
    await waitFor(() => expect(onSelect).toHaveBeenCalledTimes(2));
    expect(chooseAnother).toBeEnabled();
  });
});
