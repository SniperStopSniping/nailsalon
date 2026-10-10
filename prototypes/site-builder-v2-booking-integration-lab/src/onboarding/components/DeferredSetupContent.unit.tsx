import { act, render, screen } from '@testing-library/react';
import { lazy } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { DeferredSetupContent } from './DeferredSetupContent';

describe('DeferredSetupContent', () => {
  it('keeps navigation visible while a later screen loads', async () => {
    let finish!: (value: { default: () => React.JSX.Element }) => void;
    const Later = lazy(() => new Promise<{ default: () => React.JSX.Element }>((resolve) => {
      finish = resolve;
    }));
    render(
      <>
        <button type="button">Back</button>
        <DeferredSetupContent><Later /></DeferredSetupContent>
      </>,
    );

    expect(screen.getByRole('button', { name: 'Back' })).toBeVisible();
    expect(screen.getByRole('status')).toHaveTextContent('Opening setup…');

    await act(async () => {
      finish({ default: () => <h1>Choose your look</h1> });
    });

    expect(screen.getByRole('heading', { name: 'Choose your look' })).toBeVisible();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('offers recovery when a deferred module cannot download', async () => {
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const Unavailable = lazy(() => Promise.reject(new Error('Chunk unavailable')));
      render(<DeferredSetupContent><Unavailable /></DeferredSetupContent>);

      expect(await screen.findByRole('alert')).toHaveTextContent('We couldn’t load this part of setup.');
      expect(screen.getByRole('button', { name: 'Reload setup' })).toBeVisible();
    } finally {
      errorLog.mockRestore();
    }
  });
});
