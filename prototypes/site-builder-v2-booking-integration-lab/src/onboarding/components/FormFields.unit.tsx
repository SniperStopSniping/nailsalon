import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { createDefaultBusinessProfile } from '../model/defaults';
import { BusinessScreen } from '../screens/BasicsScreens';
import { focusFirstInvalidControl, NativeSwitch } from './FormFields';

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
    const scrollIntoView = vi.fn();
    target.scrollIntoView = scrollIntoView;

    focusFirstInvalidControl(form);

    await waitFor(() => expect(target).toHaveFocus());
    expect(scrollIntoView).toHaveBeenCalledWith({
      block: 'center',
      inline: 'nearest',
    });
    expect(screen.getByRole('textbox', { name: 'Later invalid field' }))
      .not.toHaveFocus();
  });

  it('focuses each first invalid Business field, associates errors, and continues after correction', async () => {
    const user = userEvent.setup();
    const onContinue = vi.fn();
    const onValidationFailure = vi.fn();

    function Harness() {
      const [profile, setProfile] = useState(createDefaultBusinessProfile);
      return (
        <BusinessScreen
          onBack={vi.fn()}
          onContinue={onContinue}
          onProfileChange={(patch) => setProfile((current) => ({
            ...current,
            ...patch,
          }))}
          onValidationFailure={onValidationFailure}
          profile={profile}
        />
      );
    }

    render(<Harness />);
    const businessName = screen.getByRole('textbox', {
      name: 'Business or salon name',
    });
    const ownerName = screen.getByRole('textbox', { name: 'Your name' });
    const businessScroll = vi.fn();
    const ownerScroll = vi.fn();
    businessName.scrollIntoView = businessScroll;
    ownerName.scrollIntoView = ownerScroll;

    await user.click(screen.getByRole('button', { name: 'Continue' }));

    await waitFor(() => expect(businessName).toHaveFocus());
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Check the highlighted information.3 answers need attention.',
    );
    expect(businessName).toHaveAttribute('aria-invalid', 'true');
    expect(businessName).toHaveAccessibleDescription('Add your business or salon name.');
    expect(ownerName).toHaveAccessibleDescription('Add your name.');
    expect(screen.getByRole('group', {
      name: 'Who are you setting Luster up for?',
    })).toHaveAccessibleDescription('Choose who you’re setting Luster up for.');
    expect(businessScroll).toHaveBeenCalledWith({
      block: 'center',
      inline: 'nearest',
    });
    expect(onValidationFailure).toHaveBeenLastCalledWith([
      'businessName',
      'ownerName',
      'businessStructure',
    ]);

    await user.type(businessName, 'Isla Nail Studio');
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    await waitFor(() => expect(ownerName).toHaveFocus());
    expect(ownerScroll).toHaveBeenCalledWith({
      block: 'center',
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
