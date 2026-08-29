import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';

import { WelcomeScreen } from './WelcomeScreen';

describe('WelcomeScreen', () => {
  it('starts either required-basics path and explains content reuse', async () => {
    const user = userEvent.setup();
    const onBuildWebsite = vi.fn();
    const onCanvaIntent = vi.fn();
    render(
      <WelcomeScreen
        onBuildWebsite={onBuildWebsite}
        onCanvaIntent={onCanvaIntent}
      />,
    );

    expect(screen.getByRole('heading', { name: 'Let’s build your website' })).toBeVisible();
    expect(screen.getByText('YOUR WEBSITE STARTS HERE')).toBeVisible();
    expect(screen.getByText('Add your details once')).toBeVisible();
    expect(screen.getByText('Switch designs without starting over')).toBeVisible();
    expect(screen.getByText('Update your whole site from one place')).toBeVisible();
    expect(screen.getByText('Your progress saves automatically on this device.')).toBeVisible();
    expect(screen.queryByText(/UX Lab|Production/u)).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Build my website' }));
    await user.click(screen.getByRole('button', { name: 'I want to use a Canva design' }));
    expect(onBuildWebsite).toHaveBeenCalledOnce();
    expect(onCanvaIntent).toHaveBeenCalledOnce();
  });
});
