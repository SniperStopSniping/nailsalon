import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { FeedbackProvider } from './FeedbackProvider';
import { LAB_FEEDBACK_CAPABILITY_PORT } from './lab-feedback-port';
import { useFeedback } from './useFeedback';

function Harness() {
  const feedback = useFeedback();
  const [results, setResults] = useState<boolean[]>([]);
  return (
    <>
      <button type="button" onClick={() => feedback.send({
        kind: 'added',
        message: 'Russian Manicure added.',
      })}>Add service</button>
      <button type="button" onClick={() => setResults((current) => [
        ...current,
        feedback.send({
          kind: 'milestone',
          message: 'Everything you need is ready',
          onceKey: 'all-ready',
        }),
      ])}>Complete</button>
      <button type="button" onClick={() => feedback.resetSession()}>Reset feedback</button>
      <button type="button" onClick={() => feedback.configure({ reducedMotion: true })}>Reduce motion</button>
      <button type="button" onClick={() => feedback.send({
        kind: 'milestone',
        message: 'Your starting site is ready',
      })}>Starting site milestone</button>
      <button type="button" onClick={() => feedback.send({
        kind: 'stage_complete',
        message: 'Booking is ready',
      })}>Booking stage milestone</button>
      <button type="button" onClick={() => feedback.send({
        announce: false,
        kind: 'added',
        message: 'Photo ready',
      })}>Visual only</button>
      <output aria-label="feedback results">{results.join(',')}</output>
    </>
  );
}

describe('FeedbackProvider', () => {
  it('renders one visual status and one concise live announcement', async () => {
    const user = userEvent.setup();
    render(<FeedbackProvider testMode><Harness /></FeedbackProvider>);

    await user.click(screen.getByRole('button', { name: 'Add service' }));

    expect(document.querySelectorAll('.onboarding-feedback')).toHaveLength(1);
    await waitFor(() => expect(screen.getAllByText('Russian Manicure added.')).toHaveLength(2));
  });

  it('honours one-time milestone keys without delaying the triggering action', async () => {
    const user = userEvent.setup();
    render(<FeedbackProvider testMode><Harness /></FeedbackProvider>);
    const complete = screen.getByRole('button', { name: 'Complete' });

    await user.click(complete);
    await user.click(complete);

    expect(screen.getByLabelText('feedback results')).toHaveTextContent('true,false');
    expect(document.querySelector('.onboarding-feedback')).toHaveClass('is-milestone');

    await user.click(screen.getByRole('button', { name: 'Reset feedback' }));
    await user.click(complete);
    expect(screen.getByLabelText('feedback results')).toHaveTextContent('true,false,true');
  });

  it('accepts the persisted Lab reduced-motion preference before later feedback', async () => {
    const user = userEvent.setup();
    render(<FeedbackProvider testMode={false}><Harness /></FeedbackProvider>);

    await user.click(screen.getByRole('button', { name: 'Reduce motion' }));
    await user.click(screen.getByRole('button', { name: 'Add service' }));

    expect(document.querySelector('.onboarding-feedback')).toHaveClass('is-reduced-motion');
  });

  it('queues simultaneous major feedback so the starting-site reveal is not overwritten', () => {
    vi.useFakeTimers();
    try {
      render(<FeedbackProvider testMode><Harness /></FeedbackProvider>);
      fireEvent.click(screen.getByRole('button', { name: 'Starting site milestone' }));
      fireEvent.click(screen.getByRole('button', { name: 'Booking stage milestone' }));

      expect(document.querySelector('.onboarding-feedback')).toHaveTextContent(
        'Your starting site is ready',
      );
      expect(document.querySelector('.onboarding-feedback')).not.toHaveTextContent(
        'Booking is ready',
      );

      act(() => vi.advanceTimersByTime(2_800));
      expect(document.querySelector('.onboarding-feedback')).toHaveTextContent(
        'Booking is ready',
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it('supports visual and haptic confirmation without duplicating a local live status', () => {
    render(<FeedbackProvider testMode><Harness /></FeedbackProvider>);
    fireEvent.click(screen.getByRole('button', { name: 'Visual only' }));

    expect(document.querySelector('.onboarding-feedback')).toHaveTextContent('Photo ready');
    expect(document.querySelector('.visually-hidden[role="status"]'))
      .toBeEmptyDOMElement();
  });
});

describe('LAB_FEEDBACK_CAPABILITY_PORT', () => {
  it('gracefully no-ops when haptics are unsupported or reduced motion is active', () => {
    const originalVibrate = navigator.vibrate;
    const originalUserActivation = Object.getOwnPropertyDescriptor(
      navigator,
      'userActivation',
    );
    const vibrate = vi.fn(() => true);
    Object.defineProperty(navigator, 'vibrate', {
      configurable: true,
      value: vibrate,
    });
    Object.defineProperty(navigator, 'userActivation', {
      configurable: true,
      value: { hasBeenActive: false, isActive: false },
    });

    expect(LAB_FEEDBACK_CAPABILITY_PORT.haptic('selection', {
      reducedMotion: true,
      testMode: false,
    })).toBe(false);
    expect(vibrate).not.toHaveBeenCalled();

    expect(LAB_FEEDBACK_CAPABILITY_PORT.haptic('selection', {
      reducedMotion: false,
      testMode: false,
    })).toBe(false);
    expect(vibrate).not.toHaveBeenCalled();

    Object.defineProperty(navigator, 'vibrate', {
      configurable: true,
      value: originalVibrate,
    });
    if (originalUserActivation) {
      Object.defineProperty(navigator, 'userActivation', originalUserActivation);
    } else {
      Reflect.deleteProperty(navigator, 'userActivation');
    }
  });
});
