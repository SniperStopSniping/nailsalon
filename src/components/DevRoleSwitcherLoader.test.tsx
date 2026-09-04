import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { DevRoleSwitcherLoader } from './DevRoleSwitcherLoader';

vi.mock('next/dynamic', () => ({
  default: () => () => <div>Development role switcher</div>,
}));

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('development role switcher client boundary', () => {
  it('does not render in production even if the public development flag is set', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('NEXT_PUBLIC_DEV_MODE', 'true');
    render(<DevRoleSwitcherLoader />);

    expect(screen.queryByText('Development role switcher')).not.toBeInTheDocument();
  });

  it('does not render without an explicit development flag', () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('NEXT_PUBLIC_DEV_MODE', 'false');
    render(<DevRoleSwitcherLoader />);

    expect(screen.queryByText('Development role switcher')).not.toBeInTheDocument();
  });

  it('preserves the explicit local development switcher', () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('NEXT_PUBLIC_DEV_MODE', 'true');
    render(<DevRoleSwitcherLoader />);

    expect(screen.getByText('Development role switcher')).toBeInTheDocument();
  });
});
