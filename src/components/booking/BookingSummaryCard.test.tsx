import React from 'react';

import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/image', () => ({
  default: ({
    alt,
    src,
    onError,
  }: React.ImgHTMLAttributes<HTMLImageElement> & { src?: string }) => (
    <img alt={alt} src={src} onError={onError} />
  ),
}));

import { BookingSummaryCard } from './BookingSummaryCard';

describe('BookingSummaryCard', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('falls back to technician initials when the avatar image fails at runtime', () => {
    render(
      <BookingSummaryCard
        serviceNames="BIAB"
        totalDuration={75}
        totalPrice={50}
        technician={{ name: 'Daniela Ruiz', imageUrl: '/broken-avatar.jpg' }}
      />,
    );

    fireEvent.error(screen.getByAltText('Daniela Ruiz'));

    expect(screen.getByText('DR')).toBeInTheDocument();
  });
});
