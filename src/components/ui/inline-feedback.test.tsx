import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { InlineFeedback } from './inline-feedback';
import { useActionFeedback } from './useActionFeedback';

describe('InlineFeedback', () => {
  beforeEach(() => {
    Element.prototype.scrollIntoView = vi.fn();
  });

  it('announces an error as an alert, brings it into view and takes focus', () => {
    render(<InlineFeedback tone="error" message="That time is not available." detail="Attempted time: Wed, Sep 9, 1:00 PM" />);

    const node = screen.getByRole('alert');

    expect(node).toHaveTextContent('That time is not available.');
    expect(node).toHaveTextContent('Attempted time: Wed, Sep 9, 1:00 PM');
    expect(Element.prototype.scrollIntoView).toHaveBeenCalled();
    expect(node).toHaveFocus();
  });

  it('announces success politely and never steals focus', () => {
    render(
      <>
        <button type="button">Save changes</button>
        <InlineFeedback tone="success" message="Booking policy saved." />
      </>,
    );

    const node = screen.getByRole('status');

    expect(node).toHaveTextContent('Booking policy saved.');
    expect(node).toHaveAttribute('aria-live', 'polite');
    expect(node).not.toHaveFocus();
    expect(Element.prototype.scrollIntoView).not.toHaveBeenCalled();
  });

  it('stays until it is dismissed', async () => {
    const user = userEvent.setup();

    function Harness() {
      const [visible, setVisible] = useState(true);
      return visible
        ? (
            <InlineFeedback
              tone="error"
              message="We can’t add photos right now."
              onDismiss={() => setVisible(false)}
            />
          )
        : <p>dismissed</p>;
    }

    render(<Harness />);

    expect(screen.getByRole('alert')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Dismiss' }));

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByText('dismissed')).toBeInTheDocument();
  });

  it('renders a recovery action next to the message', () => {
    render(
      <InlineFeedback
        tone="error"
        message="Could not load your portfolio."
        action={<button type="button">Try again</button>}
      />,
    );

    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });
});

describe('useActionFeedback', () => {
  function Harness({ action }: { action: () => Promise<string> }) {
    const { feedback, pending, run } = useActionFeedback();
    return (
      <>
        <button
          type="button"
          onClick={() => {
            void run(action, {
              success: 'Saved.',
              error: 'That did not go through. Try again.',
            });
          }}
        >
          Save
        </button>
        <span data-testid="pending">{pending ? 'pending' : 'idle'}</span>
        {feedback
          ? <InlineFeedback tone={feedback.tone} message={feedback.message} detail={feedback.detail} />
          : null}
      </>
    );
  }

  beforeEach(() => {
    Element.prototype.scrollIntoView = vi.fn();
  });

  it('shows success only after the promise resolves', async () => {
    const user = userEvent.setup();
    let resolve: ((value: string) => void) | null = null;
    const action = vi.fn(() => new Promise<string>((res) => {
      resolve = res;
    }));

    render(<Harness action={action} />);
    await user.click(screen.getByRole('button', { name: 'Save' }));

    // Mid-flight: pending, and nothing claims success yet.
    expect(screen.getByTestId('pending')).toHaveTextContent('pending');
    expect(screen.queryByRole('status')).not.toBeInTheDocument();

    await act(async () => {
      resolve?.('ok');
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent('Saved.');
    });

    expect(screen.getByTestId('pending')).toHaveTextContent('idle');
  });

  it('turns a rejection into an error notice and never claims success', async () => {
    const user = userEvent.setup();
    const action = vi.fn(() => Promise.reject(new Error('That time is not available.')));

    render(<Harness action={action} />);
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('That time is not available.');
    });

    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.getByTestId('pending')).toHaveTextContent('idle');
  });

  it('falls back to the caller’s wording when the rejection carries none', async () => {
    const user = userEvent.setup();
    const messagelessError = new Error('placeholder');
    messagelessError.message = '';
    const action = vi.fn(() => Promise.reject(messagelessError));

    render(<Harness action={action} />);
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('That did not go through. Try again.');
    });
  });
});
